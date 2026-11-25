import { db } from "../db";
import { detectAts } from "../ats";
import { canonicalizeUrl, jobFingerprint, normalizeCompany, normalizeTitle } from "../text";
import { analyzeJob } from "../analysis";
import type { RawJob } from "../sources";

function titleCase(slug: string) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function upsertCompany(name: string, extra: { atsType?: string; boardSlug?: string; website?: string; isDemo?: boolean } = {}) {
  const normalizedName = normalizeCompany(name) || name.toLowerCase();
  return db.company.upsert({
    where: { normalizedName },
    create: { name, normalizedName, ...extra },
    update: Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
  });
}

export interface IngestResult {
  created: number;
  updated: number;
  duplicates: number;
  jobIds: string[];
  newJobIds: string[];
}

/** Store jobs from any source and run the (free) rule-based analysis on new/changed ones. */
export async function ingestJobs(raw: RawJob[], opts: { companyName?: string; isDemo?: boolean } = {}): Promise<IngestResult> {
  const res: IngestResult = { created: 0, updated: 0, duplicates: 0, jobIds: [], newJobIds: [] };
  for (const r of raw) {
    if (!r.title || !r.externalId) continue;
    const companyName = opts.companyName ?? (r.source === "lever" || r.source === "ashby" ? (r.company === r.boardSlug ? titleCase(r.company) : r.company) : r.company);
    const company = await upsertCompany(companyName, {
      atsType: r.boardSlug ? r.atsType : undefined,
      boardSlug: r.boardSlug,
      isDemo: opts.isDemo,
    });
    const applyUrl = r.applyUrl || r.sourceUrl;
    const data = {
      companyId: company.id,
      title: r.title.trim(),
      location: r.location ?? "",
      description: r.description ?? "",
      applyUrl,
      sourceUrl: r.sourceUrl || applyUrl,
      canonicalUrl: canonicalizeUrl(r.sourceUrl || applyUrl),
      fingerprint: jobFingerprint(companyName, r.title, r.location ?? ""),
      atsType: r.atsType ?? detectAts(applyUrl),
      postedAt: r.postedAt,
      employmentType: r.employmentType ?? null,
      salaryMin: r.salaryMin ?? null,
      salaryMax: r.salaryMax ?? null,
      salaryCurrency: r.salaryCurrency ?? null,
      isActive: true,
    };
    const existing = await db.job.findUnique({ where: { source_externalId: { source: r.source, externalId: r.externalId } } });
    let jobId: string;
    if (existing) {
      const changed = existing.description !== data.description || existing.title !== data.title || existing.location !== data.location;
      await db.job.update({ where: { id: existing.id }, data: changed ? { ...data, analysis: "{}" } : { isActive: true, postedAt: data.postedAt ?? existing.postedAt } });
      jobId = existing.id;
      res.updated++;
      if (changed) {
        const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
        await analyzeJob(job, { useAI: false, force: true });
      }
    } else {
      const job = await db.job.create({ data: { ...data, source: r.source, externalId: r.externalId }, include: { company: true } });
      jobId = job.id;
      res.created++;
      res.newJobIds.push(jobId);
      await analyzeJob(job, { useAI: false, force: true });
    }
    if (await dedupeJob(jobId)) {
      res.duplicates++;
      res.newJobIds = res.newJobIds.filter((id) => id !== jobId);
    }
    res.jobIds.push(jobId);
  }
  return res;
}

/** Higher = closer to the employer's original posting (and its real apply link). */
export const SOURCE_RANK: Record<string, number> = {
  greenhouse: 3, lever: 3, ashby: 3, gem: 3, workable: 3, smartrecruiters: 3, recruitee: 3, personio: 3, teamtailor: 3, bamboohr: 3, breezy: 3, jazzhr: 3, workday: 3,
  url: 2, extension: 2, manual: 2, demo: 2,
  remotive: 1, remoteok: 1, arbeitnow: 1, weworkremotely: 1, ycombinator: 1,
  adzuna: 0, googlejobs: 0,
};

/**
 * Cross-source duplicate detection: the same role at the same company from a
 * different source is folded into the copy closest to the employer. Returns
 * true when `jobId` itself was marked as the duplicate.
 */
export async function dedupeJob(jobId: string): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || !job.isActive || job.source.startsWith("demo")) return false;
  const title = normalizeTitle(job.title);
  const candidates = await db.job.findMany({
    where: { id: { not: jobId }, isActive: true, source: { not: job.source }, OR: [{ fingerprint: job.fingerprint }, { companyId: job.companyId }, ...(job.canonicalUrl ? [{ canonicalUrl: job.canonicalUrl }] : [])] },
  });
  const twins = candidates.filter((c) => c.fingerprint === job.fingerprint || (job.canonicalUrl && c.canonicalUrl === job.canonicalUrl) || (c.companyId === job.companyId && normalizeTitle(c.title) === title && (SOURCE_RANK[c.source] ?? 1) !== (SOURCE_RANK[job.source] ?? 1)));
  if (!twins.length) return false;
  const all = [job, ...twins].sort((a, b) => (SOURCE_RANK[b.source] ?? 1) - (SOURCE_RANK[a.source] ?? 1) || b.description.length - a.description.length);
  const best = all[0];
  for (const j of all.slice(1)) await db.job.update({ where: { id: j.id }, data: { isActive: false, duplicateOfId: best.id } });
  return best.id !== jobId;
}
