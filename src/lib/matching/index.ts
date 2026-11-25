import type { Job, Company, Profile, UserSettings } from "@prisma/client";
import { db } from "../db";
import { parseJson } from "../utils";
import { normalizeCompany } from "../text";
import { analyzeWithRules } from "../analysis/rules";
import type { JobAnalysis, SponsorshipCategory } from "../analysis/types";
import { candidateFromProfile, preferencesFromSettings, type Candidate, type Preferences } from "./candidate";
import { eligibilityFor, type EligibilityResult } from "./eligibility";
import { bandFor, scoreJob, type ScoreResult, type Weights } from "./scoring";
import { payCheck } from "./pay";

export function analysisOf(job: Job & { company: Company }): JobAnalysis {
  const a = parseJson<JobAnalysis | null>(job.analysis, null);
  if (a && a.version) return a;
  return analyzeWithRules({ title: job.title, company: job.company.name, location: job.location, description: job.description, atsType: job.atsType });
}

export interface JobEvaluation extends ScoreResult {
  eligibility: EligibilityResult;
  analysis: JobAnalysis;
}

export function evaluateJob(
  job: Job & { company: Company },
  candidate: Candidate,
  prefs: Preferences,
  weights?: Partial<Weights>,
): JobEvaluation {
  const analysis = analysisOf(job);
  const sponsorship = (job.sponsorshipCategory as SponsorshipCategory) || analysis.sponsorship.category;
  const eligibility = eligibilityFor(candidate, analysis, sponsorship);
  const score = scoreJob({ candidate, analysis, sponsorship, eligibility, postedAt: job.postedAt, weights, remotePreference: prefs.remotePreference, targetTitles: prefs.targetTitles });
  if (prefs.remotePayParity !== false) {
    // Your strategy: remote jobs must pay what the job pays on-site, not a rate cut to where you live.
    const pay = payCheck(job, analysis, prefs);
    if (pay.issues.length) {
      score.score = Math.round(score.score * 0.85);
      score.band = bandFor(score.score);
      score.whyNot = [...score.whyNot, ...pay.issues];
    }
    if (pay.good.length) score.whyMatch = [...score.whyMatch, ...pay.good];
  }
  return { ...score, eligibility, analysis };
}

export async function getDefaultProfile(userId: string): Promise<Profile | null> {
  return (await db.profile.findFirst({ where: { userId, isDefault: true } })) ?? (await db.profile.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }));
}

export async function loadUserContext(userId: string, profileId?: string | null) {
  const [settings, profile] = await Promise.all([
    db.userSettings.findUnique({ where: { userId } }),
    profileId ? db.profile.findFirst({ where: { id: profileId, userId } }) : getDefaultProfile(userId),
  ]);
  return {
    settings,
    profile,
    candidate: profile ? candidateFromProfile(profile) : null,
    prefs: preferencesFromSettings(settings),
    weights: parseJson<Partial<Weights>>(settings?.scoringWeights, {}),
  };
}

/** Recompute and store matches for a user (all active jobs, or a subset). */
export async function recomputeMatches(userId: string, jobIds?: string[]) {
  const ctx = await loadUserContext(userId);
  if (!ctx.profile || !ctx.candidate) return 0;
  const jobs = await db.job.findMany({ where: { isActive: true, ...(jobIds ? { id: { in: jobIds } } : {}) }, include: { company: true } });
  const excluded = new Set(ctx.prefs.excludedCompanies.map(normalizeCompany));
  let n = 0;
  for (const job of jobs) {
    const ev = evaluateJob(job, ctx.candidate, ctx.prefs, ctx.weights);
    const isExcluded = excluded.has(job.company.normalizedName);
    const data = {
      profileId: ctx.profile.id,
      score: ev.score,
      band: ev.eligibility.status === "Ineligible" ? "Ineligible" : ev.band,
      breakdown: JSON.stringify(ev.breakdown),
      eligible: ev.eligibility.status !== "Ineligible",
      eligibility: ev.eligibility.status,
      reasons: JSON.stringify(ev.eligibility.reasons),
      whyMatch: JSON.stringify(ev.whyMatch),
      whyNot: JSON.stringify(ev.whyNot),
      missingSkills: JSON.stringify(ev.breakdown.missingSkills),
    };
    await db.match.upsert({
      where: { userId_jobId: { userId, jobId: job.id } },
      create: { userId, jobId: job.id, ...data, ...(isExcluded ? { status: "skipped", skipReason: "Company is on your exclusion list" } : {}) },
      update: { ...data, ...(isExcluded ? { status: "skipped", skipReason: "Company is on your exclusion list" } : {}) },
    });
    n++;
  }
  await db.match.updateMany({
    where: { userId, skipReason: "Company is on your exclusion list", job: { company: { normalizedName: { notIn: Array.from(excluded) } } } },
    data: { status: "new", skipReason: null },
  });
  return n;
}

/** Keyword/rule pre-filter: only jobs that pass this are worth spending an AI request on. */
export function worthAiAnalysis(job: Job & { company: Company }, candidate: Candidate, prefs: Preferences, settings?: UserSettings | null) {
  const ev = evaluateJob(job, candidate, prefs);
  if (ev.eligibility.status === "Ineligible") return { ok: false, reason: "Hard eligibility rule failed" };
  if (ev.score < 45) return { ok: false, reason: `Rule score ${ev.score} too low` };
  const titles = prefs.targetTitles.map((t) => t.toLowerCase());
  if (titles.length && !titles.some((t) => t.split(/\s+/).every((w) => job.title.toLowerCase().includes(w))) && ev.breakdown.matchedSkills.length < 2) {
    return { ok: false, reason: "Title doesn't match your targets" };
  }
  void settings;
  return { ok: true, reason: "" };
}
