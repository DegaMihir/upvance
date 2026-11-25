import type { Job, Company } from "@prisma/client";
import { db } from "../db";
import { runAI } from "../ai";
import { ANALYSIS_SYSTEM, analysisPrompt } from "../ai/prompts";
import { canonicalSkill } from "../skills";
import { parseJson } from "../utils";
import { sponsorHitsForCompany, combineSponsorship } from "../sponsors/lookup";
import { analyzeWithRules } from "./rules";
import {
  ANALYSIS_VERSION,
  REMOTE_CATEGORIES,
  SENIORITIES,
  SPONSORSHIP_CATEGORIES,
  type JobAnalysis,
  type RemoteCategory,
  type SponsorshipCategory,
} from "./types";

type AiAnalysis = Partial<{
  seniority: string;
  experienceYears: { min: number | null; max: number | null } | null;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  degree: string | null;
  salary: JobAnalysis["salary"];
  employmentType: JobAnalysis["employmentType"];
  sponsorship: { category: string; existingEmployeesOnly: boolean; evidence: string[] };
  workAuth: JobAnalysis["workAuth"];
  remote: { category: string; countries: string[]; regions: string[]; evidence: string[] };
  relocation: { offered: boolean | null; required: boolean };
  coverLetter: JobAnalysis["coverLetter"];
  summary: string;
}>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** AI evidence must be a real quote from the posting, otherwise we don't trust it. */
function quotedIn(evidence: string[] | undefined, description: string) {
  const d = norm(description);
  return (evidence ?? []).filter((e) => e && d.includes(norm(e).slice(0, 60)));
}

/**
 * Merge AI output into the rule-based analysis. Rules win on safety-critical
 * negatives (explicit "no sponsorship", citizenship requirements).
 */
export function mergeAnalysis(rules: JobAnalysis, ai: AiAnalysis, description: string): JobAnalysis {
  const out: JobAnalysis = { ...rules, source: "ai" };
  if (ai.seniority && (SENIORITIES as readonly string[]).includes(ai.seniority)) out.seniority = ai.seniority as JobAnalysis["seniority"];
  if (ai.experienceYears && (ai.experienceYears.min != null || ai.experienceYears.max != null)) out.experienceYears = ai.experienceYears;
  if (ai.requiredSkills?.length) out.requiredSkills = Array.from(new Set(ai.requiredSkills.map(canonicalSkill))).slice(0, 25);
  if (ai.niceToHaveSkills) out.niceToHaveSkills = Array.from(new Set(ai.niceToHaveSkills.map(canonicalSkill))).slice(0, 15);
  out.skills = Array.from(new Set([...out.requiredSkills, ...out.niceToHaveSkills, ...rules.skills]));
  if (ai.responsibilities?.length) out.responsibilities = ai.responsibilities.slice(0, 10);
  if (ai.qualifications?.length) out.qualifications = ai.qualifications.slice(0, 10);
  if (ai.degree !== undefined) out.degree = ai.degree;
  if (!rules.salary && ai.salary && (ai.salary.min || ai.salary.max)) out.salary = ai.salary;
  if (ai.employmentType) out.employmentType = ai.employmentType;
  if (ai.coverLetter && rules.coverLetter !== "required") out.coverLetter = ai.coverLetter;
  if (ai.summary) out.summary = ai.summary;

  // Sponsorship: explicit negative from rules always wins; AI must quote evidence.
  if (ai.sponsorship && (SPONSORSHIP_CATEGORIES as readonly string[]).includes(ai.sponsorship.category) && rules.sponsorship.category !== "No Sponsorship") {
    const ev = quotedIn(ai.sponsorship.evidence, description);
    if (ev.length || ai.sponsorship.category === "Unknown") {
      if (!(rules.sponsorship.category !== "Unknown" && ai.sponsorship.category === "Unknown")) {
        out.sponsorship = {
          category: ai.sponsorship.category as SponsorshipCategory,
          existingEmployeesOnly: !!ai.sponsorship.existingEmployeesOnly,
          evidence: ev.length ? ev : rules.sponsorship.evidence,
          confidence: ev.length ? "high" : "low",
        };
      }
    }
  }
  // Work authorization: union (more restrictive wins)
  if (ai.workAuth) {
    const ev = quotedIn(ai.workAuth.evidence, description);
    if (ev.length) {
      out.workAuth = {
        citizenshipRequired: Array.from(new Set([...rules.workAuth.citizenshipRequired, ...(ai.workAuth.citizenshipRequired ?? [])])),
        permanentResidencyRequired: rules.workAuth.permanentResidencyRequired || !!ai.workAuth.permanentResidencyRequired,
        existingAuthRequired: Array.from(new Set([...rules.workAuth.existingAuthRequired, ...(ai.workAuth.existingAuthRequired ?? [])])),
        securityClearance: rules.workAuth.securityClearance || !!ai.workAuth.securityClearance,
        evidence: Array.from(new Set([...rules.workAuth.evidence, ...ev])).slice(0, 4),
      };
    }
  }
  // Remote: AI may refine an unclear rule result, but never upgrade a restricted job to Worldwide without a quote.
  if (ai.remote && (REMOTE_CATEGORIES as readonly string[]).includes(ai.remote.category)) {
    const ev = quotedIn(ai.remote.evidence, `${description}\n${rules.title}`);
    const unclear = ["Unknown", "Remote (unspecified)"].includes(rules.remote.category);
    const upgradeToWorldwide = ai.remote.category === "Worldwide" && rules.remote.category !== "Worldwide";
    if ((unclear || ev.length) && !(upgradeToWorldwide && !ev.length)) {
      out.remote = {
        category: ai.remote.category as RemoteCategory,
        countries: (ai.remote.countries ?? []).map((c) => c.toUpperCase()),
        regions: ai.remote.regions ?? [],
        evidence: ev.length ? ev : rules.remote.evidence,
        confidence: ev.length ? "high" : "medium",
      };
    }
  }
  if (ai.relocation) out.relocation = { ...rules.relocation, offered: ai.relocation.offered ?? rules.relocation.offered, required: rules.relocation.required || !!ai.relocation.required };
  return out;
}

export interface AnalyzeOptions {
  useAI?: boolean;
  userId?: string | null;
  force?: boolean;
}

/** Analyse a job (rules first, AI optional & cached) and store the result. */
export async function analyzeJob(job: Job & { company: Company }, opts: AnalyzeOptions = {}) {
  const existing = parseJson<Partial<JobAnalysis>>(job.analysis, {});
  const alreadyAi = existing.version === ANALYSIS_VERSION && existing.source === "ai";
  if (!opts.force && existing.version === ANALYSIS_VERSION && (alreadyAi || !opts.useAI)) {
    return { analysis: existing as JobAnalysis, aiNote: null as string | null };
  }

  const input = {
    title: job.title,
    company: job.company.name,
    location: job.location,
    description: job.description,
    atsType: job.atsType,
    employmentType: job.employmentType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
  };
  let analysis = analyzeWithRules(input);
  let aiNote: string | null = null;

  if (opts.useAI && job.description.length > 200) {
    const res = await runAI<AiAnalysis>({
      role: "analysis",
      task: "job-analysis",
      userId: opts.userId,
      input: { system: ANALYSIS_SYSTEM, prompt: analysisPrompt(input), json: true, maxTokens: 2500, temperature: 0.1 },
    });
    if (res.ok) {
      const rules = analysis;
      analysis = mergeAnalysis(analysis, res.data, job.description);
      // the AI sometimes leaves the country empty for "City, ST, US" – keep what the location says
      if (!analysis.locationCountries?.length && rules.locationCountries?.length) analysis = { ...analysis, locationCountries: rules.locationCountries };
    } else aiNote = res.reason;
  }

  // Combine posting wording with official sponsor lists
  const jobCountries = analysis.remote.countries.length ? analysis.remote.countries : analysis.locationCountries;
  const hits = await sponsorHitsForCompany(job.company.name);
  const combined = combineSponsorship(analysis.sponsorship, hits, jobCountries);
  analysis.sponsorship = combined;

  await db.job.update({
    where: { id: job.id },
    data: {
      analysis: JSON.stringify(analysis),
      analysisSource: analysis.source,
      analyzedAt: new Date(),
      sponsorshipCategory: combined.category,
      remoteCategory: analysis.remote.category,
      remoteCountries: JSON.stringify(analysis.remote.countries),
      seniority: analysis.seniority,
      employmentType: analysis.employmentType ?? job.employmentType,
      salaryMin: job.salaryMin ?? analysis.salary?.min ?? null,
      salaryMax: job.salaryMax ?? analysis.salary?.max ?? null,
      salaryCurrency: job.salaryCurrency ?? analysis.salary?.currency ?? null,
      coverLetterPolicy: analysis.coverLetter,
    },
  });
  return { analysis, aiNote };
}
