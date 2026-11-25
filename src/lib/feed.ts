/**
 * Feed filters – one definition shared by the job feed, "Apply to all",
 * "Keep applying to new matches" watchers and the assistant.
 */
import type { Company, Job, Match, UserSettings } from "@prisma/client";
import { parseJson } from "./utils";
import { bandMin } from "./matching/scoring";
import { normalizeCompany } from "./text";
import { analysisOf } from "./matching";
import { roleFamily } from "./insights";
import type { JobAnalysis } from "./analysis/types";
import { fairRemotePay, payCheck } from "./matching/pay";
import { countryPriority } from "./matching/priority";
import { fitsTargets, titleKeywords } from "./matching/titles";

const keyCache = new Map<string, string[][]>();
/** Key words of your target roles (cached – passes() runs once per job). */
export function targetKeys(targetTitles?: string | null): string[][] {
  const raw = targetTitles ?? "[]";
  if (!keyCache.has(raw)) keyCache.set(raw, titleKeywords(parseJson<string[]>(raw, [])));
  return keyCache.get(raw)!;
}
import { codes } from "./matching/candidate";

export * from "./feed-filters";
import type { FeedFilters } from "./feed-filters";

const REMOTE = ["Worldwide", "Country-only", "Region", "Remote (unspecified)"];

export function degreeLevel(a: Pick<JobAnalysis, "degree">): "none" | "bachelor" | "master" | "phd" {
  const d = (a.degree ?? "").toLowerCase();
  if (!d) return "none";
  if (/ph\.?d|doctor/.test(d)) return "phd";
  if (/master|m\.?sc|\bms\b|mba/.test(d) && !/bachelor/.test(d)) return "master";
  return "bachelor";
}
const DEGREE_RANK = { none: 0, bachelor: 1, master: 2, phd: 3 } as const;

export type FeedRow = Match & { job: Job & { company: Company } };

/** Does one job/match pass the filters? (Hard eligibility handled via `eligibility`.) */
export function passes(m: FeedRow, f: FeedFilters, settings?: (Pick<UserSettings, "sponsorshipRequired" | "strictSponsorship"> & Partial<Pick<UserSettings, "minSalary" | "salaryCurrency" | "targetTitles">>) | null, now = Date.now()): boolean {
  const j = m.job;
  const a = analysisOf(j);
  const text = `${j.title} ${j.company.name}`.toLowerCase();
  const strict = f.strict ?? settings?.strictSponsorship ?? false;
  if (!f.skipped && m.status === "skipped") return false;
  if (f.saved && m.status !== "saved") return false;
  if (f.q && !f.q.toLowerCase().split(/\s+/).every((w) => text.includes(w))) return false;
  if (f.source && j.source !== f.source) return false;
  const elig = f.eligibility ?? "default";
  if (elig === "default" && m.eligibility === "Ineligible") return false;
  if (elig === "eligible" && m.eligibility !== "Eligible") return false;
  if (elig === "review" && m.eligibility !== "Needs review") return false;
  if (elig === "ineligible" && m.eligibility !== "Ineligible") return false;
  if (f.posted && j.postedAt && now - j.postedAt.getTime() > f.posted * 86_400_000) return false;
  if (f.countries?.length) {
    const cs = [...parseJson<string[]>(j.remoteCountries, []), ...(a.locationCountries ?? [])];
    if (!(j.remoteCategory === "Worldwide" && f.workplace?.includes("remote")) && !cs.some((c) => f.countries!.includes(c))) return false;
  }
  if (f.workplace?.length) {
    const kind = REMOTE.includes(j.remoteCategory) ? "remote" : j.remoteCategory === "Hybrid" ? "hybrid" : ["Onsite", "Relocation required"].includes(j.remoteCategory) ? "onsite" : "unknown";
    if (!f.workplace.includes(kind as "remote")) return false;
  }
  if (f.companies?.length && !f.companies.includes(j.company.normalizedName) && !f.companies.map(normalizeCompany).includes(j.company.normalizedName)) return false;
  if (f.degree && DEGREE_RANK[degreeLevel(a)] > DEGREE_RANK[f.degree]) return false;
  if (f.maxExp != null && a.experienceYears?.min != null && a.experienceYears.min > f.maxExp) return false;
  if (f.sponsorship) {
    const ok = strict ? ["Confirmed", "Likely"] : ["Confirmed", "Likely", "Case-by-Case", "Unknown"];
    if (!ok.includes(j.sponsorshipCategory) && m.eligibility !== "Eligible") return false;
  }
  if (f.noClearance && (a.workAuth.securityClearance || /clearance/i.test(j.title))) return false;
  if (f.targetRoles ?? !!targetKeys(settings?.targetTitles).length) {
    const keys = targetKeys(settings?.targetTitles);
    if (keys.length && !fitsTargets(j.title, keys)) return false;
  }
  if (f.fairPay && !fairRemotePay(payCheck(j, a, { minSalary: settings?.minSalary ?? null, salaryCurrency: settings?.salaryCurrency }))) return false;
  if (f.roles?.length && !f.roles.includes(roleFamily(j.title))) return false;
  if (f.level?.length && !f.level.includes(a.seniority)) return false;
  if (f.employment?.length && !f.employment.includes((a.employmentType ?? j.employmentType ?? "full-time").toLowerCase())) return false;
  if (f.pay && (j.salaryMax ?? j.salaryMin ?? 0) < f.pay) return false;
  if (f.exclude?.length && f.exclude.some((w) => text.includes(w.toLowerCase()))) return false;
  if (f.band && m.score < bandMin(f.band)) return false;
  return true;
}

/** Your countries in priority order (ISO codes) and how many are Tier 1. */
export function priorityFrom(settings?: Pick<UserSettings, "targetCountries" | "tier1Count"> | null) {
  return { order: codes(parseJson<string[]>(settings?.targetCountries, [])), tier1Count: settings?.tier1Count ?? 0 };
}

/** Country priority of one feed row (memoised per call of sortRows). */
export function rowPriority(r: FeedRow, p: { order: string[]; tier1Count: number }) {
  return countryPriority(r.job, analysisOf(r.job), p.order, p.tier1Count);
}

/**
 * Sort the feed. "priority" (the default when you have target countries): your countries in the
 * order you listed them, best match first within each country. "score": best match overall.
 * "date": newest first. Ineligible jobs always go last (except for "date").
 */
export function sortRows(rows: FeedRow[], f: FeedFilters, priority?: { order: string[]; tier1Count: number }) {
  const mode = f.sort ?? (priority?.order.length ? "priority" : "score");
  const rank = new Map<string, number>();
  if (mode === "priority" && priority) for (const r of rows) rank.set(r.jobId, rowPriority(r, priority).rank);
  const inel = (r: FeedRow) => (r.eligibility === "Ineligible" ? 1 : 0);
  return rows.sort((a, b) =>
    mode === "date"
      ? (b.job.postedAt?.getTime() ?? 0) - (a.job.postedAt?.getTime() ?? 0)
      : inel(a) - inel(b) || (mode === "priority" ? (rank.get(a.jobId) ?? 0) - (rank.get(b.jobId) ?? 0) : 0) || b.score - a.score,
  );
}
