/**
 * Country priority: your target countries in the order you listed them (Tier 1 first, then
 * Tier 2). Jobs are shown and applied to in that order – all eligible jobs in your first country,
 * best match first, then the next country, and so on. Jobs outside your list come last.
 */
import { COUNTRIES } from "../countries";
import type { JobAnalysis } from "../analysis/types";

export interface CountryPriority {
  /** 0 = your first country; WORLDWIDE_RANK for remote-anywhere; OTHER_RANK for anything else */
  rank: number;
  tier: 1 | 2 | null;
  country: string | null;
}

export const OTHER_RANK = 1000;

const REMOTE = ["Worldwide", "Country-only", "Region", "Remote (unspecified)"];

/** Where a job can be done from: the remote countries if remote, else its office countries. */
export function jobCountries(job: { remoteCategory?: string | null }, a: Pick<JobAnalysis, "remote" | "locationCountries">): string[] {
  const remote = REMOTE.includes(job.remoteCategory || a.remote?.category || "");
  const fromRegions = (a.remote?.regions ?? []).flatMap((r) => Object.entries(COUNTRIES).filter(([, c]) => c.region.includes(r)).map(([code]) => code));
  const remoteCountries = [...(a.remote?.countries ?? []), ...fromRegions];
  return remote && remoteCountries.length ? remoteCountries : (a.locationCountries ?? []);
}

/**
 * @param order your countries in priority order (ISO codes)
 * @param tier1Count how many of them are Tier 1 (0 = all one tier)
 */
export function countryPriority(job: { remoteCategory?: string | null }, a: Pick<JobAnalysis, "remote" | "locationCountries">, order: string[], tier1Count = 0): CountryPriority {
  if (!order.length) return { rank: 0, tier: null, country: null };
  const t1 = tier1Count > 0 && tier1Count < order.length ? tier1Count : order.length;
  const tierOf = (i: number): 1 | 2 => (i < t1 ? 1 : 2);
  const cs = jobCountries(job, a);
  let best = -1;
  for (const c of cs) {
    const i = order.indexOf(c);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best >= 0) return { rank: best, tier: tierOf(best), country: order[best] };
  // Remote from anywhere: you can do it from where you live – placed right after Tier 1.
  if ((job.remoteCategory || a.remote?.category) === "Worldwide") return { rank: t1 - 0.5, tier: null, country: null };
  return { rank: OTHER_RANK, tier: null, country: null };
}

/** Split a saved country list into the two tiers. */
export function splitTiers(order: string[], tier1Count: number) {
  const t1 = tier1Count > 0 && tier1Count < order.length ? tier1Count : order.length;
  return { tier1: order.slice(0, t1), tier2: order.slice(t1) };
}
