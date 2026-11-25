import type { Profile } from "@prisma/client";
import { parseJson } from "../utils";
import type { Education, Experience, Project } from "../matching/candidate";

export interface ResumeDoc {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string; linkedin: string; website: string };
  summary: string;
  skills: string[];
  experiences: Experience[];
  education: Education[];
  certifications: string[];
  projects: Project[];
}

export function resumeFromProfile(p: Profile): ResumeDoc {
  return {
    name: p.fullName,
    headline: p.headline,
    contact: { email: p.email, phone: p.phone, location: p.location, linkedin: p.linkedin, website: p.website },
    summary: p.summary,
    skills: parseJson<string[]>(p.skills, []),
    experiences: parseJson<Experience[]>(p.experiences, []).map((e) => ({ ...e, bullets: e.bullets ?? [] })),
    education: parseJson<Education[]>(p.education, []),
    certifications: parseJson<string[]>(p.certifications, []),
    projects: parseJson<Project[]>(p.projects, []),
  };
}

/** All text in a resume – the universe of facts the fabrication guard allows. */
export function resumeText(doc: ResumeDoc): string {
  return [
    doc.name,
    doc.headline,
    doc.summary,
    doc.skills.join(", "),
    ...doc.experiences.flatMap((e) => [e.title, e.company, e.location ?? "", e.start ?? "", e.end ?? "", ...e.bullets]),
    ...doc.education.flatMap((e) => [e.degree, e.school, e.field ?? "", e.start ?? "", e.end ?? ""]),
    ...doc.certifications,
    ...doc.projects.flatMap((p) => [p.name, p.description]),
  ].join("\n");
}

export const REQUIRED_PROFILE_FIELDS: { key: keyof Profile; label: string }[] = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "currentCountry", label: "Current country" },
  { key: "citizenship", label: "Citizenship" },
  { key: "skills", label: "Skills" },
  { key: "experiences", label: "Work history" },
];

export function missingProfileFields(p: Profile): string[] {
  const missing: string[] = [];
  for (const f of REQUIRED_PROFILE_FIELDS) {
    const v = p[f.key];
    if (typeof v === "string") {
      if (v.trim() === "" || v.trim() === "[]") missing.push(f.label);
    } else if (v == null) missing.push(f.label);
  }
  return missing;
}
