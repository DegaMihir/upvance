/**
 * Application workflow:
 * Saved → Preparing → Needs you / Ready → (user confirms) Submitted → outcomes.
 * Nothing is ever marked Submitted without explicit user confirmation.
 */
import type { Application, Job, Company, Profile, TailoredResume, UserSettings } from "@prisma/client";
import { db } from "./db";
import { parseJson } from "./utils";
import { analyzeJob } from "./analysis";
import { analysisOf, evaluateJob, loadUserContext } from "./matching";
import { candidateFromProfile } from "./matching/candidate";
import { missingProfileFields, resumeFromProfile, type ResumeDoc } from "./resume/document";
import { tailorResume, diffDocs, type TailorMode } from "./resume/tailor";
import { generateCoverLetter } from "./writing/cover-letter";
import { standardAnswers, type ScreeningAnswer } from "./writing/screening";
import { checkDuplicates } from "./duplicates";
import { atsSupport } from "./ats";
import { decryptSecret } from "./crypto";

export const STATUSES = ["Saved", "Preparing", "Needs you", "Ready", "Submitted", "Recruiter response", "Assessment", "Interview", "Offer", "Rejected", "No response"] as const;
export type AppStatus = (typeof STATUSES)[number];
export const POST_SUBMIT: AppStatus[] = ["Submitted", "Recruiter response", "Assessment", "Interview", "Offer", "Rejected", "No response"];
export const RESPONSE_STATUSES: AppStatus[] = ["Recruiter response", "Assessment", "Interview", "Offer"];

export class DuplicateError extends Error {
  constructor(public details: { level: string; text: string; applicationId?: string }[]) {
    super(details.filter((d) => d.level === "block").map((d) => d.text).join(" "));
  }
}

export interface ValidationCheck {
  id: string;
  label: string;
  ok: boolean;
  level: "block" | "warn";
  detail: string;
  acknowledgeable?: boolean;
}
export interface ValidationState {
  checks: ValidationCheck[];
  acknowledged: string[];
}

export async function logEvent(applicationId: string, type: string, message: string) {
  await db.applicationEvent.create({ data: { applicationId, type, message } });
}

export async function createApplication(
  userId: string,
  jobId: string,
  opts: { profileId?: string | null; origin?: "manual" | "auto" | "extension" | "engine" | "manual-entry"; savedSearchId?: string | null } = {},
) {
  const dup = await checkDuplicates(userId, jobId);
  if (dup.blocked) throw new DuplicateError(dup.messages);
  const ctx = await loadUserContext(userId, opts.profileId);
  if (!ctx.profile) throw new Error("Create a profile first (Profile page).");
  const app = await db.application.create({
    data: { userId, jobId, profileId: ctx.profile.id, origin: opts.origin ?? "manual", savedSearchId: opts.savedSearchId ?? null, status: "Saved" },
  });
  await logEvent(app.id, "created", `Application created (${opts.origin ?? "manual"}).`);
  for (const m of dup.messages.filter((m) => m.level === "warn")) await logEvent(app.id, "warning", m.text);
  await db.match.updateMany({ where: { userId, jobId }, data: { status: "saved" } });
  return app;
}

type FullApp = Application & { job: Job & { company: Company }; profile: Profile; tailoredResume: TailoredResume | null };

async function loadApp(id: string, userId: string): Promise<FullApp> {
  const app = await db.application.findFirst({ where: { id, userId }, include: { job: { include: { company: true } }, profile: true, tailoredResume: true } });
  if (!app) throw new Error("Application not found");
  return app;
}

/** Prepare tailored resume, cover letter and screening answers, then validate. */
export async function prepareApplication(id: string, userId: string, opts: { useAI?: boolean } = {}) {
  const app = await loadApp(id, userId);
  if (POST_SUBMIT.includes(app.status as AppStatus)) throw new Error("This application was already submitted.");
  await db.application.update({ where: { id }, data: { status: "Preparing" } });
  await logEvent(id, "preparing", "Preparing documents.");
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const notes: string[] = [];

  // Analysis (AI only if allowed; cached so the same job is never analysed twice)
  const { analysis, aiNote } = await analyzeJob(app.job, { useAI: opts.useAI !== false, userId });
  if (aiNote) notes.push(aiNote);
  const job = await db.job.findUniqueOrThrow({ where: { id: app.jobId }, include: { company: true } });

  // Resume
  const original = resumeFromProfile(app.profile);
  const mode = (settings?.resumeMode ?? "honest") as TailorMode;
  const tailored = await tailorResume(original, { ...analysis, company: job.company.name }, mode, { userId, useAI: opts.useAI !== false });
  if (tailored.note) notes.push(tailored.note);
  const status = mode === "off" ? "use-original" : settings?.resumeApproval === false ? "approved" : "draft";
  const tr = await db.tailoredResume.upsert({
    where: { userId_jobId_profileId: { userId, jobId: job.id, profileId: app.profileId } },
    create: {
      userId,
      jobId: job.id,
      profileId: app.profileId,
      mode,
      original: JSON.stringify(original),
      tailored: JSON.stringify(tailored.doc),
      changes: JSON.stringify(tailored.changes),
      guardLog: JSON.stringify(tailored.guard),
      status,
      generator: tailored.generator,
    },
    update: {
      mode,
      original: JSON.stringify(original),
      tailored: JSON.stringify(tailored.doc),
      changes: JSON.stringify(tailored.changes),
      guardLog: JSON.stringify(tailored.guard),
      status,
      generator: tailored.generator,
    },
  });

  // Cover letter (only when the employer accepts/requires one, or the user asked)
  const candidate = candidateFromProfile(app.profile);
  const ev = evaluateJob(job, candidate, (await loadUserContext(userId)).prefs);
  const needed = analysis.coverLetter === "required" || analysis.coverLetter === "optional" || app.coverLetterNeeded;
  let coverLetter: string | null = app.coverLetter;
  let coverLetterStatus = app.coverLetterStatus;
  if (needed) {
    const cl = await generateCoverLetter(
      {
        doc: tailored.doc,
        jobId: job.id,
        title: job.title,
        company: job.company.name,
        analysis,
        yearsExperience: candidate.yearsExperience,
        currentCountry: candidate.currentCountry,
        needsVisaFor: ev.eligibility.needsSponsorshipFor,
        willingToRelocate: candidate.willingToRelocate,
      },
      { userId, useAI: opts.useAI !== false },
    );
    if (cl.note) notes.push(cl.note);
    coverLetter = cl.text;
    coverLetterStatus = settings?.coverLetterApproval === false ? "approved" : "draft";
  } else {
    coverLetterStatus = "not-needed";
  }

  // Screening answers – keep anything the user already answered
  const previous = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []);
  const answers = [
    ...standardAnswers(app.profile, candidate, analysis, job.company.name).map((a) => {
      const prev = previous.find((p) => p.id === a.id && p.source === "user");
      return prev ?? a;
    }),
    // answers to the form's open questions ("Why this company?") written earlier – keep them
    ...previous.filter((p) => p.id.startsWith("open:")),
  ];

  await db.application.update({
    where: { id },
    data: {
      tailoredResumeId: tr.id,
      coverLetter,
      coverLetterNeeded: needed,
      coverLetterStatus,
      screeningAnswers: JSON.stringify(answers),
    },
  });
  await logEvent(id, "prepared", `Documents prepared (resume: ${tailored.generator}, ${tailored.changes.length} changes${tailored.guard.length ? `, ${tailored.guard.length} unsupported edits reverted` : ""}).`);
  for (const n of notes) await logEvent(id, "note", n);
  return validateApplication(id, userId);
}

/** Run every pre-submission check and set status to Ready or Needs you. */
export async function validateApplication(id: string, userId: string) {
  const app = await loadApp(id, userId);
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const prev = parseJson<ValidationState>(app.validation, { checks: [], acknowledged: [] });
  const checks = await computeChecks(app, settings);
  const acknowledged = prev.acknowledged ?? [];
  const failing = checks.filter((c) => !c.ok && c.level === "block" && !(c.acknowledgeable && acknowledged.includes(c.id)));
  const state: ValidationState = { checks, acknowledged };
  const canChange = ["Saved", "Preparing", "Needs you", "Ready"].includes(app.status);
  const next = failing.length ? "Needs you" : "Ready";
  await db.application.update({
    where: { id },
    data: {
      validation: JSON.stringify(state),
      needsYou: JSON.stringify(failing.map((f) => ({ id: f.id, label: f.label, detail: f.detail }))),
      ...(canChange ? { status: next, queue: next === "Ready" ? "assisted" : null } : {}),
    },
  });
  if (canChange && app.status !== next) await logEvent(id, "status", next === "Ready" ? "All checks passed – ready for assisted apply." : `Needs you: ${failing.map((f) => f.label).join(", ")}.`);
  return { status: canChange ? next : app.status, checks, failing };
}

export async function computeChecks(app: FullApp, settings: UserSettings | null): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const job = app.job;
  const analysis = analysisOf(job);
  const add = (c: ValidationCheck) => checks.push(c);

  add({ id: "role", label: "Company & role", ok: !!(job.title && job.company.name && job.applyUrl), level: "block", detail: job.applyUrl ? `${job.title} at ${job.company.name}` : "No employer apply link stored for this job." });

  const missing = missingProfileFields(app.profile);
  add({ id: "candidate", label: "Your contact details", ok: missing.length === 0, level: "block", detail: missing.length ? `Missing in profile: ${missing.join(", ")}.` : "Profile complete." });

  const tr = app.tailoredResume;
  const needApproval = settings?.resumeApproval !== false;
  add({
    id: "resume",
    label: "Resume",
    ok: !!tr && (tr.status === "approved" || tr.status === "use-original" || !needApproval),
    level: "block",
    detail: !tr ? "No resume prepared yet." : tr.status === "draft" && needApproval ? "Review and approve the tailored resume (or choose the original)." : `Using ${tr.status === "use-original" ? "original" : "tailored"} resume (${app.profile.name}).`,
  });

  if (app.coverLetterNeeded) {
    const required = analysis.coverLetter === "required";
    const ok = !!app.coverLetter && (app.coverLetterStatus === "approved" || settings?.coverLetterApproval === false);
    add({ id: "cover", label: "Cover letter", ok, level: required ? "block" : "warn", detail: ok ? "Approved." : required ? "This employer requires a cover letter – review and approve it." : "Optional cover letter not approved yet (it won't be attached)." });
  }

  const answers = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []);
  for (const cat of ["work-auth", "sponsorship", "relocation", "salary"] as const) {
    const a = answers.find((x) => x.category === cat);
    if (!a) continue;
    const label = { "work-auth": "Work authorization answer", sponsorship: "Visa sponsorship answer", relocation: "Relocation answer", salary: "Salary expectation" }[cat];
    add({ id: `answer-${cat}`, label, ok: !!a.answer.trim(), level: "block", detail: a.answer.trim() ? a.answer : `Answer needed: “${a.question}”` });
  }
  const otherMissing = answers.filter((a) => a.required && !a.answer.trim() && !["work-auth", "sponsorship", "relocation", "salary"].includes(a.category));
  add({ id: "answers", label: "Screening answers", ok: otherMissing.length === 0, level: "block", detail: otherMissing.length ? `Missing: ${otherMissing.map((a) => a.question).join("; ")}` : "Standard answers filled from your profile." });

  // Eligibility (hard rules) – user may acknowledge "needs review", not "ineligible"
  const ctx = await loadUserContext(app.userId, app.profileId);
  if (ctx.candidate) {
    const ev = evaluateJob(job, ctx.candidate, ctx.prefs, ctx.weights);
    if (ev.eligibility.status === "Ineligible")
      add({ id: "eligibility", label: "Eligibility", ok: false, level: "block", detail: ev.eligibility.reasons.join(" ") });
    else if (ev.eligibility.status === "Needs review")
      add({ id: "eligibility", label: "Eligibility needs review", ok: false, level: "block", detail: ev.eligibility.reasons.join(" ") + " Confirm you've checked this.", acknowledgeable: true });
    else add({ id: "eligibility", label: "Eligibility", ok: true, level: "block", detail: ev.eligibility.notes.join(" ") || "Eligible." });
  }

  // Required documents mentioned in the posting
  const docsNeeded = ["portfolio", "transcript", "writing sample", "references", "work sample", "code sample"].filter((d) => new RegExp(`\\b${d}s?\\b[^.]{0,40}\\b(required|must|please (include|submit|attach))|\\b(include|submit|attach)\\b[^.]{0,30}\\b${d}`, "i").test(job.description));
  add({ id: "documents", label: "Required documents", ok: docsNeeded.length === 0, level: "block", detail: docsNeeded.length ? `The posting asks for: ${docsNeeded.join(", ")}. Attach these yourself, then confirm.` : "Resume" + (app.coverLetterNeeded ? " and cover letter" : "") + " only.", acknowledgeable: true });

  // ATS
  const support = atsSupport(job.atsType, !!decryptSecret(settings?.encryptedAppPassword));
  add({ id: "ats", label: "Application form", ok: support.level !== "unsupported" && support.level !== "needs-password", level: support.level === "unsupported" ? "block" : "warn", detail: support.note });

  // Auto-mode applications wait for the user's review when the saved search requires it (default ON)
  if (app.origin === "auto" && app.savedSearchId) {
    const search = await db.savedSearch.findUnique({ where: { id: app.savedSearchId } });
    if (search?.reviewRequired !== false)
      add({ id: "auto-review", label: "Review auto-prepared application", ok: false, level: "block", detail: `Prepared automatically by “${search?.name ?? "a saved search"}”. Check the documents, then confirm.`, acknowledgeable: true });
  }

  // Duplicates
  const dup = await checkDuplicates(app.userId, app.jobId, { excludeApplicationId: app.id });
  add({ id: "duplicates", label: "Duplicate check", ok: !dup.blocked, level: "block", detail: dup.messages.map((m) => m.text).join(" ") || "No duplicates found." });
  return checks;
}

export async function acknowledgeCheck(id: string, userId: string, checkId: string) {
  const app = await loadApp(id, userId);
  const state = parseJson<ValidationState>(app.validation, { checks: [], acknowledged: [] });
  const check = state.checks.find((c) => c.id === checkId);
  if (!check?.acknowledgeable) throw new Error("This item can't be skipped – it must be fixed.");
  state.acknowledged = Array.from(new Set([...(state.acknowledged ?? []), checkId]));
  await db.application.update({ where: { id }, data: { validation: JSON.stringify(state) } });
  await logEvent(id, "acknowledged", `You confirmed: ${check.label}.`);
  return validateApplication(id, userId);
}

export async function setResumeStatus(id: string, userId: string, status: "approved" | "use-original" | "draft", editedDoc?: ResumeDoc) {
  const app = await loadApp(id, userId);
  if (!app.tailoredResume) throw new Error("No resume prepared yet.");
  const original = parseJson<ResumeDoc>(app.tailoredResume.original, resumeFromProfile(app.profile));
  await db.tailoredResume.update({
    where: { id: app.tailoredResume.id },
    data: {
      status,
      ...(editedDoc ? { tailored: JSON.stringify(editedDoc), changes: JSON.stringify(diffDocs(original, editedDoc)) } : {}),
    },
  });
  await logEvent(id, "resume", status === "approved" ? "Tailored resume approved." : status === "use-original" ? "Chose the original resume." : "Resume edited.");
  return validateApplication(id, userId);
}

export async function setCoverLetter(id: string, userId: string, text: string | null, status: "draft" | "approved" | "not-needed") {
  await loadApp(id, userId);
  await db.application.update({
    where: { id },
    data: { ...(text !== null ? { coverLetter: text } : {}), coverLetterStatus: status, coverLetterNeeded: status !== "not-needed" },
  });
  await logEvent(id, "cover", status === "approved" ? "Cover letter approved." : status === "not-needed" ? "Cover letter removed." : "Cover letter edited.");
  return validateApplication(id, userId);
}

export async function saveAnswers(id: string, userId: string, updates: { id: string; answer: string }[]) {
  const app = await loadApp(id, userId);
  const answers = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []).map((a) => {
    const u = updates.find((x) => x.id === a.id);
    return u && u.answer !== a.answer ? { ...a, answer: u.answer, source: "user" as const } : a;
  });
  await db.application.update({ where: { id }, data: { screeningAnswers: JSON.stringify(answers) } });
  await logEvent(id, "answers", "Screening answers updated.");
  return validateApplication(id, userId);
}

/** Only an explicit user confirmation marks an application Submitted. */
export async function confirmSubmitted(id: string, userId: string, confirmation: { confirmed: boolean; via?: string }) {
  if (confirmation.confirmed !== true) throw new Error("Submission must be confirmed by you.");
  const app = await loadApp(id, userId);
  if (app.status !== "Ready") throw new Error(`Only applications that are Ready can be marked submitted (current: ${app.status}).`);
  const updated = await db.application.update({ where: { id }, data: { status: "Submitted", submittedAt: new Date(), queue: null, failed: false } });
  await logEvent(id, "submitted", `You confirmed the application was submitted${confirmation.via ? ` (${confirmation.via})` : ""}.`);
  return updated;
}

export async function markFailed(id: string, userId: string, reason: string) {
  await loadApp(id, userId);
  await db.application.update({ where: { id }, data: { failed: true, failureReason: reason, queue: null } });
  await logEvent(id, "failed", `Submission failed: ${reason} (not counted against your daily cap).`);
}

/** Update outcome after submission. Interview → pause that company. */
export async function setOutcome(id: string, userId: string, status: AppStatus, note?: string) {
  const app = await loadApp(id, userId);
  if (!POST_SUBMIT.includes(status)) throw new Error("Use the workflow buttons for pre-submission states.");
  if (!POST_SUBMIT.includes(app.status as AppStatus)) throw new Error("Confirm submission first.");
  await db.application.update({ where: { id }, data: { status, result: status === "Offer" || status === "Rejected" ? status : app.result } });
  await logEvent(id, "outcome", `Status → ${status}${note ? `: ${note}` : ""}`);
  if (status === "Interview") {
    const settings = await db.userSettings.findUnique({ where: { userId } });
    const days = Math.min(180, Math.max(7, settings?.interviewPauseDays ?? 60));
    const until = new Date(Date.now() + days * 86_400_000);
    await db.companyPause.create({ data: { userId, companyId: app.job.companyId, until, reason: `Interview recorded for ${app.job.title}` } });
    await logEvent(id, "pause", `New applications to ${app.job.company.name} paused for ${days} days.`);
  }
}
