/**
 * Remote pay parity: a remote job should pay what the same job pays on-site in that country,
 * not a rate cut down to where you live. Rule-based and conservative – it only flags what the
 * posting actually says; "no salary listed" is never treated as unfair.
 */
import type { JobAnalysis } from "../analysis/types";

const REMOTE = ["Worldwide", "Country-only", "Region", "Remote (unspecified)"];

/** Wording that means pay depends on where the employee lives. */
const GEO_ADJUSTED = [
  /\b(pay|salary|salaries|compensation|comp|base|ranges?|offers?|wages?)\b[^.\n]{0,90}\b(based on|depend(?:s|ing)? on|var(?:y|ies|ying) (?:by|based on|depending on)|adjusted (?:for|to|by|based on)|tied to|determined by|calibrated to|scaled to|benchmarked (?:to|against))\b[^.\n]{0,60}\b(location|geograph\w*|region|country|where you (?:live|are based|reside)|cost[- ]of[- ]living|local market|market of (?:your|the candidate'?s?) location)/i,
  /\b(location|geo(?:graphic(?:al)?)?|region|country)[- ](?:based|adjusted|specific|dependent)\s+(pay|salary|salaries|compensation|ranges?|bands?)\b/i,
  /\bcost[- ]of[- ]living (?:adjust\w*|differential|index)\b/i,
  /\b(?:paid|pay|compensat\w+) (?:in|at) (?:the )?local (?:currency|market rates?|rates?)\b/i,
  /\blocal market (?:rates?|pay|salar(?:y|ies)|compensation)\b/i,
  /\b(?:different|separate|tiered) (?:pay|salary|compensation) (?:ranges|bands|tiers) (?:for|by|per) (?:each )?(?:location|country|region|zone)s?\b/i,
  /\bgeo(?:graphic)? (?:pay )?(?:zones?|tiers?)\b/i,
];

const FACTOR: Record<string, number> = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };

export interface PayCheck {
  remote: boolean;
  geoAdjusted: boolean;
  /** yearly max (or min) pay when listed in your currency */
  yearly: number | null;
  belowMinimum: boolean;
  /** listed in another currency, so not compared */
  otherCurrency: boolean;
  /** problems that break "remote pays the same" */
  issues: string[];
  /** good signs */
  good: string[];
}

export function payCheck(
  job: { description: string; salaryMin?: number | null; salaryMax?: number | null; salaryCurrency?: string | null; remoteCategory?: string | null },
  analysis: Pick<JobAnalysis, "salary" | "remote"> | null,
  prefs: { minSalary: number | null; salaryCurrency?: string | null },
): PayCheck {
  const remote = REMOTE.includes(job.remoteCategory || analysis?.remote?.category || "");
  const geoAdjusted = GEO_ADJUSTED.some((r) => r.test(job.description));
  const listed = job.salaryMax ?? job.salaryMin ?? analysis?.salary?.max ?? analysis?.salary?.min ?? null;
  const period = job.salaryMax != null || job.salaryMin != null ? "year" : (analysis?.salary?.period ?? "year");
  const currency = (job.salaryCurrency || analysis?.salary?.currency || "").toUpperCase();
  const mine = (prefs.salaryCurrency || "USD").toUpperCase();
  const otherCurrency = listed != null && !!currency && currency !== mine;
  const yearly = listed != null && !otherCurrency ? Math.round(listed * (FACTOR[period] ?? 1)) : null;
  const belowMinimum = yearly != null && prefs.minSalary != null && yearly < prefs.minSalary;
  const issues: string[] = [];
  const good: string[] = [];
  const fmt = (n: number) => `${mine} ${n.toLocaleString("en-US")}`;
  if (remote && geoAdjusted) issues.push("Remote pay is adjusted to where you live, so it may be lower than the on-site rate.");
  if (belowMinimum) issues.push(`Listed pay (up to ${fmt(yearly!)} a year) is below your minimum of ${fmt(prefs.minSalary!)}.`);
  if (remote && !geoAdjusted && yearly != null && !belowMinimum) good.push(`Remote with a stated pay range (up to ${fmt(yearly)}) and no location-based cut mentioned.`);
  return { remote, geoAdjusted, yearly, belowMinimum, otherCurrency, issues, good };
}

/** Passes the "fair remote pay" rule? (unknown pay passes – nothing in the posting says otherwise) */
export function fairRemotePay(c: PayCheck) {
  return !(c.remote && c.geoAdjusted) && !c.belowMinimum;
}
