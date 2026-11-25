"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { analyzeJob } from "@/lib/analysis";
import { ingestJobs } from "@/lib/jobs/ingest";
import { recomputeMatches } from "@/lib/matching";
import { adzunaConfigured, fetchAdzunaMulti, fetchGoogleJobs, googleJobsConfigured, resolveApplyUrl, fetchArbeitnow, fetchCompanyBoard, fetchJobFromUrl, fetchRemoteOk, fetchRemotive, type RawJob } from "@/lib/sources";
import { aiAvailable } from "@/lib/ai";
import { enqueueAiAnalysis } from "@/lib/tasks";
import { refreshCompanyBoard } from "@/lib/jobs/refresh";
import { errorMessage, type ActionResult } from "./types";
import { parseJson } from "@/lib/utils";
import type { BoardAts } from "@/lib/ats";
import { addDirectoryCompany, runDiscovery } from "@/lib/discovery";
import { clearBoardCache, fetchWeWorkRemotely, fetchYcJobs, onEmployerBoard, WWR_FEEDS, ycRolesFor } from "@/lib/sources/remote-boards";
import { mapLimit } from "@/lib/sources/boards";
import { checkJobSites, JOB_SITE_LABEL } from "@/lib/jobs/job-sites";

export async function addCompanyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const input = String(fd.get("company") ?? "").trim();
  const ats = String(fd.get("ats") ?? "") as BoardAts | "";
  const displayName = String(fd.get("displayName") ?? "").trim();
  if (!input) return { error: "Enter a company board name or careers URL." };
  try {
    const { ats: found, slug, jobs } = await fetchCompanyBoard(input, ats || undefined);
    const res = await ingestJobs(jobs, displayName ? { companyName: displayName } : {});
    const company = res.jobIds.length ? (await db.job.findUnique({ where: { id: res.jobIds[0] }, select: { companyId: true } }))?.companyId : null;
    if (company) {
      await db.company.update({ where: { id: company }, data: { atsType: found, boardSlug: slug, lastFetchedAt: new Date() } });
      await db.followedCompany.upsert({ where: { userId_companyId: { userId, companyId: company } }, create: { userId, companyId: company }, update: {} });
    }
    await recomputeMatches(userId, res.jobIds);
    const queued = await enqueueAiAnalysis(userId, res.newJobIds);
    revalidatePath("/jobs");
    return {
      ok: `Found ${jobs.length} open job${jobs.length === 1 ? "" : "s"} on ${found} (“${slug}”): ${res.created} new, ${res.updated} updated.`,
      warn: queued ? `${queued} promising job(s) queued for AI analysis (spread out to stay within free limits).` : undefined,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

async function finishSingleJob(userId: string, jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const { aiNote } = await analyzeJob(job, { useAI: true, userId, force: job.analysisSource !== "ai" });
  await recomputeMatches(userId, [jobId]);
  return aiNote;
}

export async function pasteUrlAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const url = String(fd.get("url") ?? "").trim();
  let jobId: string;
  let note: string | null = null;
  try {
    const raw = await fetchJobFromUrl(url);
    const res = await ingestJobs([raw]);
    jobId = res.jobIds[0];
    note = await finishSingleJob(userId, jobId);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/jobs/${jobId}${note ? `?note=${encodeURIComponent(note.slice(0, 200))}` : ""}`);
}

export async function pasteTextAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const title = String(fd.get("title") ?? "").trim();
  const company = String(fd.get("companyName") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim();
  const applyUrl = String(fd.get("applyUrl") ?? "").trim();
  if (!title || !company || description.length < 50) return { error: "Add a title, company and the full description (at least 50 characters)." };
  let jobId: string;
  let note: string | null = null;
  try {
    const raw: RawJob = {
      source: "manual",
      externalId: `${company}|${title}|${Date.now()}`,
      title,
      company,
      location: String(fd.get("location") ?? "").trim(),
      description,
      applyUrl,
      sourceUrl: applyUrl,
      postedAt: new Date(),
    };
    const res = await ingestJobs([raw]);
    jobId = res.jobIds[0];
    note = await finishSingleJob(userId, jobId);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/jobs/${jobId}${note ? `?note=${encodeURIComponent(note.slice(0, 200))}` : ""}`);
}

export async function searchSourceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const source = String(fd.get("source") ?? "remotive");
  const keyword = String(fd.get("keyword") ?? "").trim();
  const country = String(fd.get("country") ?? "gb").trim();
  try {
    let jobs: RawJob[] = [];
    if (source === "remotive") jobs = await fetchRemotive(keyword, 60);
    else if (source === "remoteok") jobs = await fetchRemoteOk(keyword.toLowerCase().replace(/\s+/g, "-"));
    else if (source === "arbeitnow") jobs = await fetchArbeitnow(2);
    else if (source === "weworkremotely") jobs = await fetchWeWorkRemotely(WWR_FEEDS);
    else if (source === "ycombinator") {
      const titles = keyword ? [keyword] : parseJson<string[]>((await db.userSettings.findUnique({ where: { userId } }))?.targetTitles, []);
      jobs = await fetchYcJobs({ roles: ycRolesFor(titles), maxDetails: 40 });
    }
    else if (source === "adzuna") {
      if (!adzunaConfigured()) return { error: "Adzuna needs ADZUNA_APP_ID and ADZUNA_APP_KEY in .env (free key at developer.adzuna.com)." };
      const countries = country.toLowerCase() === "all" ? parseJson<string[]>((await db.userSettings.findUnique({ where: { userId } }))?.targetCountries, []) : country.split(/[,\s]+/).filter(Boolean);
      jobs = await fetchAdzunaMulti(keyword || "software engineer", countries);
    } else if (source === "googlejobs") {
      if (!googleJobsConfigured()) return { error: "Google Jobs needs SERPAPI_KEY in .env (serpapi.com – free plan available)." };
      jobs = await fetchGoogleJobs(keyword || "software engineer", country && country.length > 2 ? country : undefined);
    }
    // keyword pre-filter (free, before any AI)
    if (keyword) {
      const words = keyword.toLowerCase().split(/\s+/);
      jobs = jobs.filter((j) => words.every((w) => `${j.title} ${j.description.slice(0, 800)}`.toLowerCase().includes(w)));
    }
    // point aggregator jobs at the employer's own apply page when we can find it
    clearBoardCache();
    jobs = await mapLimit(jobs.slice(0, 80), 3, async (j) => {
      const r = await resolveApplyUrl(j);
      return r.applyUrl === j.applyUrl && (j.source === "weworkremotely" || j.source === "ycombinator") ? onEmployerBoard(j).catch(() => j) : r;
    }, 100);
    const res = await ingestJobs(jobs);
    await recomputeMatches(userId, res.jobIds);
    const queued = await enqueueAiAnalysis(userId, res.newJobIds);
    revalidatePath("/jobs");
    const attribution = source === "remoteok" ? " Jobs from Remote OK link back to remoteok.com." : "";
    return { ok: `Imported ${jobs.length} job(s) from ${source}: ${res.created} new.${attribution}`, warn: queued ? `${queued} queued for AI analysis.` : undefined };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function skipJobAction(fd: FormData) {
  const userId = await requireUserId();
  const jobId = String(fd.get("jobId"));
  const reason = String(fd.get("reason") ?? "Not interested");
  const skip = fd.get("undo") !== "1";
  await db.match.updateMany({ where: { userId, jobId }, data: skip ? { status: "skipped", skipReason: reason } : { status: "new", skipReason: null } });
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

export async function analyzeWithAiAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const jobId = String(fd.get("jobId"));
  if (!(await aiAvailable("analysis", userId))) return { error: "No AI provider is configured for analysis. The rule-based analysis is shown instead." };
  try {
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
    const { aiNote } = await analyzeJob(job, { useAI: true, userId, force: true });
    await recomputeMatches(userId, [jobId]);
    revalidatePath(`/jobs/${jobId}`);
    return aiNote ? { error: aiNote } : { ok: "Analysed with AI (result cached – this job won't be sent again)." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function refreshCompanyAction(fd: FormData) {
  const userId = await requireUserId();
  const res = await refreshCompanyBoard(String(fd.get("companyId")));
  await recomputeMatches(userId, res.jobIds);
  await enqueueAiAnalysis(userId, res.newJobIds);
  revalidatePath("/discover");
  revalidatePath("/jobs");
}

export async function refreshMatchesAction() {
  const userId = await requireUserId();
  await recomputeMatches(userId);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function runDiscoveryAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  await requireUserId();
  try {
    const r = await runDiscovery({ batch: 8, pause: 800 });
    revalidatePath("/discover");
    revalidatePath("/jobs");
    return { ok: `Checked ${r.checked} companies, found ${r.found} job board(s), ${r.jobsAdded} new jobs. Jobs now come from ${r.countries} countries.`, warn: "The background worker keeps going on its own (a few companies every hour)." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function addDirectoryCompanyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireUserId();
  const name = String(fd.get("name") ?? "").trim();
  const website = String(fd.get("website") ?? "").trim();
  if (!name) return { error: "Enter a company name." };
  try {
    const d = await addDirectoryCompany(name, website || undefined);
    const { discoverOne } = await import("@/lib/discovery");
    const r = await discoverOne(d.id);
    if (r && r.confidence !== "low") {
      const res = await refreshCompanyBoard(r.company.id);
      for (const u of await db.user.findMany({ select: { id: true } })) await recomputeMatches(u.id, res.jobIds);
      revalidatePath("/jobs");
      return { ok: `Found ${name} on ${r.hit.ats} – ${res.created} new jobs imported.` };
    }
    if (r) return { ok: `Possible board on ${r.hit.ats} (“${r.hit.slug}”) but the name match is uncertain, so nothing was imported. Paste the careers URL in “Add a company” to confirm.` };
    return { error: `No public job board found for ${name}${website ? "" : " – adding the company website helps"}. It stays in the directory and will be retried.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function checkJobSitesAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const run = await checkJobSites(userId);
    await recomputeMatches(userId, run.jobIds);
    const queued = await enqueueAiAnalysis(userId, run.newJobIds);
    revalidatePath("/jobs");
    const per = Object.entries(run.found).map(([k, v]) => `${JOB_SITE_LABEL[k as keyof typeof JOB_SITE_LABEL]} ${v}`).join(", ");
    return {
      ok: `Checked ${per || "no sites"}. ${run.kept} fit your target roles (${run.created} new); ${run.onEmployerBoard} matched to the employer's own job page.`,
      warn: [run.errors.length ? `Some sites failed: ${run.errors.join("; ")}` : "", queued ? `${queued} queued for AI analysis.` : ""].filter(Boolean).join(" ") || undefined,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
