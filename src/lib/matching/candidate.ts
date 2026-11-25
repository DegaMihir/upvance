import type { Profile, UserSettings } from "@prisma/client";
import { countryCode } from "../countries";
import { parseJson } from "../utils";
import { canonicalSkill } from "../skills";

export interface Experience {
  title: string;
  company: string;
  location?: string;
  start?: string; // YYYY-MM or free text
  end?: string; // "Present" allowed
  bullets: string[];
}
export interface Education {
  degree: string;
  school: string;
  field?: string;
  start?: string;
  end?: string;
}
export interface Project {
  name: string;
  description: string;
  link?: string;
}

export interface Candidate {
  profileId?: string;
  skills: string[];
  yearsExperience: number | null;
  citizenship: string[];
  currentCountry: string | null;
  workAuthorizations: string[]; // country codes and/or "EU"
  needsSponsorship: boolean;
  willingToRelocate: boolean;
  relocationCountries: string[];
  experienceText: string;
  titles: string[];
  hasDegree: boolean;
  salaryExpectation: number | null;
  salaryCurrency: string;
}

export interface Preferences {
  sponsorshipRequired: boolean;
  strictSponsorship: boolean;
  remotePreference: string;
  targetCountries: string[];
  targetTitles: string[];
  minSalary: number | null;
  salaryCurrency?: string;
  /** remote jobs must pay the on-site rate (no pay cut for where you live) */
  remotePayParity?: boolean;
  employmentTypes: string[];
  excludedCompanies: string[];
}

export function codes(list: string[]): string[] {
  return list
    .map((c) => (c.trim().toUpperCase() === "EU" ? "EU" : countryCode(c)))
    .filter((c): c is string => !!c);
}

/** Rough years of experience from dated roles if the user didn't enter it. */
export function estimateYears(exps: Experience[]): number | null {
  let months = 0;
  let any = false;
  for (const e of exps) {
    const s = parseYm(e.start);
    const end = /present|current|now/i.test(e.end ?? "") || !e.end ? new Date() : parseYm(e.end);
    if (s && end && end > s) {
      any = true;
      months += (end.getFullYear() - s.getFullYear()) * 12 + (end.getMonth() - s.getMonth());
    }
  }
  return any ? Math.round((months / 12) * 10) / 10 : null;
}

function parseYm(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{4})(?:[-/.](\d{1,2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1);
}

export function candidateFromProfile(p: Profile): Candidate {
  const exps = parseJson<Experience[]>(p.experiences, []);
  const edu = parseJson<Education[]>(p.education, []);
  const projects = parseJson<Project[]>(p.projects, []);
  return {
    profileId: p.id,
    skills: parseJson<string[]>(p.skills, []).map(canonicalSkill),
    yearsExperience: p.yearsExperience ?? estimateYears(exps),
    citizenship: codes(p.citizenship.split(/[,/;]| and /)),
    currentCountry: countryCode(p.currentCountry),
    workAuthorizations: codes(parseJson<string[]>(p.workAuthorizations, [])),
    needsSponsorship: p.needsSponsorship,
    willingToRelocate: p.willingToRelocate,
    relocationCountries: codes(parseJson<string[]>(p.relocationCountries, [])),
    experienceText: [
      p.headline,
      p.summary,
      ...exps.flatMap((e) => [e.title, ...e.bullets]),
      ...projects.map((x) => `${x.name} ${x.description}`),
    ].join("\n"),
    titles: exps.map((e) => e.title),
    hasDegree: edu.some((e) => /bachelor|master|phd|doctor|b\.?s|m\.?s|b\.?tech|m\.?tech|b\.?e\b|degree|b\.?sc|m\.?sc|mba/i.test(e.degree)),
    salaryExpectation: p.salaryExpectation,
    salaryCurrency: p.salaryCurrency,
  };
}

export function preferencesFromSettings(s: UserSettings | null): Preferences {
  return {
    sponsorshipRequired: s?.sponsorshipRequired ?? false,
    strictSponsorship: s?.strictSponsorship ?? false,
    remotePreference: s?.remotePreference ?? "any",
    targetCountries: codes(parseJson<string[]>(s?.targetCountries, [])),
    targetTitles: parseJson<string[]>(s?.targetTitles, []),
    minSalary: s?.minSalary ?? null,
    salaryCurrency: s?.salaryCurrency ?? "USD",
    remotePayParity: s?.remotePayParity ?? true,
    employmentTypes: parseJson<string[]>(s?.employmentTypes, []),
    excludedCompanies: parseJson<string[]>(s?.excludedCompanies, []),
  };
}
