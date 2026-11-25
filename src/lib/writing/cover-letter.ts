/**
 * Cover letters. Template mode builds every paragraph from job-specific and
 * profile-specific facts, so two letters never share a paragraph.
 * AI mode (writing role) is optional and guarded against invented facts.
 */
import { runAI } from "../ai";
import { COVER_SYSTEM, coverPrompt } from "../ai/prompts";
import { hashKey } from "../text";
import { skillSet } from "../skills";
import { countryName } from "../countries";
import { checkText } from "../resume/guard";
import { resumeText, type ResumeDoc } from "../resume/document";
import type { JobAnalysis } from "../analysis/types";

export interface CoverInput {
  doc: ResumeDoc;
  jobId: string;
  title: string;
  company: string;
  analysis: Pick<JobAnalysis, "skills" | "requiredSkills" | "responsibilities" | "summary">;
  yearsExperience: number | null;
  currentCountry: string | null;
  needsVisaFor: string[];
  willingToRelocate: boolean;
}

function pick<T>(arr: T[], seed: string, salt: string): T {
  const h = parseInt(hashKey(seed, salt).slice(0, 8), 16);
  return arr[h % arr.length];
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function cleanResp(s: string) {
  return lowerFirst(s.replace(/[.;:]+$/, "").replace(/^(you will|you'll|you’ll|we need you to|responsible for)\s+/i, "").trim());
}

function bulletToClause(b: string) {
  return lowerFirst(b.replace(/\.$/, "").trim());
}

export function coverLetterFromTemplate(i: CoverInput): string {
  const seed = i.jobId;
  const jobSkills = skillSet([...i.analysis.requiredSkills, ...i.analysis.skills]);
  const matched = i.doc.skills.filter((s) => jobSkills.has(s.toLowerCase()));
  const resp = i.analysis.responsibilities.map(cleanResp).filter((r) => r.length > 10 && r.length < 160);
  const firstName = i.doc.name.split(" ")[0] || i.doc.name;

  // Most relevant role + bullets
  const scored = i.doc.experiences
    .map((e, idx) => ({ e, idx, r: e.bullets.reduce((n, b) => n + matched.filter((m) => b.toLowerCase().includes(m.toLowerCase())).length, 0) + (idx === 0 ? 0.5 : 0) }))
    .sort((a, b) => b.r - a.r);
  const top = scored[0]?.e;
  const topBullets = top
    ? [...top.bullets].sort((a, b) => matched.filter((m) => b.toLowerCase().includes(m.toLowerCase())).length - matched.filter((m) => a.toLowerCase().includes(m.toLowerCase())).length).slice(0, 2)
    : [];

  const yrs = i.yearsExperience ? `${Math.round(i.yearsExperience)} years` : null;
  const focus = resp[0] ? `, particularly the work on ${resp[0]}` : "";
  const opener = pick(
    [
      `I'm applying for the ${i.title} position at ${i.company}${focus}. ${yrs ? `I bring ${yrs} of hands-on experience` : "I bring practical experience"}${top ? ` – most recently as ${top.title} at ${top.company}` : ""}, and this role lines up closely with the work I want to keep doing.`,
      `The ${i.title} role at ${i.company} caught my attention${focus}. ${top ? `As ${top.title} at ${top.company}, ` : ""}I've spent ${yrs ?? "my recent career"} working on problems like the ones your team describes.`,
      `I'd like to be considered for ${i.company}'s ${i.title} opening. ${resp[0] ? `Reading that the role involves ${resp[0]}, ` : ""}I recognised a lot of my own day-to-day work${top ? ` at ${top.company}` : ""}.`,
      `${i.company} is hiring a ${i.title}, and I think my background is a good fit${focus}. ${yrs ? `Over ${yrs}` : "In my career so far"}${top ? `, including my time as ${top.title} at ${top.company},` : ""} I've focused on this kind of work.`,
    ],
    seed,
    "open",
  );

  const evidence = top
    ? `${pick(["At", "During my time at", "In my role at"], seed, "ev")} ${top.company}, I ${topBullets.map(bulletToClause).join(", and I ")}. ${
        resp[1] ? `That experience feeds directly into what you describe for this ${i.title} role: ${resp[1]}.` : `That's the experience I would bring to ${i.company}'s team.`
      }`
    : `My background is summarised in the attached resume, and I'd welcome the chance to discuss how it fits ${i.company}'s ${i.title} role.`;

  const skillsPara = matched.length
    ? `${pick(["On the technical side,", "In terms of skills,", "Looking at your requirements,"], seed, "sk")} ${i.company} asks for ${matched.slice(0, 4).join(", ")}${matched.length > 4 ? " and more" : ""} – all of which I use in my work today${resp[2] ? `, and which I'd apply to ${resp[2]}` : ""}.`
    : `${i.company}'s ${i.title} role would stretch me in useful ways; I learn new tools quickly and my resume shows how I've picked up new areas before.`;

  let logistics = "";
  if (i.needsVisaFor.length) {
    logistics = ` To be transparent: I'm based in ${i.currentCountry ? countryName(i.currentCountry) : "another country"} and would need visa sponsorship to work in ${i.needsVisaFor.map(countryName).join("/")}${i.willingToRelocate ? ", and I'm ready to relocate" : ""}.`;
  }
  const closer = pick(
    [
      `Thank you for considering my application for the ${i.title} role. I'd be glad to talk about how I could contribute at ${i.company}.${logistics}`,
      `I'd welcome a conversation about the ${i.title} position and what ${i.company} is building.${logistics} Thank you for your time.`,
      `Thanks for reading – I hope to discuss the ${i.title} role with the ${i.company} team soon.${logistics}`,
    ],
    seed,
    "close",
  );

  return [`Dear ${i.company} Hiring Team,`, opener, evidence, skillsPara, closer, `Kind regards,\n${i.doc.name || firstName}`].join("\n\n");
}

export async function generateCoverLetter(i: CoverInput, opts: { userId?: string | null; useAI?: boolean } = {}): Promise<{ text: string; generator: "ai" | "template"; note?: string }> {
  const template = coverLetterFromTemplate(i);
  if (opts.useAI === false) return { text: template, generator: "template" };
  const jobSkills = skillSet([...i.analysis.requiredSkills, ...i.analysis.skills]);
  const matched = i.doc.skills.filter((s) => jobSkills.has(s.toLowerCase()));
  const res = await runAI<string>({
    role: "writing",
    task: "cover-letter",
    userId: opts.userId,
    input: {
      system: COVER_SYSTEM,
      prompt: coverPrompt({
        candidate: { name: i.doc.name, headline: i.doc.headline, summary: i.doc.summary, skills: i.doc.skills, experiences: i.doc.experiences, education: i.doc.education, projects: i.doc.projects },
        job: { title: i.title, company: i.company, summary: i.analysis.summary, responsibilities: i.analysis.responsibilities, skills: i.analysis.skills },
        matched,
      }),
      maxTokens: 900,
      temperature: 0.7,
    },
  });
  if (!res.ok) return { text: template, generator: "template", note: res.reason };
  const text = res.data.trim();
  const full = resumeText(i.doc) + `\n${i.company}\n${i.title}\n${i.analysis.responsibilities.join("\n")}\n${i.analysis.summary ?? ""}\n${i.analysis.skills.join(", ")}`;
  const problem = checkText(text.replace(/^Dear[^\n]*\n/, ""), full, full, i.doc.skills);
  if (problem) return { text: template, generator: "template", note: `AI letter rejected: it ${problem}. Using the template version.` };
  return { text, generator: "ai" };
}
