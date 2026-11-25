/**
 * Generic form understanding for the apply engine: read every field on an
 * employer form (label, type, options, required) and decide a truthful answer
 * from the profile, screening answers and your sensitive-question defaults.
 * Anything the profile can't answer is left for you ("Needs you").
 */
import type { Page } from "playwright";
import type { ScreeningAnswer } from "../writing/screening";
import { runAI } from "../ai";
import { TRUTH_RULES } from "../ai/prompts";
import { isOpenQuestion, openAnswerId } from "../writing/open-answers";

export interface FormField {
  uid: string;
  kind: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "radio" | "checkbox" | "file" | "combobox" | "password";
  label: string;
  name: string;
  required: boolean;
  options: string[];
  value: string;
}

/** Runs in the browser: tag each visible field with data-upv-id and describe it. */
export async function readFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      if ((h as HTMLInputElement).type === "file") return true; // file inputs are often hidden behind a styled button
      const r = h.getBoundingClientRect();
      const st = getComputedStyle(h);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const labelOf = (el: HTMLElement): string => {
      const parts: string[] = [];
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(norm(l.textContent));
      }
      const wrap = el.closest("label");
      if (wrap) parts.push(norm(wrap.textContent));
      const lb = el.getAttribute("aria-labelledby");
      if (lb) lb.split(/\s+/).forEach((id) => parts.push(norm(document.getElementById(id)?.textContent)));
      parts.push(el.getAttribute("aria-label") ?? "", (el as HTMLInputElement).placeholder ?? "");
      const generic = /^(select\.{0,3}|choose\.{0,3}|attach|upload( file)?|browse|enter manually|please select|-+)$/i;
      let label = norm(parts.filter((p) => p && !generic.test(norm(p))).join(" "));
      // Generic or missing labels ("Attach", "Select...") – use the field group's own label
      if (!label || label.length < 3 || (el as HTMLInputElement).type === "file" || el.getAttribute("role") === "combobox") {
        const fs = el.closest("fieldset");
        const legend = norm(fs?.querySelector("legend")?.textContent);
        const box = el.closest('.field, [class*="field"], [class*="question"], .form-group, [role="group"], li');
        const groupLabel = norm(box?.querySelector('label, legend, [class*="label"], [id$="-label"]')?.textContent);
        const g = [legend, groupLabel].find((t) => t && !generic.test(t));
        if (g && !label.includes(g)) label = norm(`${g} ${label}`);
        if (!label && box) label = norm(box.textContent).slice(0, 200);
      }
      return label.slice(0, 300);
    };
    const out: {
      uid: string;
      kind: string;
      label: string;
      name: string;
      required: boolean;
      options: string[];
      value: string;
    }[] = [];
    let n = 0;
    const radiosDone = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("input, textarea, select")) as HTMLInputElement[]) {
      const type = (el.type || el.tagName).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "search"].includes(type) || el.disabled || !visible(el)) continue;
      if (type === "radio") {
        const group = el.name || el.id;
        if (radiosDone.has(group)) continue;
        radiosDone.add(group);
        const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)) as HTMLInputElement[];
        const fs = el.closest("fieldset");
        const q = norm(fs?.querySelector("legend")?.textContent) || norm(el.closest('[role=radiogroup], [class*="question"], [class*="field"]')?.querySelector("label, legend, [class*=label]")?.textContent) || el.name;
        const uid = `f${n++}`;
        radios.forEach((r, i) => r.setAttribute("data-upv-id", `${uid}-${i}`));
        out.push({ uid, kind: "radio", label: q.slice(0, 300), name: el.name, required: radios.some((r) => r.required) || /\*/.test(q), options: radios.map((r) => labelOf(r) || r.value), value: radios.find((r) => r.checked) ? labelOf(radios.find((r) => r.checked)!) : "" });
        continue;
      }
      const uid = `f${n++}`;
      el.setAttribute("data-upv-id", uid);
      const label = labelOf(el);
      const kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.getAttribute("role") === "combobox" ? "combobox" : type;
      const options = el.tagName === "SELECT" ? Array.from((el as unknown as HTMLSelectElement).options).map((o) => norm(o.text)) : [];
      out.push({ uid, kind, label, name: el.name || el.id, required: el.required || el.getAttribute("aria-required") === "true" || /\*/.test(label), options, value: type === "checkbox" ? (el.checked ? "true" : "") : el.value });
    }
    return out;
  }) as Promise<FormField[]>;
}

export interface Facts {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  city: string;
  country: string;
  linkedin: string;
  website: string;
  currentTitle: string;
  currentCompany: string;
  coverLetter: string | null;
  answers: ScreeningAnswer[];
  sensitive: Record<string, string>; // gender, race, veteran, disability, pronouns, salary...
  yearsExperience: number | null;
  school: string;
  degree: string;
}

export interface Decision {
  uid: string;
  label: string;
  kind: FormField["kind"];
  value: string | boolean | null; // null = can't answer
  source: "profile" | "answer" | "sensitive" | "consent" | "ai" | "file" | "needs-you";
  file?: "resume" | "cover";
}

const ans = (f: Facts, id: string) => f.answers.find((a) => a.id === id)?.answer || "";
const DECLINE = /prefer not|decline|don'?t wish|do not wish|not to (say|answer|disclose)|rather not|choose not/i;

function pickOption(options: string[], want: string): string | null {
  const w = want.toLowerCase().trim();
  if (!w) return null;
  const opts = options.filter((o) => o && !/^(select|choose|please select|--)/i.test(o));
  return opts.find((o) => o.toLowerCase() === w) ?? opts.find((o) => o.toLowerCase().startsWith(w)) ?? opts.find((o) => w.startsWith(o.toLowerCase()) && o.length > 1) ?? opts.find((o) => o.toLowerCase().includes(w)) ?? null;
}
const yesNo = (options: string[], yes: boolean) => pickOption(options, yes ? "yes" : "no");

/** Decide answers with deterministic rules. Unknown questions return null. */
export function decide(field: FormField, f: Facts): Decision {
  const l = field.label.toLowerCase();
  const d = (value: Decision["value"], source: Decision["source"], file?: Decision["file"]): Decision => ({ uid: field.uid, label: field.label, kind: field.kind, value, source, file });

  // An answer to this exact open question saved with the application (written by the app, maybe edited by you)
  if (isOpenQuestion(field)) {
    const saved = f.answers.find((a) => a.id === openAnswerId(field.label))?.answer;
    if (saved) return d(saved, "answer");
  }

  if (field.kind === "file") {
    if (/cover/.test(l)) return d(f.coverLetter ? "cover" : null, f.coverLetter ? "file" : "needs-you", f.coverLetter ? "cover" : undefined);
    return d("resume", "file", "resume");
  }
  if (field.kind === "password") return d(null, "needs-you");

  // Sensitive / voluntary questions: your defaults, else "prefer not to say", else pause
  const sensitiveKey = /gender|sex\b/.test(l) ? "gender" : /race|ethnic/.test(l) ? "race" : /veteran|military/.test(l) ? "veteran" : /disabilit/.test(l) ? "disability" : /pronoun/.test(l) ? "pronouns" : /sexual orientation|lgbt/.test(l) ? "orientation" : /hispanic|latino/.test(l) ? "hispanic" : null;
  if (sensitiveKey) {
    const pref = f.sensitive[sensitiveKey];
    const opts = field.options;
    if (pref && opts.length) return d(pickOption(opts, pref), pickOption(opts, pref) ? "sensitive" : "needs-you");
    if (pref && !opts.length) return d(pref, "sensitive");
    const decline = opts.find((o) => DECLINE.test(o));
    if (decline) return d(decline, "sensitive");
    return d(null, field.required ? "needs-you" : "sensitive");
  }

  // Consent to process the application (privacy notice) – required to apply at all
  if (field.kind === "checkbox" && /(privacy|consent|data (protection|processing)|gdpr|i (have read|agree|acknowledge|confirm)|terms)/.test(l)) {
    if (/marketing|newsletter|future (jobs|opportunities)|talent (pool|community)|contact me about/.test(l)) return d(false, "consent");
    return d(field.required ? true : false, "consent");
  }

  const text = (v: string, s: Decision["source"] = "profile") => d(v || null, v ? s : "needs-you");
  // A real question ("Are you subject to any employment agreements…?") is never answered with a plain profile field
  const isQuestion = (/\?/.test(l) || /^(are|do|does|have|has|will|would|is|did|can|could|were|was)\b/.test(l)) && l.length > 30;
  if (!isQuestion) {
  if (/first name|given name|^first\b|fname/.test(l)) return text(f.firstName);
  if (/last name|surname|family name|lname/.test(l)) return text(f.lastName);
  if (/preferred (first )?name/.test(l)) return text(f.firstName);
  if (/full name|^name\b|^name \*|your name|legal name/.test(l)) return text(f.fullName);
  if (/e-?mail/.test(l)) return text(f.email);
  if (/phone|mobile|telephone/.test(l) && /country|code/.test(l)) return field.options.length ? d(pickOption(field.options, f.country), "profile") : text(f.country);
  if (/phone|mobile|telephone/.test(l)) return text(f.phone);
  if (/linkedin/.test(l)) return text(f.linkedin);
  if (/github|portfolio|website|personal site|blog/.test(l)) return d(f.website || null, f.website ? "profile" : field.required ? "needs-you" : "profile");
  if (/current (company|employer)|^company\b|organi[sz]ation/.test(l)) return text(f.currentCompany);
  if (/current (job )?title|^title\b|job title/.test(l)) return text(f.currentTitle);
  if (/school|university|college/.test(l)) return text(f.school);
  if (/degree/.test(l) && !/year/.test(l)) return field.options.length ? d(pickOption(field.options, f.degree), pickOption(field.options, f.degree) ? "profile" : "needs-you") : text(f.degree);
  }

  // Screening answers (authorisation, sponsorship, relocation, salary, notice...)
  if (/authori[sz]ed|legally (able|eligible|allowed)|right to work|work permit|eligible to work/.test(l)) {
    const a = ans(f, "work-auth");
    if (!a) return d(null, "needs-you");
    return field.options.length ? d(yesNo(field.options, /^yes/i.test(a)), "answer") : text(a, "answer");
  }
  if (/sponsor/.test(l)) {
    const a = ans(f, "sponsorship");
    if (!a) return d(null, "needs-you");
    return field.options.length ? d(yesNo(field.options, /^yes/i.test(a)), "answer") : text(a, "answer");
  }
  if (/relocat/.test(l)) {
    const a = ans(f, "relocation");
    if (!a) return d(null, field.required ? "needs-you" : "answer");
    return field.options.length ? d(yesNo(field.options, !/^no/i.test(a)), "answer") : text(a, "answer");
  }
  if (/salary|compensation|pay expectation|desired pay/.test(l)) {
    const v = f.sensitive.salary || ans(f, "salary");
    return v ? d(field.options.length ? pickOption(field.options, v) : v, "answer") : d(null, field.required ? "needs-you" : "answer");
  }
  if (/notice|start date|earliest|available to start|availability/.test(l)) return d(ans(f, "notice") || null, ans(f, "notice") ? "answer" : field.required ? "needs-you" : "answer");
  if (/years of (professional |relevant |work )?experience/.test(l) && f.yearsExperience != null) {
    const y = String(Math.floor(f.yearsExperience));
    return d(field.options.length ? pickOption(field.options, y) ?? field.options.find((o) => /\d/.test(o) && Number(o.match(/\d+/)![0]) <= Number(y)) ?? null : y, "profile");
  }
  if (/cover letter|motivation|why (do )?you want|why are you interested/.test(l) && field.kind === "textarea") {
    if (/cover letter/.test(l) && f.coverLetter) return d(f.coverLetter, "profile");
    const a = ans(f, "motivation");
    return d(a || null, a ? "answer" : field.required ? "needs-you" : "answer");
  }
  if (/\bcity\b/.test(l)) return text(f.city);
  if (/\bcountry\b/.test(l)) return field.options.length ? d(pickOption(field.options, f.country), pickOption(field.options, f.country) ? "profile" : "needs-you") : text(f.country);
  if (/location|address|where are you (based|located)/.test(l)) return text(f.location);
  if (/how did you hear|source|referr/.test(l)) {
    const o = field.options.length ? pickOption(field.options, "company website") ?? pickOption(field.options, "job board") ?? pickOption(field.options, "other") : "Company careers page";
    return d(o, "profile");
  }
  // Unknown question
  return d(null, field.required ? "needs-you" : "needs-you");
}

/** AI fallback for questions the rules can't answer – grounded in your profile only. */
export async function decideWithAI(fields: FormField[], f: Facts, userId: string, profileText: string): Promise<Record<string, string>> {
  if (!fields.length) return {};
  const res = await runAI<{ answers: { uid: string; answer: string }[] }>({
    role: "writing",
    task: "form-answers",
    userId,
    input: {
      system: `You fill job application form questions for a candidate. ${TRUTH_RULES}\nIf the candidate data doesn't contain the answer, answer exactly "NEEDS_USER". For multiple-choice questions answer with one of the given options exactly. Respond with JSON {"answers":[{"uid":"...","answer":"..."}]}.`,
      prompt: `Candidate facts:\n${profileText.slice(0, 6000)}\n\nQuestions:\n${fields.map((q) => `- uid ${q.uid}: ${q.label}${q.options.length ? ` (options: ${q.options.slice(0, 15).join(" | ")})` : ""}`).join("\n")}`,
      json: true,
      maxTokens: 1500,
      temperature: 0,
    },
  });
  if (!res.ok) return {};
  const out: Record<string, string> = {};
  for (const a of res.data.answers ?? []) {
    const fld = fields.find((x) => x.uid === a.uid);
    if (!fld || !a.answer || /NEEDS_USER/i.test(a.answer)) continue;
    if (fld.options.length && !fld.options.includes(a.answer)) continue; // must be a real option
    out[a.uid] = a.answer;
  }
  return out;
}

/** Type/select/check values into the page (never clicks submit). */
export async function fillField(page: Page, field: FormField, value: string | boolean, files: { resume: string; cover: string | null }, delay: () => Promise<void>) {
  const sel = `[data-upv-id="${field.uid}"]`;
  if (field.kind === "file") {
    const path = value === "cover" ? files.cover : files.resume;
    if (path) await page.setInputFiles(sel, path);
    return;
  }
  if (field.kind === "radio") {
    const idx = field.options.findIndex((o) => o === value);
    if (idx >= 0) await page.locator(`[data-upv-id="${field.uid}-${idx}"]`).check({ force: true });
    return;
  }
  if (field.kind === "checkbox") {
    if (value === true) await page.locator(sel).check({ force: true });
    return;
  }
  if (field.kind === "select") {
    await page.locator(sel).selectOption({ label: String(value) });
    return;
  }
  const loc = page.locator(sel);
  await loc.click({ timeout: 5000 }).catch(() => {});
  // searchable dropdowns: type a short option ("Yes"/"No") rather than a sentence
  const typed = field.kind === "combobox" ? (String(value).match(/^(Yes|No)\b/i)?.[1] ?? String(value)) : String(value);
  await loc.fill(typed);
  if (field.kind === "combobox") {
    await delay();
    await loc.press("Enter").catch(() => {});
  }
}

export const CAPTCHA_SELECTOR = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[title*="challenge" i], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]';
export const CONFIRMATION_TEXT = /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (submitted|applied)|your application is (in|complete)/i;
