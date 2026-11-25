/**
 * Standard screening answers derived ONLY from the profile.
 * Anything not in the profile is marked "needs-user" – never guessed.
 */
import { countryName } from "../countries";
import type { Candidate } from "../matching/candidate";
import { canWorkIn } from "../matching/eligibility";
import type { Profile } from "@prisma/client";
import type { JobAnalysis } from "../analysis/types";

export interface ScreeningAnswer {
  id: string;
  question: string;
  answer: string;
  source: "profile" | "user" | "ai-draft" | "needs-user";
  category: "work-auth" | "sponsorship" | "relocation" | "salary" | "experience" | "availability" | "links" | "motivation" | "documents";
  required: boolean;
}

export const NEEDS_USER = "";

export function standardAnswers(profile: Profile, c: Candidate, a: JobAnalysis, company: string): ScreeningAnswer[] {
  const countries = (a.remote.countries.length ? a.remote.countries : a.locationCountries).filter((x) => x !== "ANY_LOCAL");
  const where = countries.length ? countries.map(countryName).join(" / ") : null;
  const out: ScreeningAnswer[] = [];
  const workable = countries.filter((x) => canWorkIn(c, x));

  if (!where && a.remote.category === "Worldwide" && c.currentCountry && canWorkIn(c, c.currentCountry)) {
    // Remote from anywhere: the honest answer is about the country you'd work from
    out.push({ id: "work-auth", question: "Are you legally authorized to work in the country you'd work from?", answer: `Yes – I'm authorized to work in ${countryName(c.currentCountry)}, where I'd work remotely`, source: "profile", category: "work-auth", required: true });
    out.push({ id: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: `No – not for remote work from ${countryName(c.currentCountry)}`, source: "profile", category: "sponsorship", required: true });
  }
  if (!out.length) out.push({
    id: "work-auth",
    question: `Are you legally authorized to work in ${where ?? "the job's country"}?`,
    answer: where ? (workable.length === countries.length ? "Yes" : workable.length ? `Yes for ${workable.map(countryName).join("/")}` : "No") : NEEDS_USER,
    source: where ? "profile" : "needs-user",
    category: "work-auth",
    required: true,
  });
  const needsVisa = where ? workable.length === 0 : null;
  if (!out.some((x) => x.id === "sponsorship")) out.push({
    id: "sponsorship",
    question: "Will you now or in the future require visa sponsorship?",
    answer: needsVisa === null ? (c.needsSponsorship ? "Yes" : NEEDS_USER) : needsVisa ? "Yes" : "No",
    source: needsVisa === null && !c.needsSponsorship ? "needs-user" : "profile",
    category: "sponsorship",
    required: true,
  });
  const onsite = ["Onsite", "Hybrid", "Relocation required"].includes(a.remote.category);
  if (onsite) {
    const here = c.currentCountry && countries.includes(c.currentCountry);
    out.push({
      id: "relocation",
      question: `Are you willing to relocate to ${where ?? "the job location"}?`,
      answer: here ? "Already based in the country" : c.willingToRelocate ? "Yes" : "No",
      source: "profile",
      category: "relocation",
      required: true,
    });
  }
  out.push({
    id: "salary",
    question: "What are your salary expectations?",
    answer: profile.salaryExpectation ? `${profile.salaryCurrency} ${profile.salaryExpectation.toLocaleString("en")} per year (negotiable)` : NEEDS_USER,
    source: profile.salaryExpectation ? "profile" : "needs-user",
    category: "salary",
    required: true,
  });
  out.push({
    id: "experience",
    question: "How many years of relevant professional experience do you have?",
    answer: c.yearsExperience != null ? `${Math.floor(c.yearsExperience)}+ years` : NEEDS_USER,
    source: c.yearsExperience != null ? "profile" : "needs-user",
    category: "experience",
    required: false,
  });
  out.push({
    id: "notice",
    question: "What is your notice period / earliest start date?",
    answer: profile.noticePeriod || NEEDS_USER,
    source: profile.noticePeriod ? "profile" : "needs-user",
    category: "availability",
    required: true,
  });
  out.push({
    id: "linkedin",
    question: "LinkedIn profile URL",
    answer: profile.linkedin || NEEDS_USER,
    source: profile.linkedin ? "profile" : "needs-user",
    category: "links",
    required: false,
  });
  out.push({
    id: "motivation",
    question: `Why do you want to work at ${company}?`,
    answer: NEEDS_USER,
    source: "needs-user",
    category: "motivation",
    required: false,
  });
  return out;
}
