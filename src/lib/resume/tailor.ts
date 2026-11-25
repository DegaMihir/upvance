/**
 * Resume tailoring. Modes:
 *  - off: original resume
 *  - honest: reorder skills/bullets for relevance, light summary emphasis
 *  - aggressive: stronger keyword emphasis – still only real facts
 * AI (writing role) is optional; every AI edit passes the fabrication guard.
 */
import { runAI } from "../ai";
import { TAILOR_SYSTEM, tailorPrompt } from "../ai/prompts";
import { skillSet } from "../skills";
import type { JobAnalysis } from "../analysis/types";
import { checkText, guardSkills, type GuardIssue } from "./guard";
import { resumeText, type ResumeDoc } from "./document";

export type TailorMode = "off" | "honest" | "aggressive";

export interface Change {
  section: string;
  kind: "rewritten" | "reordered" | "emphasised";
  before: string;
  after: string;
}

export interface TailorResult {
  doc: ResumeDoc;
  changes: Change[];
  guard: GuardIssue[];
  generator: "rules" | "ai" | "original";
  note?: string;
}

function relevance(text: string, keywords: string[]) {
  const t = text.toLowerCase();
  return keywords.reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Deterministic, no-AI tailoring. */
export function tailorWithRules(original: ResumeDoc, job: Pick<JobAnalysis, "skills" | "requiredSkills" | "responsibilities" | "title">, mode: TailorMode): TailorResult {
  const doc = clone(original);
  if (mode === "off") return { doc, changes: [], guard: [], generator: "original" };
  const keywords = Array.from(new Set([...job.requiredSkills, ...job.skills]));
  const respWords = job.responsibilities.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 5);
  const kw = [...keywords, ...(mode === "aggressive" ? respWords.slice(0, 30) : [])];

  // Skills: job-relevant first (only skills already on the profile)
  const jobSet = skillSet(keywords);
  const relevant = doc.skills.filter((s) => jobSet.has(s.toLowerCase()));
  const rest = doc.skills.filter((s) => !jobSet.has(s.toLowerCase()));
  doc.skills = [...relevant, ...rest];

  // Bullets: most relevant first within each role (stable)
  doc.experiences = doc.experiences.map((e) => ({
    ...e,
    bullets: e.bullets
      .map((b, i) => ({ b, i, r: relevance(b, kw) }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .map((x) => x.b),
  }));

  // Summary emphasis (aggressive): name the matching skills the candidate really has
  if (mode === "aggressive" && relevant.length) {
    const line = `Relevant strengths: ${relevant.slice(0, 6).join(", ")}.`;
    doc.summary = doc.summary ? `${doc.summary.trim()} ${line}` : line;
  }
  return { doc, changes: diffDocs(original, doc), guard: [], generator: "rules" };
}

type AiTailor = { summary?: string; skills?: string[]; experiences?: { index: number; bullets: { from: number; text: string }[] }[] };

/** Apply AI suggestions through the fabrication guard. Exported for tests. */
export function applyAiTailoring(original: ResumeDoc, ai: AiTailor): { doc: ResumeDoc; guard: GuardIssue[] } {
  const doc = clone(original);
  const full = resumeText(original);
  const guard: GuardIssue[] = [];

  if (ai.summary && ai.summary.trim()) {
    const problem = checkText(ai.summary, original.summary + "\n" + full, full, original.skills);
    if (problem) guard.push({ where: "Summary", reason: problem, attempted: ai.summary });
    else doc.summary = ai.summary.trim();
  }
  if (ai.skills?.length) {
    const g = guardSkills(ai.skills, original.skills);
    doc.skills = g.skills;
    guard.push(...g.issues);
  }
  for (const exp of ai.experiences ?? []) {
    const orig = original.experiences[exp.index];
    if (!orig) continue;
    const used = new Set<number>();
    const bullets: string[] = [];
    for (const b of exp.bullets ?? []) {
      const src = orig.bullets[b.from];
      if (src == null || used.has(b.from)) continue;
      used.add(b.from);
      const problem = checkText(b.text, src, full, original.skills);
      if (problem) {
        guard.push({ where: `${orig.title} @ ${orig.company}`, reason: problem, attempted: b.text });
        bullets.push(src);
      } else bullets.push(b.text.trim());
    }
    // Keep any bullet the AI dropped (we never silently remove experience)
    orig.bullets.forEach((b, i) => !used.has(i) && bullets.push(b));
    doc.experiences[exp.index] = { ...orig, bullets };
  }
  return { doc, guard };
}

export async function tailorResume(
  original: ResumeDoc,
  job: Pick<JobAnalysis, "skills" | "requiredSkills" | "responsibilities" | "title"> & { company: string },
  mode: TailorMode,
  opts: { userId?: string | null; useAI?: boolean } = {},
): Promise<TailorResult> {
  const rules = tailorWithRules(original, job, mode);
  if (mode === "off" || opts.useAI === false) return rules;

  const numbered = {
    summary: original.summary,
    skills: original.skills,
    experiences: original.experiences.map((e, index) => ({ index, title: e.title, company: e.company, bullets: e.bullets.map((text, i) => ({ i, text })) })),
  };
  const res = await runAI<AiTailor>({
    role: "writing",
    task: `tailor-${mode}`,
    userId: opts.userId,
    input: {
      system: TAILOR_SYSTEM,
      prompt: tailorPrompt(numbered, { title: job.title, company: job.company, skills: job.skills, responsibilities: job.responsibilities }, mode === "aggressive" ? "aggressive" : "honest"),
      json: true,
      maxTokens: 3000,
      temperature: mode === "aggressive" ? 0.5 : 0.3,
    },
  });
  if (!res.ok) return { ...rules, note: res.reason };
  const { doc, guard } = applyAiTailoring(original, res.data);
  return { doc, changes: diffDocs(original, doc), guard, generator: "ai" };
}

/** List every difference between two resume documents. */
export function diffDocs(a: ResumeDoc, b: ResumeDoc): Change[] {
  const changes: Change[] = [];
  if (a.summary.trim() !== b.summary.trim()) changes.push({ section: "Summary", kind: "rewritten", before: a.summary, after: b.summary });
  if (a.skills.join("|") !== b.skills.join("|"))
    changes.push({ section: "Skills", kind: "reordered", before: a.skills.join(", "), after: b.skills.join(", ") });
  b.experiences.forEach((e, i) => {
    const o = a.experiences[i];
    if (!o) return;
    const label = `${e.title} @ ${e.company}`;
    e.bullets.forEach((bl, j) => {
      if (o.bullets.includes(bl)) {
        if (o.bullets[j] !== bl) changes.push({ section: label, kind: "reordered", before: `#${o.bullets.indexOf(bl) + 1}: ${bl}`, after: `#${j + 1}: ${bl}` });
      } else {
        changes.push({ section: label, kind: "rewritten", before: o.bullets[j] ?? "", after: bl });
      }
    });
  });
  return changes;
}
