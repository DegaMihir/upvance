/**
 * Resume parsing: PDF → text → structured profile.
 * Uses AI when available (analysis role); otherwise a rules-based parser.
 * Either way the user reviews and edits every field.
 */
import { runAI } from "../ai";
import { RESUME_PARSE_SYSTEM, resumeParsePrompt } from "../ai/prompts";
import { extractSkills, canonicalSkill } from "../skills";
import { findCountries } from "../countries";
import type { Education, Experience, Project } from "../matching/candidate";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export interface ParsedResume {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  headline: string;
  summary: string;
  skills: string[];
  experiences: Experience[];
  education: Education[];
  certifications: string[];
  projects: Project[];
  currentCountry?: string;
}

/** Extract text lines from a PDF, rebuilding lines from text positions. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  if (data.byteLength > MAX_RESUME_BYTES) throw new Error("PDF is larger than 10 MB.");
  const head = Buffer.from(data.slice(0, 5)).toString("latin1");
  if (head !== "%PDF-") throw new Error("That file isn't a PDF.");
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      if (!("str" in item)) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5]);
      let line = lines.find((l) => Math.abs(l.y - y) <= 2);
      if (!line) {
        line = { y, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x, s: item.str });
    }
    lines.sort((a, b) => b.y - a.y);
    pages.push(
      lines
        .map((l) =>
          l.parts
            .sort((a, b) => a.x - b.x)
            .map((p) => p.s)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join("\n"),
    );
  }
  return pages.join("\n\n");
}

const HEADINGS: Record<string, RegExp> = {
  summary: /^(summary|professional summary|profile|about me|objective|career objective)$/i,
  experience: /^(experience|work experience|professional experience|employment|employment history|work history|career history)$/i,
  education: /^(education|academic background|qualifications|education & training)$/i,
  skills: /^(skills|technical skills|core skills|key skills|skills & tools|technologies|core competencies)$/i,
  certifications: /^(certifications|certificates|licenses|licenses & certifications|courses)$/i,
  projects: /^(projects|selected projects|personal projects|side projects)$/i,
};

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4})`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now|today)`, "i");

function toYm(s: string): string {
  if (/present|current|now|today/i.test(s)) return "Present";
  const m1 = s.match(new RegExp(`${MONTH}\\s+(\\d{4})`, "i"));
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  if (m1) return `${m1[2]}-${String(months.indexOf(m1[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}`;
  const m2 = s.match(/(\d{1,2})[/.-](\d{4})/);
  if (m2) return `${m2[2]}-${m2[1].padStart(2, "0")}`;
  return s.match(/\d{4}/)?.[0] ?? s;
}

export function parseResumeText(text: string): ParsedResume {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? "";
  const linkedin = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?/i)?.[0] ?? "";
  const website =
    text
      .match(/(https?:\/\/)?(www\.)?(github\.com\/[\w-]+|[\w-]+\.(dev|io|me|com|net|org)(\/[\w-]*)?)/gi)
      ?.find((u) => !/linkedin|@/.test(u) && !email.includes(u.replace(/^https?:\/\//, ""))) ?? "";

  // Name: first short line without contact info
  const fullName = lines.find((l) => l.split(/\s+/).length <= 5 && !/[@\d|]|http|linkedin/i.test(l) && /^[A-Za-zÀ-ÿ' .-]+$/.test(l)) ?? "";

  // Split into sections
  const sections: Record<string, string[]> = { header: [] };
  let current = "header";
  for (const l of lines) {
    const h = l.replace(/[:\s]+$/, "");
    const key = Object.entries(HEADINGS).find(([, re]) => re.test(h))?.[0];
    if (key) {
      current = key;
      sections[current] = sections[current] ?? [];
      continue;
    }
    (sections[current] = sections[current] ?? []).push(l);
  }

  const header = sections.header ?? [];
  const headline = header.find((l) => l !== fullName && !/[@]|http|linkedin|\+?\d{3}/i.test(l) && l.length < 90) ?? "";
  const location =
    header
      .filter((l) => findCountries(l).length > 0)
      .flatMap((l) => l.split(/[|•·]/).map((s) => s.trim()))
      .find((s) => findCountries(s).length > 0 && !/@|linkedin|http|\d{5,}/i.test(s) && s.length < 60) ?? "";

  // Skills
  const skillLines = sections.skills ?? [];
  const listed = skillLines
    .flatMap((l) => l.replace(/^[^:]{1,25}:\s*/, "").split(/[,|•·;]/))
    .map((s) => s.replace(/^[-*\s]+/, "").trim())
    .filter((s) => s.length > 1 && s.length < 40);
  const skills = Array.from(new Set([...listed.map(canonicalSkill), ...extractSkills(text)]));

  // Experience
  const experiences: Experience[] = [];
  const expLines = sections.experience ?? [];
  for (let i = 0; i < expLines.length; i++) {
    const l = expLines[i];
    const m = l.match(RANGE);
    if (m) {
      const before = l.replace(RANGE, "").replace(/[|,–—-]\s*$/, "").replace(/^\s*[|]\s*/, "").trim();
      const prev = expLines[i - 1] ?? "";
      const prevUsable = prev && !/^[•\-*·]/.test(prev) && !RANGE.test(prev);
      let header = before;
      let location = "";
      // "City, Country | dates" on its own line → title/company is on the line above
      if ((!before || (findCountries(before).length > 0 && before.split(/\s+/).length <= 5)) && prevUsable) {
        location = before.replace(/\|/g, "").trim();
        header = prev;
      }
      const usedPrev = header === prev && !!prev;
      const parts = header.split(/\s+(?:at|@)\s+|\s*[|–—]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
      const title = parts[0] ?? "";
      let company = parts[1] ?? "";
      // Company on the next line if not found on this one
      if (!company && expLines[i + 1] && !/^[•\-*]/.test(expLines[i + 1]) && !RANGE.test(expLines[i + 1])) {
        company = expLines[i + 1].split(/[|,]/)[0].trim();
        i++;
      }
      // If the previous line was used as header, remove it from the last experience's bullets
      if (usedPrev && experiences.length) {
        const last = experiences[experiences.length - 1];
        if (last.bullets[last.bullets.length - 1] === prev) last.bullets.pop();
      }
      experiences.push({ title, company, location, start: toYm(m[1]), end: toYm(m[3] ?? m[2]), bullets: [] });
    } else if (experiences.length) {
      const b = l.replace(/^[•\-*·▪◦]\s*/, "").trim();
      if (b) {
        const last = experiences[experiences.length - 1];
        // join wrapped lines
        if (!/^[•\-*·▪◦]/.test(l) && last.bullets.length && !/[.;]$/.test(last.bullets[last.bullets.length - 1]) && /^[a-z]/.test(b)) {
          last.bullets[last.bullets.length - 1] += " " + b;
        } else last.bullets.push(b);
      }
    }
  }

  // Education
  const education: Education[] = [];
  const eduLines = sections.education ?? [];
  for (let i = 0; i < eduLines.length; i++) {
    const l = eduLines[i];
    if (/\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?sc|m\.?sc|b\.?e\b|b\.?s\b|m\.?s\b|phd|ph\.d|mba|diploma|degree|associate)/i.test(l)) {
      const next = eduLines[i + 1] ?? "";
      const nextIsSchool = !!next && !/\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?sc|m\.?sc|phd|mba|diploma)\b/i.test(next);
      const years = l.match(/\d{4}/g) ?? (nextIsSchool ? next.match(/\d{4}/g) : null) ?? [];
      const parts = l.replace(RANGE, "").split(/\s*[|,–—]\s*|\s+-\s+|\s+at\s+/).map((s) => s.trim()).filter(Boolean);
      let degree = parts[0] ?? l;
      let field = "";
      let school = "";
      if (nextIsSchool) {
        field = parts.slice(1).join(", ");
        school = next.split(/\s*\|\s*/)[0].replace(RANGE, "").replace(/\d{4}/g, "").replace(/[–—-]\s*$/, "").trim();
        i++;
      } else {
        school = parts[1] ?? "";
      }
      if (/\bin\b/.test(degree) && !field) [degree, field] = degree.split(/\s+in\s+/, 2) as [string, string];
      education.push({ degree, school, field, start: years.length > 1 ? years[0] : "", end: years[years.length - 1] ?? "" });
    }
  }

  const certifications = (sections.certifications ?? []).map((l) => l.replace(/^[•\-*·]\s*/, ""));
  const projects: Project[] = (sections.projects ?? [])
    .filter((l) => !/^[•\-*·]/.test(l) || l.length > 20)
    .slice(0, 8)
    .map((l) => {
      const [name, ...rest] = l.replace(/^[•\-*·]\s*/, "").split(/\s*[:–—]\s+/);
      return { name: name.slice(0, 80), description: rest.join(" – ") || "", link: "" };
    });
  const summary = (sections.summary ?? []).join(" ").slice(0, 1200);

  return {
    fullName,
    email,
    phone,
    location,
    linkedin,
    website,
    headline,
    summary,
    skills,
    experiences,
    education,
    certifications,
    projects,
    currentCountry: findCountries(location)[0] ?? "",
  };
}

/** Parse resume text with AI if configured, else rules. Never throws for AI errors. */
export async function parseResume(text: string, userId?: string | null): Promise<{ data: ParsedResume; parsedBy: "ai" | "rules"; note?: string }> {
  const rules = parseResumeText(text);
  const res = await runAI<Partial<ParsedResume>>({
    role: "analysis",
    task: "resume-parse",
    userId,
    input: { system: RESUME_PARSE_SYSTEM, prompt: resumeParsePrompt(text), json: true, maxTokens: 4000, temperature: 0 },
  });
  if (!res.ok) return { data: rules, parsedBy: "rules", note: res.reason };
  const ai = res.data;
  // Keep only AI values that literally appear in the resume text (no invented facts)
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  const present = (s?: string) => !!s && lower.includes(s.toLowerCase().replace(/\s+/g, " ").slice(0, 40));
  const merged: ParsedResume = {
    fullName: present(ai.fullName) ? ai.fullName! : rules.fullName,
    email: present(ai.email) ? ai.email! : rules.email,
    phone: ai.phone && lower.replace(/\D/g, "").includes(ai.phone.replace(/\D/g, "")) ? ai.phone : rules.phone,
    location: present(ai.location) ? ai.location! : rules.location,
    linkedin: present(ai.linkedin?.replace(/^https?:\/\/(www\.)?/, "")) ? ai.linkedin! : rules.linkedin,
    website: present(ai.website?.replace(/^https?:\/\/(www\.)?/, "")) ? ai.website! : rules.website,
    headline: present(ai.headline) ? ai.headline! : rules.headline,
    summary: ai.summary && ai.summary.length > 20 ? ai.summary : rules.summary,
    skills: Array.from(new Set([...(ai.skills ?? []).filter((s) => present(s)).map(canonicalSkill), ...rules.skills])),
    experiences: ai.experiences?.length ? ai.experiences.filter((e) => present(e.company) || present(e.title)).map((e) => ({ ...e, bullets: e.bullets ?? [] })) : rules.experiences,
    education: ai.education?.length ? ai.education.filter((e) => present(e.school) || present(e.degree)) : rules.education,
    certifications: (ai.certifications ?? rules.certifications).filter((c) => present(c)),
    projects: ai.projects?.length ? ai.projects.filter((p) => present(p.name)) : rules.projects,
  };
  merged.currentCountry = findCountries(merged.location)[0] ?? rules.currentCountry;
  return { data: merged, parsedBy: "ai" };
}
