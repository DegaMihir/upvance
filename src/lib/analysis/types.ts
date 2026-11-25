export type Confidence = "high" | "medium" | "low";

export const SPONSORSHIP_CATEGORIES = ["Confirmed", "Likely", "Case-by-Case", "Unknown", "No Sponsorship"] as const;
export type SponsorshipCategory = (typeof SPONSORSHIP_CATEGORIES)[number];

export const REMOTE_CATEGORIES = [
  "Worldwide",
  "Country-only",
  "Region",
  "Hybrid",
  "Onsite",
  "Relocation required",
  "Remote (unspecified)",
  "Unknown",
] as const;
export type RemoteCategory = (typeof REMOTE_CATEGORIES)[number];

export const SENIORITIES = ["Intern", "Junior", "Mid", "Senior", "Lead", "Principal", "Manager", "Director", "Unknown"] as const;
export type Seniority = (typeof SENIORITIES)[number];

export interface JobAnalysis {
  version: number;
  source: "rules" | "ai";
  title: string;
  company: string;
  seniority: Seniority;
  experienceYears: { min: number | null; max: number | null } | null;
  skills: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  degree: string | null;
  salary: { min: number | null; max: number | null; currency: string; period: "year" | "month" | "hour" } | null;
  employmentType: "full-time" | "part-time" | "contract" | "internship" | "temporary" | null;
  sponsorship: {
    category: SponsorshipCategory;
    existingEmployeesOnly: boolean;
    evidence: string[];
    confidence: Confidence;
  };
  workAuth: {
    citizenshipRequired: string[]; // country codes, "ANY_LOCAL" if unspecified
    permanentResidencyRequired: boolean;
    existingAuthRequired: string[]; // country codes or regions (e.g. "EU")
    securityClearance: boolean;
    evidence: string[];
  };
  remote: {
    category: RemoteCategory;
    countries: string[];
    regions: string[];
    evidence: string[];
    confidence: Confidence;
  };
  relocation: { offered: boolean | null; required: boolean; evidence: string[] };
  locationCountries: string[];
  locationRestrictions: string[];
  coverLetter: "required" | "optional" | "none" | "unknown";
  summary?: string;
}

export const ANALYSIS_VERSION = 3;
