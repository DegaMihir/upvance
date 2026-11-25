import { z } from "zod";
import { db } from "@/lib/db";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { ingestJobs } from "@/lib/jobs/ingest";
import { analyzeJob } from "@/lib/analysis";
import { evaluateJob, loadUserContext, recomputeMatches } from "@/lib/matching";
import { atsSupport, detectAts } from "@/lib/ats";
import { canonicalizeUrl } from "@/lib/text";
import { decryptSecret } from "@/lib/crypto";
import { createApplication, prepareApplication, DuplicateError } from "@/lib/applications";

export const OPTIONS = options;

const schema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  location: z.string().max(300).optional().default(""),
  description: z.string().max(60000).optional().default(""),
  applyUrl: z.string().url().optional().or(z.literal("")).default(""),
  easyApply: z.boolean().optional().default(false),
  postedAt: z.string().optional(),
});

/** The user clicked the extension on a job page: store the visible job and return the match. */
export const POST = extensionHandler(async (req, userId) => {
  const body = schema.parse(await req.json());
  const pageAts = detectAts(body.url);
  const applyUrl = body.applyUrl || (pageAts === "linkedin" || pageAts === "indeed" ? "" : body.url);
  const res = await ingestJobs([
    {
      source: "extension",
      externalId: canonicalizeUrl(body.url),
      title: body.title,
      company: body.company,
      location: body.location,
      description: body.description,
      applyUrl,
      sourceUrl: body.url,
      postedAt: body.postedAt ? new Date(body.postedAt) : new Date(),
      atsType: applyUrl ? detectAts(applyUrl) : pageAts,
    },
  ]);
  const jobId = res.jobIds[0];
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const { aiNote } = await analyzeJob(job, { useAI: body.description.length > 200, userId });
  await recomputeMatches(userId, [jobId]);
  const fresh = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const ctx = await loadUserContext(userId);
  const ev = ctx.candidate ? evaluateJob(fresh, ctx.candidate, ctx.prefs, ctx.weights) : null;
  const settings = ctx.settings;
  const support = body.easyApply && !body.applyUrl
    ? { level: "unsupported", note: "LinkedIn Easy Apply is not supported. Look for an “Apply on company website” link instead." }
    : atsSupport(fresh.atsType, !!decryptSecret(settings?.encryptedAppPassword));

  let application = await db.application.findFirst({ where: { userId, jobId }, select: { id: true, status: true } });
  let prepared: string | null = null;
  // Optional, OFF by default: prepare applications for jobs the user opens
  if (!application && settings?.extensionPrepareOnOpen && ev && ev.eligibility.status !== "Ineligible" && support.level !== "unsupported") {
    try {
      const app = await createApplication(userId, jobId, { origin: "extension" });
      await prepareApplication(app.id, userId, { useAI: true });
      application = await db.application.findUnique({ where: { id: app.id }, select: { id: true, status: true } });
      prepared = "Prepared automatically (your “prepare jobs I open” setting is on).";
    } catch (e) {
      if (!(e instanceof DuplicateError)) throw e;
    }
  }
  return json(req, {
    jobId,
    title: fresh.title,
    company: fresh.company.name,
    score: ev?.score ?? null,
    band: ev ? (ev.eligibility.status === "Ineligible" ? "Ineligible" : ev.band) : null,
    eligibility: ev?.eligibility.status ?? "Unknown",
    reasons: ev?.eligibility.reasons ?? [],
    whyMatch: ev?.whyMatch.slice(0, 4) ?? [],
    whyNot: ev?.whyNot.slice(0, 4) ?? [],
    sponsorship: fresh.sponsorshipCategory,
    remote: fresh.remoteCategory,
    ats: fresh.atsType,
    atsSupport: support,
    application,
    prepared,
    aiNote,
  });
});
