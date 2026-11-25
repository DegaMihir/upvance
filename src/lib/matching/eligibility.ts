/**
 * Hard eligibility rules. These override the score: a job can score 95 and
 * still be "Ineligible" (e.g. it requires a citizenship you don't hold).
 */
import { COUNTRIES, countryInRegion, countryName } from "../countries";
import type { JobAnalysis, SponsorshipCategory } from "../analysis/types";
import type { Candidate } from "./candidate";

export type EligibilityStatus = "Eligible" | "Needs review" | "Ineligible";

export interface EligibilityResult {
  status: EligibilityStatus;
  reasons: string[]; // why ineligible / why review needed
  notes: string[]; // positive explanations
  needsSponsorshipFor: string[]; // countries where the candidate would need a visa
}

const EU = new Set(Object.entries(COUNTRIES).filter(([, c]) => c.region.includes("EU")).map(([k]) => k));

export function canWorkIn(c: Candidate, country: string): boolean {
  if (c.citizenship.includes(country) || c.workAuthorizations.includes(country)) return true;
  if (EU.has(country) && (c.workAuthorizations.includes("EU") || c.citizenship.some((x) => EU.has(x)))) return true;
  return false;
}

export function eligibilityFor(c: Candidate, a: JobAnalysis, sponsorship: SponsorshipCategory): EligibilityResult {
  const reasons: string[] = [];
  const review: string[] = [];
  const notes: string[] = [];
  const needsSponsorshipFor: string[] = [];
  const jobCountries = a.remote.countries.length ? a.remote.countries : a.locationCountries;
  const here = c.currentCountry;

  // --- Citizenship / clearance / permanent residency ---
  for (const country of a.workAuth.citizenshipRequired) {
    if (country === "ANY_LOCAL") {
      if (!jobCountries.length) review.push("The job mentions a citizenship requirement but the country is unclear.");
      else if (!jobCountries.some((jc) => c.citizenship.includes(jc)))
        reasons.push(`Requires ${jobCountries.map(countryName).join("/")} citizenship, which your profile doesn't list.`);
      continue;
    }
    if (!c.citizenship.includes(country)) reasons.push(`Requires ${countryName(country)} citizenship${a.workAuth.securityClearance ? " (security clearance)" : ""}, which your profile doesn't list.`);
  }
  if (a.workAuth.permanentResidencyRequired) {
    const targets = jobCountries.length ? jobCountries : [];
    if (!targets.length) review.push("Requires permanent residency; the country is unclear.");
    else if (!targets.some((t) => canWorkIn(c, t) && (c.citizenship.includes(t) || c.workAuthorizations.includes(t))))
      reasons.push(`Requires permanent residency / green card in ${targets.map(countryName).join("/")}.`);
  }
  for (const req of a.workAuth.existingAuthRequired) {
    if (req === "ANY_LOCAL") {
      if (jobCountries.length && !jobCountries.some((jc) => canWorkIn(c, jc)))
        reasons.push(`Requires existing right to work in ${jobCountries.map(countryName).join("/")} (no sponsorship).`);
      else if (!jobCountries.length) review.push("Requires existing work authorization; country unclear.");
      continue;
    }
    if (req === "EU") {
      if (!c.workAuthorizations.includes("EU") && !c.citizenship.some((x) => EU.has(x))) reasons.push("Requires existing right to work in the EU.");
      continue;
    }
    if (!canWorkIn(c, req)) reasons.push(`Requires existing right to work in ${countryName(req)} (no sponsorship).`);
  }

  // --- Location / remote ---
  const cat = a.remote.category;
  if (cat === "Worldwide") {
    notes.push("Remote worldwide – your location is accepted.");
  } else if (cat === "Country-only") {
    const ok = here && a.remote.countries.includes(here);
    if (!ok) {
      reasons.push(
        `Remote only for people based in ${a.remote.countries.map(countryName).join("/")}; you're based in ${here ? countryName(here) : "an unknown country"}.`,
      );
    } else if (!canWorkIn(c, here!)) {
      review.push(`You're based in ${countryName(here!)} but your profile doesn't confirm the right to work there.`);
    } else notes.push(`Remote in ${countryName(here!)}, where you're based.`);
  } else if (cat === "Region") {
    const ok = here && a.remote.regions.some((r) => countryInRegion(here, r));
    if (!ok) reasons.push(`Remote only within ${a.remote.regions.join("/")}; you're based in ${here ? countryName(here) : "an unknown country"}.`);
    else notes.push(`Remote within ${a.remote.regions.join("/")}, which includes ${countryName(here!)}.`);
  } else if (cat === "Remote (unspecified)") {
    review.push("Says “remote” but doesn't state which countries are allowed. A job is not eligible just because it says remote.");
  } else if (cat === "Onsite" || cat === "Hybrid" || cat === "Relocation required") {
    if (!jobCountries.length) {
      review.push("The job's country is unclear.");
    } else {
      const workable = jobCountries.filter((jc) => canWorkIn(c, jc));
      if (workable.length) {
        notes.push(`You can already work in ${workable.map(countryName).join("/")}.`);
        if (here && !workable.includes(here) && !c.willingToRelocate) reasons.push(`${cat} in ${workable.map(countryName).join("/")} and you're not open to relocating.`);
      } else {
        needsSponsorshipFor.push(...jobCountries);
        const relocOk = c.willingToRelocate && (!c.relocationCountries.length || jobCountries.some((jc) => c.relocationCountries.includes(jc)));
        if (here && !jobCountries.includes(here) && !relocOk) reasons.push(`${cat} in ${jobCountries.map(countryName).join("/")} and you're not open to relocating there.`);
        if (sponsorship === "No Sponsorship") reasons.push(`No visa sponsorship, and you'd need a visa for ${jobCountries.map(countryName).join("/")}.`);
        else if (sponsorship === "Unknown") review.push(`Sponsorship is unknown and you'd need a visa for ${jobCountries.map(countryName).join("/")}.`);
        else if (sponsorship === "Case-by-Case") review.push("Sponsorship is decided case by case – worth asking the recruiter.");
        else notes.push(`Visa sponsorship: ${sponsorship.toLowerCase()} for ${jobCountries.map(countryName).join("/")}.`);
      }
    }
  } else {
    review.push("Work location / remote policy is unclear.");
  }

  const status: EligibilityStatus = reasons.length ? "Ineligible" : review.length ? "Needs review" : "Eligible";
  return { status, reasons: reasons.length ? reasons : review, notes, needsSponsorshipFor: Array.from(new Set(needsSponsorshipFor)) };
}
