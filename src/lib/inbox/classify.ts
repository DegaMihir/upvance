/**
 * Email classification: AI when configured, rule-based fallback always available.
 */
import { runAI } from "../ai";

export const CATEGORIES = ["Interview", "Recruiter", "Assessment", "Offer", "Rejection", "Reminder", "Applied", "Verification", "Other"] as const;
export type EmailCategory = (typeof CATEGORIES)[number];

export interface MailLike {
  fromAddress: string;
  fromName?: string;
  subject: string;
  bodyText: string;
}

const RULES: [EmailCategory, RegExp][] = [
  ["Verification", /\b(verification code|verify your (email|account|identity)|one[- ]time (pass)?code|security code|confirm your email|your code is|enter (this|the) code|activate your account)\b/i],
  ["Offer", /\b(pleased|delighted|happy|excited) to (extend|offer)|offer letter|job offer|formal offer|offer of employment\b/i],
  ["Rejection", /\b(unfortunately|regret to inform|not (be )?(moving|move) forward|decided (not )?to (move forward|pursue|proceed) with other|other candidates|position has been filled|will not be (progressing|proceeding)|not been selected|unable to offer you|not successful)\b/i],
  ["Interview", /\b(schedule (an?|your) (interview|call|chat)|interview (invitation|request|with)|invite you (to|for) (an? )?(interview|call|conversation)|phone screen|book a time|calendly\.com|next round|on-?site interview|meet the team)\b/i],
  ["Assessment", /\b(assessment|coding (challenge|test|exercise)|take[- ]home|hackerrank|codility|codesignal|testgorilla|technical (test|exercise)|complete (the|this|a) (test|challenge))\b/i],
  ["Applied", /\b(thank(s| you) for (applying|your application|your interest)|we('ve| have) received your application|application (has been )?(received|submitted)|successfully (applied|submitted)|confirm(ing|ation of) your application)\b/i],
  ["Reminder", /\b(reminder|don'?t forget|complete your application|finish your application|still interested|upcoming (interview|call)|deadline)\b/i],
  ["Recruiter", /\b(recruit(er|ing)|talent (partner|acquisition|team)|came across your (profile|resume)|reaching out|your background|open to (new )?opportunities|would love to (chat|connect))\b/i],
];

export function classifyWithRules(m: MailLike): { category: EmailCategory; confidence: "high" | "medium" | "low" } {
  const text = `${m.subject}\n${m.bodyText.slice(0, 4000)}`;
  for (const [cat, re] of RULES) {
    if (re.test(m.subject)) return { category: cat, confidence: "high" };
  }
  for (const [cat, re] of RULES) {
    if (re.test(text)) return { category: cat, confidence: "medium" };
  }
  return { category: "Other", confidence: "low" };
}

export async function classifyEmail(m: MailLike, userId?: string | null): Promise<{ category: EmailCategory; by: "ai" | "rules" }> {
  const rules = classifyWithRules(m);
  if (rules.confidence === "high") return { category: rules.category, by: "rules" };
  const res = await runAI<{ category: string }>({
    role: "analysis",
    task: "email-classify",
    userId,
    input: {
      system: `Classify an email a job seeker received. Categories: ${CATEGORIES.join(", ")}. "Applied" = confirmation that an application was received. "Verification" = one-time codes or verify-your-email links. "Rejection" only when the email clearly declines. Silence is never a rejection. Respond with JSON {"category": "..."}.`,
      prompt: `From: ${m.fromName ?? ""} <${m.fromAddress}>\nSubject: ${m.subject}\n\n${m.bodyText.slice(0, 3000)}`,
      json: true,
      maxTokens: 50,
      temperature: 0,
    },
  });
  if (res.ok && (CATEGORIES as readonly string[]).includes(res.data.category)) return { category: res.data.category as EmailCategory, by: "ai" };
  return { category: rules.category, by: "rules" };
}

/** One-time codes and verification links in an email. */
export function extractCodes(m: MailLike): { codes: string[]; links: string[] } {
  const text = `${m.subject}\n${m.bodyText}`;
  const codes = new Set<string>();
  for (const re of [
    /\b(?:code|passcode|pin|otp)\b[^\n\d]{0,40}?\b([A-Z0-9]{4,8})\b/gi,
    /\b([0-9]{4,8})\b(?=[^\n]{0,40}\b(?:is your|verification|code)\b)/gi,
  ]) {
    for (const mt of text.matchAll(re)) {
      const c = mt[1];
      if (/^\d{4}$/.test(c) && Number(c) > 1900 && Number(c) < 2100) continue; // a year
      if (/\d/.test(c)) codes.add(c);
    }
  }
  const links = Array.from(new Set((text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []).filter((l) => /verif|confirm|activate|validate|magic|token=/i.test(l))));
  return { codes: Array.from(codes), links };
}

/** Short human summary for the Applications sheet. */
export function summarize(m: MailLike, category: EmailCategory): string {
  const first = m.bodyText.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 140) ?? "";
  return `${category}: ${m.subject.slice(0, 100)}${first ? ` – ${first}` : ""}`.slice(0, 240);
}
