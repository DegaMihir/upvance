/**
 * Auto mode (opt-in). One run of a saved search:
 *   discover → filter → score → check daily cap → prepare documents → validate → queue
 * Nothing is submitted automatically: no supported platform permits it, so
 * everything ends up in "Ready for assisted apply" (or "Needs you").
 */
import type { SavedSearch } from "@prisma/client";
import { db } from "../db";
import { parseJson } from "../utils";
import { normalizeCompany } from "../text";
import { decryptSecret } from "../crypto";
import { logActivity } from "../activity";
import { startOfLocalDay } from "../time";
import { evaluateJob, loadUserContext, recomputeMatches } from "../matching";
import { bandMin } from "../matching/scoring";
import { analysisOf } from "../matching";
import { checkDuplicates } from "../duplicates";
import { createApplication, prepareApplication, DuplicateError } from "../applications";
import { ingestJobs } from "../jobs/ingest";
import { refreshCompanyBoard } from "../jobs/refresh";
import { fetchRemotive } from "../sources";

export const MAX_SAVED_SEARCHES = 5;
export const FRESH_HOURS = 48;
export const RUN_HOURS: Record<number, number[]> = { 1: [9], 2: [9, 15], 3: [8, 13, 18], 4: [8, 12, 16, 20] };

const REMOTE = ["Worldwide", "Country-only", "Region", "Remote (unspecified)"];
const LEVELS: Record<string, string[]> = {
  entry: ["Intern", "Junior", "Unknown"],
  mid: ["Junior", "Mid", "Unknown"],
  senior: ["Mid", "Senior", "Lead", "Unknown"],
  lead: ["Senior", "Lead", "Principal", "Manager", "Director", "Unknown"],
};

/** Submission through official APIs only where the platform permits it. None of the supported ones do for candidates. */
export function canAutoSubmit(_ats: string): { allowed: false; reason: string } {
  return { allowed: false, reason: "No supported job platform offers an official candidate-side submission API, so it goes to “Ready for assisted apply”." };
}

/** Auto-mode applications created today (user's time zone). Failed ones don't count. */
export async function autoCountToday(userId: string, tz: string, now = new Date()) {
  return db.application.count({ where: { userId, origin: "auto", failed: false, createdAt: { gte: startOfLocalDay(tz, now) } } });
}

export interface RunResult {
  runId: string | null;
  discovered: number;
  filtered: number;
  scored: number;
  queued: number;
  skipped: number;
  stoppedReason: string | null;
  log: string[];
}

export function matchesSearch(search: SavedSearch, job: Parameters<typeof analysisOf>[0]) {
  const a = analysisOf(job);
  const text = `${job.title}\n${job.description}`.toLowerCase();
  const title = job.title.toLowerCase();
  const inc = parseJson<string[]>(search.includeKeywords, []).map((s) => s.toLowerCase());
  const exc = parseJson<string[]>(search.excludeKeywords, []).map((s) => s.toLowerCase());
  const locs = parseJson<string[]>(search.locations, []).map((s) => s.toUpperCase());
  const types = parseJson<string[]>(search.jobTypes, []);
  const cInc = parseJson<string[]>(search.companyInclude, []).map(normalizeCompany);
  const cExc = parseJson<string[]>(search.companyExclude, []).map(normalizeCompany);
  const isRemote = REMOTE.includes(a.remote.category);
  const jobCountries = a.remote.countries.length ? a.remote.countries : a.locationCountries;

  if (inc.length && !inc.some((k) => (k.length <= 4 ? title : text).includes(k))) return "no include keyword";
  if (exc.some((k) => title.includes(k))) return "excluded keyword in title";
  if (cInc.length && !cInc.includes(job.company.normalizedName)) return "company not in include list";
  if (cExc.includes(job.company.normalizedName)) return "company excluded";
  if (search.remotePreference === "remote" && !isRemote) return "not remote";
  if (search.remotePreference === "onsite" && isRemote) return "remote job";
  if (search.remotePreference === "hybrid" && a.remote.category !== "Hybrid") return "not hybrid";
  if (locs.length && !(a.remote.category === "Worldwide" || jobCountries.some((c) => locs.includes(c)))) return "location not in search";
  if (types.length && a.employmentType && !types.includes(a.employmentType)) return "job type";
  if (search.experienceLevel !== "any" && LEVELS[search.experienceLevel] && !LEVELS[search.experienceLevel].includes(a.seniority)) return "experience level";
  if (search.sponsorshipNeeded && !["Confirmed", "Likely"].includes(job.sponsorshipCategory)) {
    return "sponsorship not confirmed/likely";
  }
  return null;
}

export async function runSavedSearch(
  searchId: string,
  opts: { trigger?: "schedule" | "manual"; slot?: string; now?: Date; network?: boolean; log?: (s: string) => void } = {},
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const search = await db.savedSearch.findUniqueOrThrow({ where: { id: searchId }, include: { user: { include: { settings: true } } } });
  const userId = search.userId;
  const tz = search.user.timezone;
  const res: RunResult = { runId: null, discovered: 0, filtered: 0, scored: 0, queued: 0, skipped: 0, stoppedReason: null, log: [] };
  const say = (s: string) => {
    res.log.push(s);
    opts.log?.(`[${search.name}] ${s}`);
  };

  const autoOn = async () => (await db.userSettings.findUnique({ where: { userId } }))?.autoModeEnabled === true;
  if (!(await autoOn()) && opts.trigger !== "manual") {
    res.stoppedReason = "Auto mode is off.";
    return res;
  }
  if (!search.enabled && opts.trigger !== "manual") {
    res.stoppedReason = "This saved search is paused.";
    return res;
  }

  const slot = opts.slot ?? `manual-${now.toISOString()}`;
  let run;
  try {
    run = await db.autoRun.create({ data: { savedSearchId: searchId, slot, trigger: opts.trigger ?? "schedule", startedAt: now } });
  } catch {
    res.stoppedReason = "Already ran in this time slot.";
    return res;
  }
  res.runId = run.id;

  try {
    // 1. Discover (official APIs only)
    if (opts.network !== false) {
      const followed = await db.followedCompany.findMany({ where: { userId }, include: { company: true } });
      for (const f of followed) {
        if (f.company.lastFetchedAt && now.getTime() - f.company.lastFetchedAt.getTime() < 3 * 3_600_000) continue;
        try {
          await refreshCompanyBoard(f.companyId);
        } catch (e) {
          say(`Board refresh failed for ${f.company.name}: ${(e as Error).message}`);
        }
      }
      const kw = parseJson<string[]>(search.includeKeywords, [])[0];
      if (kw) {
        try {
          const r = await ingestJobs((await fetchRemotive(kw, 40)).filter((j) => j.title.toLowerCase().includes(kw.toLowerCase().split(" ")[0])));
          say(`Remotive: ${r.created} new job(s).`);
        } catch (e) {
          say(`Remotive unavailable: ${(e as Error).message}`);
        }
      }
    }
    const since = new Date(now.getTime() - FRESH_HOURS * 3_600_000);
    const fresh = await db.job.findMany({
      where: { isActive: true, OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }] },
      include: { company: true },
    });
    res.discovered = fresh.length;
    say(`Discovered ${fresh.length} job(s) posted in the last ${FRESH_HOURS} hours.`);

    // 2. Filter (free, no AI)
    const settings = search.user.settings;
    const hasAppPassword = !!decryptSecret(settings?.encryptedAppPassword);
    const pauses = await db.companyPause.findMany({ where: { userId, until: { gt: now } } });
    const paused = new Set(pauses.map((p) => p.companyId));
    const excludedCompanies = new Set(parseJson<string[]>(settings?.excludedCompanies, []).map(normalizeCompany));
    const candidates = [];
    for (const job of fresh) {
      const why =
        matchesSearch(search, job) ??
        (excludedCompanies.has(job.company.normalizedName) ? "company excluded in settings" : null) ??
        (paused.has(job.companyId) ? "company paused after an interview" : null) ??
        (job.atsType === "workday" && !hasAppPassword ? "Workday job skipped – set an application password in Settings" : null) ??
        (["linkedin", "indeed"].includes(job.atsType) ? "platform not supported for applications" : null);
      if (why) {
        res.skipped++;
        if (/Workday|paused/.test(why)) say(`Skipped “${job.title}” at ${job.company.name}: ${why}.`);
        continue;
      }
      candidates.push(job);
    }
    res.filtered = candidates.length;

    // 3. Score with this search's resume profile
    const ctx = await loadUserContext(userId, search.profileId);
    if (!ctx.candidate || !ctx.profile) throw new Error("No resume profile for this search.");
    const minScore = bandMin(search.minBand);
    const scored = candidates
      .map((job) => ({ job, ev: evaluateJob(job, ctx.candidate!, ctx.prefs, ctx.weights) }))
      .filter(({ ev }) => ev.eligibility.status !== "Ineligible" && ev.score >= minScore)
      .sort((a, b) => b.ev.score - a.ev.score);
    res.scored = scored.length;
    await recomputeMatches(userId, candidates.map((c) => c.id));
    say(`${scored.length} job(s) eligible and at or above “${search.minBand}”.`);

    // 4–6. Cap → prepare → validate → queue
    for (const { job, ev } of scored) {
      if (opts.trigger !== "manual" && !(await autoOn())) {
        res.stoppedReason = "Auto mode was turned off – stopped.";
        break;
      }
      const cap = (await db.userSettings.findUnique({ where: { userId } }))?.dailyCap ?? 10;
      const used = await autoCountToday(userId, tz, now);
      if (used >= cap) {
        res.stoppedReason = `Daily cap reached (${used}/${cap}).`;
        break;
      }
      const dup = await checkDuplicates(userId, job.id);
      if (dup.blocked) {
        res.skipped++;
        continue;
      }
      try {
        const app = await createApplication(userId, job.id, { profileId: search.profileId, origin: "auto", savedSearchId: search.id });
        const v = await prepareApplication(app.id, userId, { useAI: true });
        const submit = canAutoSubmit(job.atsType);
        res.queued++;
        say(`Prepared “${job.title}” at ${job.company.name} (score ${ev.score}) → ${v.status === "Ready" ? "Ready for assisted apply" : "Needs you"}. ${submit.allowed ? "" : ""}`.trim());
        await logActivity(userId, `Auto mode prepared an application: ${job.title} at ${job.company.name}`, `Search “${search.name}”, score ${ev.score}, status ${v.status}`);
      } catch (e) {
        if (e instanceof DuplicateError) {
          res.skipped++;
          continue;
        }
        say(`Failed to prepare “${job.title}”: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    res.stoppedReason = `Error: ${(e as Error).message}`;
  }

  await db.autoRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), discovered: res.discovered, filtered: res.filtered, scored: res.scored, queued: res.queued, skipped: res.skipped, stoppedReason: res.stoppedReason, log: JSON.stringify(res.log.slice(-60)) },
  });
  await db.savedSearch.update({ where: { id: searchId }, data: { lastRunAt: now } });
  await logActivity(userId, `Auto mode run: ${search.name}`, `discovered ${res.discovered}, filtered ${res.filtered}, eligible ${res.scored}, queued ${res.queued}${res.stoppedReason ? ` – ${res.stoppedReason}` : ""}`);
  return res;
}
