/**
 * Employer intelligence. Every claim carries its source and a confidence level.
 */
import { db } from "./db";
import { parseJson, formatMoney, formatDate } from "./utils";
import { countryName } from "./countries";
import { sponsorHitsForCompany, SPONSOR_LISTS } from "./sponsors/lookup";
import { analysisOf } from "./matching";
import type { Confidence } from "./analysis/types";

export interface Claim {
  topic: string;
  value: string;
  source: string;
  confidence: Confidence | "unknown";
  url?: string;
}

const conf = (n: number): Confidence => (n >= 5 ? "high" : n >= 2 ? "medium" : "low");

export async function companyIntel(companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { jobs: { orderBy: { postedAt: "desc" } } } });
  const jobs = company.jobs.map((j) => ({ ...j, company }));
  const active = jobs.filter((j) => j.isActive);
  const claims: Claim[] = [];

  // Sponsorship history from official lists
  const hits = await sponsorHitsForCompany(company.name);
  if (hits.length) {
    for (const h of hits)
      claims.push({
        topic: "Sponsorship history",
        value: `Listed as “${h.name}” on the ${SPONSOR_LISTS[h.listId].name}${h.route ? ` (${h.route})` : ""} – ${countryName(h.country)}${h.isDemo ? " [demo data]" : ""}`,
        source: `${SPONSOR_LISTS[h.listId].name}, updated ${formatDate(h.lastUpdated)}`,
        confidence: h.confidence,
        url: h.sourceUrl.startsWith("http") ? h.sourceUrl : SPONSOR_LISTS[h.listId].sourceUrl,
      });
  } else {
    claims.push({ topic: "Sponsorship history", value: "Not found on any imported sponsor list (UK, US H-1B, NL, Canada LMIA)", source: "Imported official lists", confidence: "unknown" });
  }

  // Sponsorship wording in postings
  const sponsorCounts: Record<string, number> = {};
  for (const j of jobs) sponsorCounts[j.sponsorshipCategory] = (sponsorCounts[j.sponsorshipCategory] ?? 0) + 1;
  if (jobs.length)
    claims.push({
      topic: "Sponsorship in job posts",
      value: Object.entries(sponsorCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · "),
      source: `${jobs.length} job posting(s) analysed`,
      confidence: conf(jobs.length),
    });

  // Remote policy
  const remoteCounts: Record<string, number> = {};
  for (const j of jobs) remoteCounts[j.remoteCategory] = (remoteCounts[j.remoteCategory] ?? 0) + 1;
  if (jobs.length) {
    const top = Object.entries(remoteCounts).sort((a, b) => b[1] - a[1]);
    claims.push({
      topic: "Remote policy",
      value: `Mostly ${top[0][0].toLowerCase()} (${top.map(([k, v]) => `${k}: ${v}`).join(", ")})`,
      source: `${jobs.length} job posting(s)`,
      confidence: conf(jobs.length),
    });
  }

  // Hiring locations
  const locs: Record<string, number> = {};
  for (const j of jobs) {
    const a = analysisOf(j);
    for (const c of a.remote.countries.length ? a.remote.countries : a.locationCountries) locs[c] = (locs[c] ?? 0) + 1;
  }
  if (Object.keys(locs).length)
    claims.push({
      topic: "Hiring locations",
      value: Object.entries(locs)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${countryName(c)} (${n})`)
        .join(", "),
      source: `${jobs.length} job posting(s)`,
      confidence: conf(jobs.length),
    });

  // Salary information from postings
  const salaried = jobs.filter((j) => j.salaryMin || j.salaryMax);
  for (const j of salaried.slice(0, 6))
    claims.push({ topic: "Salary", value: `${j.title}: ${formatMoney(j.salaryMin, j.salaryMax, j.salaryCurrency)}`, source: `Job posting (${j.source})`, confidence: "high", url: j.sourceUrl || undefined });
  if (!salaried.length) claims.push({ topic: "Salary", value: "No salary published in the postings we have", source: "Job postings", confidence: "unknown" });

  // Size / industry / HQ
  for (const f of parseJson<{ key: string; value: string; source: string; confidence: Confidence }[]>(company.facts, [])) claims.push({ topic: f.key, value: f.value, source: f.source, confidence: f.confidence });
  if (!company.size) claims.push({ topic: "Size", value: "Unknown", source: "—", confidence: "unknown" });

  return { company, activeJobs: active, allJobs: jobs, claims, sponsorHits: hits };
}
