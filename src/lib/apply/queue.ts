/**
 * Apply queue: "Apply to all" and "Keep applying to new matches".
 * Jobs are processed one at a time by the apply engine, highest match first,
 * within the daily cap. Over-cap jobs simply wait for the next day.
 */
import { db } from "../db";
import { parseJson } from "../utils";
import { atsSupport } from "../ats";
import { decryptSecret } from "../crypto";
import { checkDuplicates } from "../duplicates";
import { describeFilters, passes, priorityFrom, rowPriority, sortRows, type FeedFilters, type FeedRow } from "../feed";
import { demoFilter } from "../demo/visibility";
import { startOfLocalDay } from "../time";
import { logActivity } from "../activity";

export const MINUTES_PER_APPLICATION = 3;
export const ACTIVE_QUEUE = ["queued", "running", "review", "approved", "paused", "needs-you", "awaiting-confirmation"];

export async function feedRows(userId: string, filters: FeedFilters, opts: { since?: Date } = {}): Promise<FeedRow[]> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const rows = await db.match.findMany({
    where: { userId, job: { isActive: true, ...demoFilter(settings?.showDemoData), ...(opts.since ? { createdAt: { gt: opts.since } } : {}) } },
    include: { job: { include: { company: true } } },
  });
  return sortRows(rows.filter((r) => passes(r, filters, settings)), filters, priorityFrom(settings));
}

/** Slots used today = applications the engine started submitting (failed ones give their slot back). */
export async function capUsedToday(userId: string, now = new Date()) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const since = startOfLocalDay(user.timezone, now);
  return db.applyJob.count({
    where: { userId, OR: [{ submittedAt: { gte: since } }, { status: { in: ["awaiting-confirmation"] }, finishedAt: { gte: since } }, { status: "running", startedAt: { gte: since } }] },
  });
}

export async function capInfo(userId: string, now = new Date()) {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const cap = settings?.applyDailyCap ?? 25;
  const used = await capUsedToday(userId, now);
  return { cap, used, remaining: Math.max(0, cap - used) };
}

export interface ApplyCandidate {
  jobId: string;
  title: string;
  company: string;
  score: number;
  /** country priority: 0 = your first country */
  priority: number;
  needsReview: boolean;
}
export interface ApplyPreview {
  matched: number;
  candidates: ApplyCandidate[];
  skipped: { reason: string; count: number }[];
  needsReview: number;
  estimatedMinutes: number;
  cap: { cap: number; used: number; remaining: number };
  daysNeeded: number;
  description: string;
}

/** Which of the jobs matching these filters can be queued, and why the rest can't. */
export async function previewApplyAll(userId: string, filters: FeedFilters, opts: { policy?: "review" | "auto"; rows?: FeedRow[] } = {}): Promise<ApplyPreview> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const rows = opts.rows ?? (await feedRows(userId, filters));
  const hasPassword = !!decryptSecret(settings?.encryptedAppPassword);
  const prio = priorityFrom(settings);
  const existingQueue = new Map((await db.applyJob.findMany({ where: { userId, jobId: { in: rows.map((r) => r.jobId) } } })).map((q) => [q.jobId, q]));
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const candidates: ApplyCandidate[] = [];
  for (const r of rows) {
    const q = existingQueue.get(r.jobId);
    if (q && q.status !== "failed" && q.status !== "skipped" && q.status !== "stopped") {
      skip(q.status === "submitted" ? "Already applied" : "Already in the queue");
      continue;
    }
    if (r.eligibility === "Ineligible") {
      skip("Not eligible (citizenship, location or sponsorship)");
      continue;
    }
    if (!r.job.applyUrl) {
      skip("No employer apply link");
      continue;
    }
    const support = atsSupport(r.job.atsType, hasPassword);
    if (support.level === "unsupported") {
      skip(`Unsupported application system (${r.job.atsType})`);
      continue;
    }
    if (support.level === "needs-password") {
      skip("Workday – set an application password in Settings");
      continue;
    }
    const dup = await checkDuplicates(userId, r.jobId);
    if (dup.blocked) {
      skip(dup.messages.find((m) => m.level === "block")?.text.match(/already applied|pending application|different URL/i) ? "Already applied / duplicate" : "Company limit or interview pause");
      continue;
    }
    candidates.push({ jobId: r.jobId, title: r.job.title, company: r.job.company.name, score: r.score, priority: rowPriority(r, prio).rank, needsReview: (opts.policy ?? settings?.defaultSubmitPolicy ?? "review") === "review" || r.eligibility === "Needs review" });
  }
  const cap = await capInfo(userId);
  return {
    matched: rows.length,
    candidates,
    skipped: Array.from(skipped.entries()).map(([reason, count]) => ({ reason, count })),
    needsReview: candidates.filter((c) => c.needsReview).length,
    estimatedMinutes: candidates.length * MINUTES_PER_APPLICATION,
    cap,
    daysNeeded: candidates.length ? Math.max(1, Math.ceil(Math.max(0, candidates.length - cap.remaining) / Math.max(1, cap.cap)) + (cap.remaining > 0 ? 1 : 0)) : 0,
    description: describeFilters(filters),
  };
}

export async function enqueue(userId: string, candidates: ApplyCandidate[], opts: { policy: "review" | "auto"; source: "apply-all" | "watch" | "manual"; savedSearchId?: string | null }) {
  let n = 0;
  for (const c of candidates) {
    const existing = await db.applyJob.findUnique({ where: { userId_jobId: { userId, jobId: c.jobId } } });
    if (existing && !["failed", "skipped", "stopped"].includes(existing.status)) continue;
    const data = { status: "queued", score: c.score, priority: c.priority ?? 1000, policy: opts.policy, source: opts.source, savedSearchId: opts.savedSearchId ?? null, reason: null, notBefore: new Date(), log: JSON.stringify([{ at: new Date().toISOString(), msg: `Queued (${opts.source}).` }]) };
    if (existing) await db.applyJob.update({ where: { id: existing.id }, data });
    else await db.applyJob.create({ data: { userId, jobId: c.jobId, ...data } });
    n++;
  }
  return n;
}

export async function applyToAll(userId: string, filters: FeedFilters, opts: { policy?: "review" | "auto" } = {}) {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const policy = opts.policy ?? ((settings?.defaultSubmitPolicy as "review" | "auto") || "review");
  const preview = await previewApplyAll(userId, filters, { policy });
  const queued = await enqueue(userId, preview.candidates, { policy, source: "apply-all" });
  await logActivity(userId, `Apply to all: ${queued} job(s) queued`, `${preview.description} · ${policy === "auto" ? "auto submit" : "review before submit"}`, false);
  return { ...preview, queued };
}

// ---------------------------------------------------------------- "Keep applying to new matches"
export async function saveWatcher(
  userId: string,
  filters: FeedFilters,
  opts: { name?: string; policy?: "review" | "auto"; intervalMin?: number; profileId?: string | null; minBand?: string },
) {
  const count = await db.savedSearch.count({ where: { userId } });
  if (count >= 5) throw new Error("You already have 5 saved searches – delete one on the Auto mode page first.");
  const profile = opts.profileId ?? (await db.profile.findFirst({ where: { userId, isDefault: true } }))?.id ?? null;
  const s = await db.savedSearch.create({
    data: {
      userId,
      name: (opts.name || `Keep applying: ${describeFilters(filters)}`).slice(0, 120),
      autoApply: true,
      enabled: true,
      filters: JSON.stringify(filters),
      checkIntervalMin: Math.min(360, Math.max(15, opts.intervalMin ?? 60)),
      submitPolicy: opts.policy ?? "review",
      profileId: profile,
      minBand: opts.minBand ?? filters.band ?? "Good",
      sponsorshipNeeded: !!filters.sponsorship,
      locations: JSON.stringify(filters.countries ?? []),
      lastCheckedAt: new Date(),
    },
  });
  await logActivity(userId, `Keep applying ON: ${s.name}`, `checks every ${s.checkIntervalMin} min`, false);
  return s;
}

/**
 * Check watched searches: new jobs (added since the last check) that match the
 * saved filters are queued automatically. Non-matching jobs are left alone.
 */
export async function runWatchers(opts: { now?: Date; force?: boolean; userId?: string } = {}) {
  const now = opts.now ?? new Date();
  const searches = await db.savedSearch.findMany({ where: { autoApply: true, enabled: true, ...(opts.userId ? { userId: opts.userId } : {}) } });
  let queued = 0;
  for (const s of searches) {
    const due = opts.force || !s.lastCheckedAt || now.getTime() - s.lastCheckedAt.getTime() >= s.checkIntervalMin * 60_000;
    if (!due) continue;
    const filters = { ...parseJson<FeedFilters>(s.filters, {}), band: s.minBand !== "Stretch" ? s.minBand : "Moderate" };
    const rows = await feedRows(s.userId, filters, { since: s.lastCheckedAt ?? new Date(0) });
    if (rows.length) {
      const preview = await previewApplyAll(s.userId, filters, { policy: s.submitPolicy as "review" | "auto", rows });
      const n = await enqueue(s.userId, preview.candidates, { policy: s.submitPolicy as "review" | "auto", source: "watch", savedSearchId: s.id });
      queued += n;
      if (n) await logActivity(s.userId, `Keep applying: ${n} new match(es) queued`, s.name);
    }
    await db.savedSearch.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
  }
  return queued;
}

export async function setWatcher(userId: string, id: string, on: boolean) {
  await db.savedSearch.updateMany({ where: { id, userId }, data: { enabled: on, ...(on ? { lastCheckedAt: new Date() } : {}) } });
  if (!on) {
    // stop new jobs from this watcher; already submitted ones stay submitted
    await db.applyJob.updateMany({ where: { userId, savedSearchId: id, status: "queued" }, data: { status: "stopped", reason: "Keep applying was turned off" } });
  }
  await logActivity(userId, `Keep applying ${on ? "ON" : "OFF"}`, id, false);
}

export async function queueOverview(userId: string) {
  const [upNext, recent, counts, cap] = await Promise.all([
    db.applyJob.findMany({ where: { userId, status: { in: ["queued", "running", "approved"] } }, orderBy: [{ status: "asc" }, { priority: "asc" }, { score: "desc" }], take: 8, include: { job: { include: { company: true } } } }),
    db.applyJob.findMany({ where: { userId, status: { in: ["submitted", "awaiting-confirmation"] } }, orderBy: { finishedAt: "desc" }, take: 10, include: { job: { include: { company: true } } } }),
    db.applyJob.groupBy({ by: ["status"], where: { userId }, _count: true }),
    capInfo(userId),
  ]);
  return { upNext, recent, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>, cap };
}
