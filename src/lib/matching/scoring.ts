/**
 * Weighted job-suitability score (NOT interview probability).
 * Default weights: skills 30, experience 20, responsibilities 15,
 * sponsorship 15, location 10, seniority/qualifications 5, freshness 5.
 */
import type { JobAnalysis, SponsorshipCategory } from "../analysis/types";
import { skillSet } from "../skills";
import type { Candidate } from "./candidate";
import type { EligibilityResult } from "./eligibility";

export const DEFAULT_WEIGHTS = {
  skills: 30,
  experience: 20,
  responsibilities: 15,
  sponsorship: 15,
  location: 10,
  seniority: 5,
  freshness: 5,
};
export type Weights = typeof DEFAULT_WEIGHTS;
export type WeightKey = keyof Weights;

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  skills: "Skills",
  experience: "Experience",
  responsibilities: "Responsibilities",
  sponsorship: "Sponsorship",
  location: "Location / eligibility",
  seniority: "Seniority / qualifications",
  freshness: "Freshness",
};

export const BANDS = [
  { name: "Excellent", min: 85 },
  { name: "Strong", min: 75 },
  { name: "Good", min: 65 },
  { name: "Moderate", min: 50 },
  { name: "Poor", min: 0 },
] as const;
export type Band = (typeof BANDS)[number]["name"];

export function bandFor(score: number): Band {
  return BANDS.find((b) => score >= b.min)!.name;
}

/** Minimum score for a band name used in settings / saved searches ("Stretch" = Moderate). */
export function bandMin(name: string): number {
  if (name === "Stretch") return 50;
  return BANDS.find((b) => b.name === name)?.min ?? 65;
}

export function normalizeWeights(w: Partial<Weights> | null | undefined): Weights {
  const merged = { ...DEFAULT_WEIGHTS, ...(w ?? {}) } as Weights;
  const total = Object.values(merged).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as Weights;
  for (const k of Object.keys(merged) as WeightKey[]) out[k] = Math.round(((Number(merged[k]) || 0) / total) * 1000) / 10;
  return out;
}

const STOP = new Set(
  "the and for with you our your will that this are from have has into using use work working team teams across within about their they them who what when where which while such other than more most also able strong good great new build help make ensure including include based role company job experience years".split(
    " ",
  ),
);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/\.$/, ""))
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

export interface ScoreBreakdown {
  components: Record<WeightKey, number>; // 0-100 each
  weights: Weights;
  matchedSkills: string[];
  missingSkills: string[];
}

export interface ScoreResult {
  score: number;
  band: Band;
  breakdown: ScoreBreakdown;
  whyMatch: string[];
  whyNot: string[];
}

const SENIORITY_YEARS: Record<string, [number, number]> = {
  Intern: [0, 1],
  Junior: [0, 2],
  Mid: [2, 5],
  Senior: [5, 9],
  Lead: [7, 15],
  Principal: [10, 25],
  Manager: [5, 20],
  Director: [10, 30],
};

const ROLE_STOP = new Set("senior junior lead staff principal head intern internship ii iii iv of and the for with remote hybrid onsite contract full time part new grad graduate associate mid level sr jr".split(" "));
const ROLE_ALIASES: Record<string, string> = { ml: "machine", machine: "machine", learning: "machine", ai: "machine", llm: "machine", developer: "engineer", engineering: "engineer", swe: "engineer", programmer: "engineer", scientist: "scientist", science: "scientist", analytics: "analyst", analyst: "analyst" };

export function sponsorshipComponent(category: SponsorshipCategory, needsVisa: boolean): number {
  if (!needsVisa) return 100;
  return { Confirmed: 100, Likely: 80, "Case-by-Case": 55, Unknown: 35, "No Sponsorship": 0 }[category];
}

export function scoreJob(opts: {
  candidate: Candidate;
  analysis: JobAnalysis;
  sponsorship: SponsorshipCategory;
  eligibility: EligibilityResult;
  postedAt: Date | null;
  weights?: Partial<Weights>;
  remotePreference?: string;
  targetTitles?: string[];
  now?: Date;
}): ScoreResult {
  const { candidate: c, analysis: a, eligibility } = opts;
  const weights = normalizeWeights(opts.weights);
  const whyMatch: string[] = [];
  const whyNot: string[] = [];

  // Skills
  const cand = skillSet(c.skills);
  const req = a.requiredSkills.length ? a.requiredSkills : a.skills;
  const matched = req.filter((s) => cand.has(s.toLowerCase()));
  const missing = req.filter((s) => !cand.has(s.toLowerCase()));
  const nice = a.niceToHaveSkills.filter((s) => cand.has(s.toLowerCase()));
  let skills = req.length ? (matched.length / req.length) * 100 : 60;
  if (nice.length) skills = Math.min(100, skills + nice.length * 4);
  if (matched.length) whyMatch.push(`You have ${matched.length} of ${req.length} key skills: ${matched.slice(0, 6).join(", ")}.`);
  if (missing.length) whyNot.push(`Missing or not listed on your profile: ${missing.slice(0, 6).join(", ")}.`);

  // Experience
  let experience = 70;
  const yrs = c.yearsExperience;
  const need = a.experienceYears?.min ?? null;
  if (need != null && yrs != null) {
    if (yrs >= need) experience = 100;
    else if (yrs >= need - 1) experience = 75;
    else if (yrs >= need - 2) experience = 50;
    else experience = 20;
    if (a.experienceYears?.max != null && yrs > a.experienceYears.max + 5) experience = Math.min(experience, 70);
    if (yrs >= need) whyMatch.push(`Your ~${yrs} years meet the ${need}+ years asked for.`);
    else whyNot.push(`Asks for ${need}+ years; your profile shows about ${yrs}.`);
  } else if (need == null) {
    experience = 75;
  }

  // Responsibilities overlap
  const respText = [...a.responsibilities, ...a.qualifications].join(" ");
  let responsibilities = 50;
  if (respText.trim()) {
    const jt = terms(respText);
    const ct = terms(c.experienceText);
    let hit = 0;
    jt.forEach((t) => ct.has(t) && hit++);
    const frac = jt.size ? hit / jt.size : 0;
    responsibilities = Math.round(Math.min(100, frac * 220));
    if (responsibilities >= 60) whyMatch.push("Your past work covers many of the listed responsibilities.");
    else if (responsibilities < 35) whyNot.push("Few of the listed responsibilities appear in your experience.");
  }

  // Sponsorship
  const needsVisa = eligibility.needsSponsorshipFor.length > 0;
  const sponsorship = sponsorshipComponent(opts.sponsorship, needsVisa);
  if (needsVisa && sponsorship >= 80) whyMatch.push(`Visa sponsorship is ${opts.sponsorship.toLowerCase()}.`);
  if (needsVisa && sponsorship < 50) whyNot.push(`You'd need a visa and sponsorship is ${opts.sponsorship.toLowerCase()}.`);

  // Location / eligibility
  let location = eligibility.status === "Eligible" ? 100 : eligibility.status === "Needs review" ? 50 : 0;
  const pref = opts.remotePreference ?? "any";
  const isRemote = ["Worldwide", "Country-only", "Region", "Remote (unspecified)"].includes(a.remote.category);
  if (pref === "remote" && !isRemote) location = Math.min(location, 60);
  if (pref === "onsite" && isRemote) location = Math.min(location, 80);
  eligibility.notes.forEach((n) => whyMatch.push(n));

  // Seniority / qualifications
  let seniority = 70;
  const range = SENIORITY_YEARS[a.seniority];
  if (range && yrs != null) {
    seniority = yrs >= range[0] && yrs <= range[1] + 3 ? 100 : yrs < range[0] ? Math.max(20, 100 - (range[0] - yrs) * 20) : 75;
  }
  if (a.degree && !c.hasDegree) {
    seniority = Math.min(seniority, 50);
    whyNot.push("Mentions a degree; none is listed on your profile.");
  }

  // Freshness
  let freshness = 50;
  if (opts.postedAt) {
    const days = ((opts.now ?? new Date()).getTime() - opts.postedAt.getTime()) / 86_400_000;
    freshness = days <= 3 ? 100 : days <= 7 ? 85 : days <= 14 ? 70 : days <= 30 ? 50 : 25;
  }

  const components = {
    skills: Math.round(skills),
    experience,
    responsibilities,
    sponsorship,
    location,
    seniority,
    freshness,
  };
  const total = (Object.keys(components) as WeightKey[]).reduce((sum, k) => sum + (components[k] * weights[k]) / 100, 0);
  // Role fit: a job whose title shares no role words with your titles/targets and needs
  // almost none of your skills isn't a good match, however neutral the other parts look.
  const roleWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !ROLE_STOP.has(w)).map((w) => ROLE_ALIASES[w] ?? w);
  const mine = new Set([...c.titles, ...(opts.targetTitles ?? [])].flatMap(roleWords));
  const titleOverlap = !mine.size || roleWords(a.title).some((w) => mine.has(w));
  const roleFactor = titleOverlap || matched.length >= 2 ? 1 : 0.75;
  if (roleFactor < 1) whyNot.push("The role title is quite different from your experience and target roles.");
  const score = Math.round(Math.max(0, Math.min(100, total * roleFactor)));
  return {
    score,
    band: bandFor(score),
    breakdown: { components, weights, matchedSkills: matched, missingSkills: missing },
    whyMatch: Array.from(new Set(whyMatch)),
    whyNot: Array.from(new Set(whyNot)),
  };
}
