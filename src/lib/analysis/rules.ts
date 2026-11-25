/**
 * Rule-based job description analysis. Runs before (and without) any AI.
 * Every conclusion keeps the sentence it came from as evidence.
 */
import { extractSkills } from "../skills";
import { findCountries, findRegions, countryCode } from "../countries";
import {
  ANALYSIS_VERSION,
  type Confidence,
  type JobAnalysis,
  type RemoteCategory,
  type Seniority,
  type SponsorshipCategory,
} from "./types";

export interface JobInput {
  title: string;
  company: string;
  location?: string | null;
  description: string;
  atsType?: string | null;
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
}

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    // don't split after abbreviations like "U.S." or "e.g."
    .split(/(?<=[.!?])(?<!\b[A-Za-z]\.)(?<!\b(?:e\.g|i\.e|etc|approx|incl)\.)\s+|\n+/)
    .map((s) => s.replace(/^[•\-*·\s]+/, "").trim())
    .filter((s) => s.length > 2);
}

function findEvidence(sents: string[], re: RegExp, max = 2): string[] {
  return sents.filter((s) => re.test(s)).slice(0, max).map((s) => (s.length > 240 ? s.slice(0, 237) + "…" : s));
}

// ---------- Sponsorship ----------
const NO_SPONSOR = [
  /\b(un ?able|not able|cannot|can ?not|can't|won't|will not|do(es)? not|don't|is not able)\b[^.]{0,40}\b(sponsor|provide (visa )?sponsorship|offer (visa )?sponsorship|support visa)/i,
  /\bno (visa |work permit |immigration )?sponsorship\b/i,
  /\bsponsorship (is )?(not|un)available\b/i,
  /\bnot (eligible|offering|providing|currently sponsoring)[^.]{0,30}sponsor/i,
  /\bwithout (the )?(need for |requiring )?(current or future |now or in the future )?(visa |employer |immigration )?sponsorship\b/i,
  /\b(now or in the future|currently or in the future)\b[^.]{0,40}\bsponsor/i,
  /\bsponsor[^.]{0,30}\b(now or in the future|at this time)\b[^.]{0,20}\b(not|no)\b/i,
];
const EXISTING_EMPLOYEES = /\bsponsor\w*[^.]{0,60}\b(only|solely)\b[^.]{0,30}\b(existing|current|internal) (employees|staff|team members)|\b(existing|current) employees only\b[^.]{0,40}sponsor/i;
const CONFIRMED = [
  /\b(visa|work permit|immigration|h-?1b|skilled worker( visa)?|blue card|relocation and visa) (sponsorship|support)\b[^.]{0,30}\b(is |are )?(available|provided|offered|included)/i,
  /\bwe (will|can|do|are able to|offer to|happily|gladly) (sponsor|provide (visa )?sponsorship|offer (visa )?sponsorship)/i,
  /\b(offer|offers|offering|provide|provides|providing)\s+(full |complete )?(visa|work permit|immigration) (sponsorship|support)\b/i,
  /\bsponsorship (is )?(available|provided|offered)\b/i,
  /\bwe sponsor (visas|work permits)\b/i,
  /\b(offer|offers|offering|provide|provides|providing)\b[^.]{0,40}\b(visa|work permit|blue card|h-?1b)\b[^.]{0,15}\b(sponsorship|support)\b/i,
  /\b(we|company)\b[^.]{0,10}\bsponsors?\b[^.]{0,25}\b(h-?1b|visas?|work permits?|blue cards?)\b/i,
  /\bwill sponsor (your|the|a|successful)\b/i,
  /\b(visa|h-?1b) sponsorship\s*[:\-–]\s*(yes|available)\b/i,
];
const CASE_BY_CASE = [
  /\bcase[- ]by[- ]case\b/i,
  /\b(may|might|could) (be able to )?(consider |provide |offer )?(visa )?sponsor/i,
  /\bsponsorship (may|might|could) be (considered|available|possible)/i,
  /\bopen to sponsor(ing)?\b[^.]{0,40}\b(exceptional|right|strong)/i,
  /\bsponsorship\b[^.]{0,30}\b(depend|evaluated|considered)/i,
];
const LIKELY = [/\bvisa (assistance|support|help)\b/i, /\brelocation (package|support|assistance)\b[^.]{0,40}\b(visa|international)/i, /\binternational candidates (are )?welcome\b/i];

export function detectSponsorship(sents: string[]): JobAnalysis["sponsorship"] {
  const existingOnly = sents.some((s) => EXISTING_EMPLOYEES.test(s));
  const noEv = sents.filter((s) => NO_SPONSOR.some((r) => r.test(s)));
  const cbcEv = sents.filter((s) => CASE_BY_CASE.some((r) => r.test(s)) && /sponsor|visa/i.test(s));
  const confEv = sents.filter((s) => CONFIRMED.some((r) => r.test(s)) && !NO_SPONSOR.some((r) => r.test(s)));
  const likelyEv = sents.filter((s) => LIKELY.some((r) => r.test(s)));
  let category: SponsorshipCategory = "Unknown";
  let evidence: string[] = [];
  let confidence: Confidence = "low";
  if (existingOnly) {
    category = "No Sponsorship";
    evidence = findEvidence(sents, EXISTING_EMPLOYEES);
    confidence = "high";
  } else if (noEv.length) {
    category = "No Sponsorship";
    evidence = noEv.slice(0, 2);
    confidence = "high";
  } else if (cbcEv.length) {
    category = "Case-by-Case";
    evidence = cbcEv.slice(0, 2);
    confidence = "medium";
  } else if (confEv.length) {
    category = "Confirmed";
    evidence = confEv.slice(0, 2);
    confidence = "high";
  } else if (likelyEv.length) {
    category = "Likely";
    evidence = likelyEv.slice(0, 2);
    confidence = "low";
  }
  return { category, existingEmployeesOnly: existingOnly, evidence, confidence };
}

// ---------- Work authorization ----------
export function detectWorkAuth(sents: string[], jobCountries: string[]): JobAnalysis["workAuth"] {
  const citizenshipRequired = new Set<string>();
  const existingAuth = new Set<string>();
  let pr = false;
  let clearance = false;
  const evidence: string[] = [];
  for (const s of sents) {
    const countriesHere = findCountries(s);
    const target = countriesHere.length ? countriesHere : jobCountries.length ? jobCountries : ["ANY_LOCAL"];
    if (/\b(must|required to|need to|should) (be|hold)\b.{0,40}?\bcitizen(s|ship)?\b|\bcitizenship (is )?required\b|\bcitizens only\b|\bcitizen(ship)? of\b.{0,30}?\brequired|\bonly (open to|considering)\b.{0,30}?\bcitizens\b/i.test(s)) {
      target.forEach((c) => citizenshipRequired.add(c));
      evidence.push(s);
    }
    if (/\b(security clearance|clearance (is )?required|active (secret|ts\/sci|top secret)|sc clearance|dv clearance|baseline clearance)\b/i.test(s)) {
      clearance = true;
      target.forEach((c) => citizenshipRequired.add(c));
      evidence.push(s);
    }
    if (/\b(green card|permanent resident|permanent residency|PR holders?)\b/i.test(s) && /\b(must|required|only|eligible)\b/i.test(s)) {
      pr = true;
      evidence.push(s);
    }
    if (
      /\b(must|required|need to|should)\b[^.]{0,30}\b(have|hold|possess)?\b[^.]{0,20}\b(the )?(right to work|legal(ly)? (authori[sz]ed|right)|work authori[sz]ation|authori[sz]ed to work|eligible to work|valid work permit|(full )?[a-z]* ?working rights|work rights)\b/i.test(s) ||
      /\b(right to work|authori[sz]ed to work|eligible to work)\b[^.]{0,40}\bwithout\b[^.]{0,20}sponsor/i.test(s)
    ) {
      const regions = findRegions(s).filter((r) => r === "EU" || r === "Europe");
      if (regions.length) regions.forEach((r) => existingAuth.add(r === "Europe" ? "EU" : r));
      else target.forEach((c) => existingAuth.add(c));
      evidence.push(s);
    }
  }
  return {
    citizenshipRequired: Array.from(citizenshipRequired),
    permanentResidencyRequired: pr,
    existingAuthRequired: Array.from(existingAuth),
    securityClearance: clearance,
    evidence: Array.from(new Set(evidence)).slice(0, 3),
  };
}

// ---------- Remote / location ----------
const WORLDWIDE = /\b(work from anywhere|anywhere in the world|worldwide|world-wide|globally remote|global remote|remote[- ]?\(?global\)?|fully distributed across the globe|any (country|time ?zone|location))\b/i;
const HYBRID = /\bhybrid\b|\b\d\s*(days?|x)\s*(a|per)?\s*week in (the )?office\b|\bin[- ]office \d/i;
const ONSITE = /\b(on[- ]?site|in[- ]office|office[- ]based|in[- ]person)\b/i;
const REMOTE = /\bremote\b|\bwork from home\b|\bdistributed team\b|\bwfh\b/i;
const RELOCATION_REQUIRED = /\b(must|required to|need to|willing(ness)? to|expected to)\s+(be (willing to )?)?relocat/i;
const RELOCATION_OFFERED = /\brelocation (package|support|assistance|bonus|allowance|budget|is (provided|offered|available))\b|\bwe (offer|provide|cover|support) relocation\b|\bhelp(ing)? you relocate\b/i;
const RESIDENCY_RESTRICTION = /\b(must|need to|required to|should)\s+(be\s+)?(based|located|reside|residing|live|living)\b|\b(only|exclusively)\s+(hiring|accepting|considering)\b[^.]{0,40}\b(in|from)\b|\b(based|located|residing)\s+in\b[^.]{0,30}\bonly\b|\b(us|uk|eu)[- ]only\b|\bremote\s*[-–(,]\s*[a-z .]+\s*only\b/i;

export function detectRemote(title: string, location: string, sents: string[]) {
  const all = [location, title, ...sents].join("\n");
  const locCountries = findCountries(location);
  const locRegions = findRegions(location);
  const evidence: string[] = [];
  let category: RemoteCategory = "Unknown";
  let confidence: Confidence = "low";
  let countries: string[] = [];
  let regions: string[] = [];

  const remoteSents = sents.filter((s) => REMOTE.test(s));
  const isRemote = REMOTE.test(location) || REMOTE.test(title) || remoteSents.length > 0;
  const restrictionSents = sents.filter((s) => RESIDENCY_RESTRICTION.test(s) || (REMOTE.test(s) && (findCountries(s).length > 0 || findRegions(s).length > 0)));
  const relocationRequired = sents.some((s) => RELOCATION_REQUIRED.test(s));

  if (relocationRequired) {
    category = "Relocation required";
    evidence.push(...findEvidence(sents, RELOCATION_REQUIRED, 1));
    countries = locCountries;
    confidence = "medium";
  } else if (HYBRID.test(location) || sents.some((s) => HYBRID.test(s))) {
    category = "Hybrid";
    evidence.push(...(HYBRID.test(location) ? [location] : findEvidence(sents, HYBRID, 1)));
    countries = locCountries;
    confidence = "medium";
  } else if (isRemote) {
    const restrictCountries = new Set<string>(locCountries);
    const restrictRegions = new Set<string>(locRegions);
    for (const s of restrictionSents) {
      findCountries(s).forEach((c) => restrictCountries.add(c));
      findRegions(s).forEach((r) => restrictRegions.add(r));
    }
    const worldwide = WORLDWIDE.test(all);
    if (worldwide && restrictCountries.size === 0 && !restrictionSents.some((s) => RESIDENCY_RESTRICTION.test(s))) {
      category = "Worldwide";
      evidence.push(...findEvidence([location, ...sents], WORLDWIDE, 1));
      confidence = "medium";
    } else if (locRegions.length > 0 && locCountries.length === 0) {
      // "Remote (Europe)" – the region in the location field wins over countries named in passing
      category = "Region";
      regions = Array.from(restrictRegions);
      evidence.push(location, ...restrictionSents.slice(0, 1));
      confidence = "medium";
    } else if (restrictCountries.size > 0) {
      category = "Country-only";
      countries = Array.from(restrictCountries);
      regions = Array.from(restrictRegions);
      evidence.push(...(REMOTE.test(location) ? [location] : []), ...restrictionSents.slice(0, 2));
      confidence = restrictionSents.length ? "high" : "medium";
    } else if (restrictRegions.size > 0) {
      category = "Region";
      regions = Array.from(restrictRegions);
      evidence.push(...(locRegions.length ? [location] : []), ...restrictionSents.slice(0, 2));
      confidence = "medium";
    } else {
      category = "Remote (unspecified)";
      evidence.push(remoteSents[0] ?? location);
      confidence = "low";
    }
  } else if (location && (locCountries.length || ONSITE.test(all) || /,/.test(location))) {
    category = "Onsite";
    countries = locCountries;
    evidence.push(location);
    confidence = locCountries.length ? "medium" : "low";
  }

  const relocationOffered = sents.some((s) => RELOCATION_OFFERED.test(s)) ? true : null;
  return {
    remote: { category, countries, regions, evidence: Array.from(new Set(evidence.filter(Boolean))).slice(0, 3), confidence },
    relocation: {
      offered: relocationOffered,
      required: relocationRequired,
      evidence: [...findEvidence(sents, RELOCATION_REQUIRED, 1), ...findEvidence(sents, RELOCATION_OFFERED, 1)],
    },
    restrictions: restrictionSents.slice(0, 3),
    locationCountries: locCountries,
  };
}

// ---------- Experience / seniority / salary / type ----------
export function detectExperience(text: string): JobAnalysis["experienceYears"] {
  const ranges = [...text.matchAll(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*(?:years|yrs)/gi)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const mins = [
    ...text.matchAll(/\b(?:at least|minimum(?: of)?|min\.?|over|more than)?\s*(\d{1,2})\+?\s*(?:years|yrs)(?:'|’)?\s*(?:of)?\s*(?:[a-z\-/]+\s){0,4}?(?:experience|exp\b)/gi),
  ].map((m) => Number(m[1]));
  if (ranges.length) {
    const [a, b] = ranges[0];
    if (a <= 20 && b <= 30 && a <= b) return { min: a, max: b };
  }
  const valid = mins.filter((n) => n > 0 && n <= 20);
  if (valid.length) return { min: Math.min(...valid), max: null };
  return null;
}

export function detectSeniority(title: string, years: JobAnalysis["experienceYears"]): Seniority {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "Intern";
  if (/\b(director|vp|vice president|head of|chief)\b/.test(t)) return "Director";
  if (/\b(principal|distinguished|fellow)\b/.test(t)) return "Principal";
  if (/\b(staff|lead|tech lead)\b/.test(t)) return "Lead";
  if (/\b(manager|mgr)\b/.test(t) && !/product manager|project manager|program manager|account manager/.test(t)) return "Manager";
  if (/\b(senior|sr\.?|snr)\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|graduate|entry[- ]level|associate)\b/.test(t)) return "Junior";
  if (/\b(mid|intermediate|ii)\b/.test(t)) return "Mid";
  if (years?.min != null) {
    if (years.min >= 8) return "Lead";
    if (years.min >= 5) return "Senior";
    if (years.min >= 2) return "Mid";
    return "Junior";
  }
  return "Unknown";
}

const CURRENCY: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "₹": "INR", usd: "USD", gbp: "GBP", eur: "EUR", inr: "INR", cad: "CAD", aud: "AUD", aed: "AED", chf: "CHF", sgd: "SGD" };

export function detectSalary(text: string): JobAnalysis["salary"] {
  const re = /(?:(US\$|CA\$|A\$|\$|£|€|₹)|\b(USD|GBP|EUR|INR|CAD|AUD|AED|CHF|SGD)\s?)\s?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\s*(?:-|–|to)\s*(?:US\$|CA\$|A\$|\$|£|€|₹|USD|GBP|EUR|INR|CAD|AUD|AED|CHF|SGD)?\s?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?(?:\s*(per|\/|a)\s*(year|annum|yr|month|mo|hour|hr))?/;
  const m = text.match(re);
  if (!m) return null;
  const sym = (m[1] || m[2] || "$").toLowerCase();
  let currency = CURRENCY[sym] ?? CURRENCY[sym.replace(/[^$£€₹a-z]/g, "")] ?? "USD";
  if (sym === "ca$") currency = "CAD";
  if (sym === "a$") currency = "AUD";
  const num = (s: string, k?: string) => {
    let n = Number(s.replace(/[,.\s](?=\d{3}\b)/g, "").replace(/,/g, ""));
    if (k) n *= 1000;
    return Math.round(n);
  };
  let min = num(m[3], m[4] || m[6]);
  let max = num(m[5], m[6]);
  const periodRaw = (m[8] || "").toLowerCase();
  const period: "year" | "month" | "hour" = /hour|hr/.test(periodRaw) ? "hour" : /month|mo/.test(periodRaw) ? "month" : "year";
  if (period === "year" && (min < 1000 || max < 1000)) return null; // probably not a salary
  if (min > max) [min, max] = [max, min];
  return { min, max, currency, period };
}

export function detectEmploymentType(text: string, given?: string | null): JobAnalysis["employmentType"] {
  const s = `${given ?? ""} ${text}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(s.slice(0, 400)) || /internship/.test(given?.toLowerCase() ?? "")) return "internship";
  if (/\b(contract|contractor|freelance|fixed[- ]term|b2b)\b/.test(given?.toLowerCase() ?? "") || /\b(this is a|6[- ]month|12[- ]month) contract\b/.test(s)) return "contract";
  if (/\bpart[- ]time\b/.test(given?.toLowerCase() ?? "") || /\bthis is a part[- ]time\b/.test(s)) return "part-time";
  if (/\btemporary\b/.test(given?.toLowerCase() ?? "")) return "temporary";
  if (/\bfull[- ]?time\b|\bpermanent\b/.test(s)) return "full-time";
  return given ? "full-time" : null;
}

function detectDegree(text: string): string | null {
  const m = text.match(/\b(bachelor'?s?|master'?s?|phd|ph\.d\.?|doctorate|b\.?s\.?c?|m\.?s\.?c?|degree)\b[^.\n]{0,80}/i);
  return m ? m[0].trim().slice(0, 120) : null;
}

// ---------- Sections ----------
const RESP_HEAD = /^(responsibilities|what you('|’)?ll do|what you will do|your role|the role|key responsibilities|in this role|day[- ]to[- ]day|your impact|what you('|’)?ll be doing)\b/i;
const QUAL_HEAD = /^(requirements|qualifications|what we('|’)?re looking for|what you('|’)?ll (bring|need)|who you are|about you|you have|must[- ]haves?|minimum qualifications|basic qualifications|skills|your profile|you should have)\b/i;
const NICE_HEAD = /^(nice to have|bonus|preferred|pluses|good to have|preferred qualifications|it('|’)?s a plus)/i;
const OTHER_HEAD = /^(benefits|perks|about us|about the company|who we are|why join|what we offer|compensation|our values|equal opportunity|eeo)/i;

export function extractSections(description: string) {
  const lines = description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = { responsibilities: [] as string[], qualifications: [] as string[], nice: [] as string[] };
  let current: keyof typeof out | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^[•\-*·\d.)\s]+/, "").trim();
    const heading = line.replace(/[:\s]+$/, "");
    if (heading.length < 60) {
      if (RESP_HEAD.test(heading)) { current = "responsibilities"; continue; }
      if (NICE_HEAD.test(heading)) { current = "nice"; continue; }
      if (QUAL_HEAD.test(heading)) { current = "qualifications"; continue; }
      if (OTHER_HEAD.test(heading)) { current = null; continue; }
    }
    if (current && line.length > 8 && line.length < 400) out[current].push(line);
  }
  // Fallback: no headings found – use bullet-ish lines with action verbs
  if (!out.responsibilities.length) {
    out.responsibilities = lines
      .filter((l) => /^[•\-*·]/.test(l) || /^(build|design|develop|lead|own|work|collaborate|create|drive|manage|implement|maintain|partner|support|deliver)\b/i.test(l))
      .map((l) => l.replace(/^[•\-*·\s]+/, ""))
      .filter((l) => !/\byears?\b/.test(l))
      .slice(0, 8);
  }
  if (!out.qualifications.length) {
    out.qualifications = lines.filter((l) => /\b(years|experience with|proficien|degree|knowledge of|familiar)/i.test(l)).map((l) => l.replace(/^[•\-*·\s]+/, "")).slice(0, 8);
  }
  return {
    responsibilities: out.responsibilities.slice(0, 12),
    qualifications: out.qualifications.slice(0, 12),
    nice: out.nice.slice(0, 8),
  };
}

function detectCoverLetter(text: string, ats?: string | null): JobAnalysis["coverLetter"] {
  if (/cover letter[^.]{0,30}\b(is )?(required|mandatory|must)\b|\b(must|please) (include|submit|attach|send)[^.]{0,30}cover letter/i.test(text)) return "required";
  if (/\bno cover letter|cover letters? (are )?not (required|needed|necessary)/i.test(text)) return "none";
  if (/cover letter/i.test(text)) return "optional";
  if (ats === "greenhouse" || ats === "lever") return "optional";
  return "unknown";
}

export function analyzeWithRules(job: JobInput): JobAnalysis {
  const description = job.description || "";
  const sents = sentences(description);
  const location = job.location || "";
  const { remote, relocation, restrictions, locationCountries } = detectRemote(job.title, location, sents);
  const jobCountries = remote.countries.length ? remote.countries : locationCountries;
  const experienceYears = detectExperience(description);
  const sections = extractSections(description);
  const allSkills = extractSkills(`${job.title}\n${description}`);
  const niceText = sections.nice.join("\n");
  const niceToHaveSkills = niceText ? extractSkills(niceText) : [];
  const reqText = sections.qualifications.join("\n") || description;
  const requiredSkills = extractSkills(`${job.title}\n${reqText}`).filter((s) => !niceToHaveSkills.includes(s) || reqText.includes(s));
  const salaryFromText = detectSalary(description);
  const salary =
    job.salaryMin || job.salaryMax
      ? { min: job.salaryMin ?? null, max: job.salaryMax ?? null, currency: job.salaryCurrency || salaryFromText?.currency || "USD", period: "year" as const }
      : salaryFromText;

  return {
    version: ANALYSIS_VERSION,
    source: "rules",
    title: job.title,
    company: job.company,
    seniority: detectSeniority(job.title, experienceYears),
    experienceYears,
    skills: allSkills,
    requiredSkills: requiredSkills.length ? requiredSkills : allSkills,
    niceToHaveSkills,
    responsibilities: sections.responsibilities,
    qualifications: sections.qualifications,
    degree: detectDegree(description),
    salary,
    employmentType: detectEmploymentType(description, job.employmentType),
    sponsorship: detectSponsorship(sents),
    workAuth: detectWorkAuth(sents, jobCountries),
    remote,
    relocation,
    locationCountries: jobCountries.length ? jobCountries : (countryCode(location) ? [countryCode(location)!] : []),
    locationRestrictions: restrictions,
    coverLetter: detectCoverLetter(description, job.atsType),
  };
}
