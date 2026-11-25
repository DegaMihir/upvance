/**
 * Answers to open questions on application forms – "Why do you want to work at Stripe?",
 * "Why this role?", "Tell us about a project you're proud of" – written by the app from your
 * resume and the job description, in plain English that reads like a person wrote it.
 *
 * Truthful: only facts from your profile. Every answer is checked (numbers, tools/skills and
 * names must come from your resume or the job posting) and dropped if it fails. Answers are
 * saved with the application so you can read and edit them before anything is submitted.
 */
import { runAI } from "../ai";
import { TRUTH_RULES } from "../ai/prompts";
import { checkText } from "../resume/guard";
import { extractSkills, skillSet } from "../skills";
import type { ScreeningAnswer } from "./screening";

export interface OpenQuestion {
  uid: string;
  label: string;
  /** character limit from the form, if any */
  maxLength?: number | null;
}

export interface OpenAnswerContext {
  jobTitle: string;
  company: string;
  jobDescription: string;
  resumeText: string;
  profileSkills: string[];
  currentTitle?: string;
  yearsExperience?: number | null;
}

/** Open-ended questions the app should write an answer for (not facts like phone or salary). */
const OPEN =
  /\bwhy\b|what (interests|excites|attracts|draws|appeals|motivates)|interested in (this|the|our|joining|working)|tell us|tell me|describe|share (an?|one|some)|proud|motivat|about yourself|introduce yourself|what makes you|what would you|how would you|what do you (hope|want|bring)|what are you looking for|anything else|additional (information|comments)|cover letter|a bit about you|your (approach|experience with)/i;
const NOT_OPEN = /salary|compensation|notice|start date|visa|sponsor|authori[sz]|relocat|linkedin|github|website|url|phone|email|address|gender|race|ethnic|veteran|disab|pronoun|years of/i;

export function isOpenQuestion(field: { label: string; kind: string }): boolean {
  if (!["textarea", "text"].includes(field.kind)) return false;
  if (NOT_OPEN.test(field.label)) return false;
  if (field.kind === "text" && field.label.length < 20) return false; // short text boxes are usually facts
  return OPEN.test(field.label);
}

/** Words that make text sound machine-written – the prompt forbids them and the checker rejects them. */
export const BUZZWORDS = ["passionate", "leverage", "leveraging", "synergy", "synergies", "cutting-edge", "cutting edge", "thrilled", "delve", "dynamic", "fast-paced", "innovative", "spearhead", "spearheaded", "game-changer", "game changing", "world-class", "best-in-class", "unparalleled", "tapestry", "testament", "navigate the", "ever-evolving", "seamless", "robust solutions", "i am excited to apply", "i'm excited to apply", "perfect fit", "dream job", "honed", "elevate"];

/** Plain-English check: no buzzwords, no lists or headings, not too long. */
export function soundsHuman(text: string): string | null {
  const t = text.toLowerCase();
  const bad = BUZZWORDS.find((w) => t.includes(w));
  if (bad) return `uses the phrase “${bad}”`;
  if (/^\s*([-*•]|\d+\.)\s/m.test(text) || /^#+\s/m.test(text)) return "uses a list or heading";
  if (/—/.test(text)) return "uses long dashes";
  return null;
}

/** Truth check: numbers, tools and names must come from your resume (names may also come from the job posting). */
export function checkOpenAnswer(answer: string, ctx: OpenAnswerContext): string | null {
  // your profile facts count too (e.g. years of experience), alongside the resume and the posting
  const profileFacts = [ctx.currentTitle ?? "", ctx.yearsExperience != null ? String(Math.floor(ctx.yearsExperience)) : ""].join("\n");
  const resumeAndJob = `${ctx.resumeText}\n${profileFacts}\n${ctx.jobTitle}\n${ctx.company}\n${ctx.jobDescription}`;
  const issue = checkText(answer, resumeAndJob, resumeAndJob, ctx.profileSkills);
  if (issue) return issue;
  // Tools/skills you *have* must really be yours – not just mentioned in the job posting.
  const mine = skillSet(ctx.profileSkills);
  const inResume = new Set(extractSkills(ctx.resumeText).map((s) => s.toLowerCase()));
  for (const s of extractSkills(answer)) {
    if (!mine.has(s.toLowerCase()) && !inResume.has(s.toLowerCase())) return `mentions “${s}”, which isn't on your profile`;
  }
  return soundsHuman(answer);
}

const STYLE = `How to write each answer:
- First person, plain everyday English, like a thoughtful person typing into a form. Short sentences.
- Be specific: connect one or two real things from the candidate's experience to one or two concrete things from the job posting.
- 60–130 words unless the question or a character limit asks for less. No greeting, no sign-off, no lists, no headings, no long dashes.
- Don't flatter the company and don't repeat its marketing. Only mention facts about the company that are in the job posting.
- Never use these words or phrases: ${BUZZWORDS.join(", ")}.
- If the candidate's data can't support an honest answer (e.g. it asks about something they haven't done), answer exactly "NEEDS_USER".`;

/** Ask the AI for answers; keep only the ones that pass the truth and plain-English checks. */
export async function writeOpenAnswers(questions: OpenQuestion[], ctx: OpenAnswerContext, userId?: string | null): Promise<{ answers: Record<string, string>; rejected: { uid: string; reason: string }[] }> {
  const out: Record<string, string> = {};
  const rejected: { uid: string; reason: string }[] = [];
  if (!questions.length) return { answers: out, rejected };
  const res = await runAI<{ answers: { uid: string; answer: string }[] }>({
    role: "writing",
    task: "open-answers",
    userId,
    input: {
      system: `You write a job candidate's answers to open questions on an application form. ${TRUTH_RULES}\n${STYLE}\nRespond with JSON {"answers":[{"uid":"...","answer":"..."}]}.`,
      prompt: `Job: ${ctx.jobTitle} at ${ctx.company}\n\nJob posting:\n${ctx.jobDescription.slice(0, 5000)}\n\nCandidate (the only facts you may use):\n${ctx.resumeText.slice(0, 6000)}\n\nQuestions:\n${questions.map((q) => `- uid ${q.uid}: ${q.label}${q.maxLength ? ` (at most ${q.maxLength} characters)` : ""}`).join("\n")}`,
      json: true,
      maxTokens: 2000,
      temperature: 0.4,
    },
  });
  if (res.ok) {
    for (const a of res.data.answers ?? []) {
      const q = questions.find((x) => x.uid === a.uid);
      if (!q || !a.answer || /NEEDS_USER/i.test(a.answer)) continue;
      let text = a.answer.trim().replace(/\s*—\s*/g, ", ");
      if (q.maxLength && text.length > q.maxLength) text = trimTo(text, q.maxLength);
      const issue = checkOpenAnswer(text, ctx);
      if (issue) rejected.push({ uid: q.uid, reason: issue });
      else out[q.uid] = text;
    }
  }
  // No AI (or it declined): a plain template for "why this company / role" questions only.
  for (const q of questions) {
    if (out[q.uid] || !isWhyCompanyQuestion(q.label)) continue;
    const t = templateAnswer(ctx);
    if (t && !checkOpenAnswer(t, ctx)) out[q.uid] = q.maxLength ? trimTo(t, q.maxLength) : t;
  }
  return { answers: out, rejected };
}

/** "Why do you want to work here / this role?" – the only kind the plain template can answer honestly. */
export function isWhyCompanyQuestion(label: string) {
  if (/^\s*(describe|tell|share|explain|give|walk|what is your|what's your)/i.test(label)) return false;
  return /\bwhy\b[^?]*\b(work|join|apply|applying|interested|us|company|role|position|team|here|opportunity)\b|what (interests|attracts|excites|draws|appeals to) you|interest(ed)? in (this|the|our|joining|working)|motivat\w* (you )?to (apply|join)/i.test(label);
}

/** Plain fallback when AI isn't available – built only from your profile and the job's own words. */
export function templateAnswer(ctx: OpenAnswerContext): string | null {
  const mine = skillSet(ctx.profileSkills);
  const shared = extractSkills(ctx.jobDescription).filter((s) => mine.has(s.toLowerCase())).slice(0, 3);
  if (!ctx.currentTitle && !shared.length) return null;
  const who = ctx.currentTitle ? `I work as a ${ctx.currentTitle}` : "My background is in software";
  const years = ctx.yearsExperience ? ` with about ${Math.floor(ctx.yearsExperience)} years of experience` : "";
  const skills = shared.length ? `, working with ${list(shared)}` : "";
  return `${who}${years}${skills}. The ${ctx.jobTitle} role at ${ctx.company} asks for that same kind of work, so I'd be using what I already do every day from the start. I'd like to keep building in that area on a team that works on it seriously, and this role looks like a good place to do that.`;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
function trimTo(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "");
}

/** Saved answers live with the application (id "open:<question>") so you can edit them before submitting. */
export const openAnswerId = (question: string) => `open:${question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120)}`;

export function upsertOpenAnswers(existing: ScreeningAnswer[], written: { question: string; answer: string; required: boolean }[]): ScreeningAnswer[] {
  const out = [...existing];
  for (const w of written) {
    const id = openAnswerId(w.question);
    const i = out.findIndex((a) => a.id === id);
    const row: ScreeningAnswer = { id, question: w.question, answer: w.answer, source: "ai-draft", category: "motivation", required: w.required };
    if (i >= 0) {
      if (out[i].source === "user") continue; // never overwrite your own edits
      out[i] = row;
    } else out.push(row);
  }
  return out;
}
