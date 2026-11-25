/**
 * Apply engine (Playwright / Chromium, local). One application at a time,
 * human-paced, visible "watch mode" by default, with a Stop-all switch.
 *
 * For each queued job: prepare documents → open the real apply URL → (sign in
 * / create account if needed, using email codes from the inbox) → fill the form
 * truthfully → screenshot → STOP for your review (default) or submit (opt-in
 * auto submit) → detect the confirmation page/email.
 * CAPTCHAs and bot checks are never bypassed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { ApplyJob, Job, Company, Profile } from "@prisma/client";
import { db } from "../db";
import { parseJson } from "../utils";
import { decryptSecret } from "../crypto";
import { countryName } from "../countries";
import { notify } from "../notify";
import { logActivity } from "../activity";
import { DuplicateError, createApplication, logEvent, prepareApplication, validateApplication, type ValidationState } from "../applications";
import { resumeFromProfile, resumeText, type ResumeDoc } from "../resume/document";
import { resumeToPdf, textToPdf } from "../resume/export";
import type { ScreeningAnswer } from "../writing/screening";
import { isOpenQuestion, upsertOpenAnswers, writeOpenAnswers } from "../writing/open-answers";
import { getVerificationCode } from "../inbox/store";
import { setState } from "../tasks";
import { capInfo } from "./queue";
import { CAPTCHA_SELECTOR, CONFIRMATION_TEXT, decide, decideWithAI, fillField, readFields, type Decision, type Facts, type FormField } from "./form";

export interface EngineOptions {
  headless?: boolean;
  delayMs?: number;
  dryRun?: boolean; // stop before submit no matter what (used for tests on real sites)
  context?: BrowserContext; // injected in tests
  dataDir?: string;
  codeWaitMs?: number;
  captchaWaitMs?: number;
  log?: (s: string) => void;
}

const ROOT = process.cwd();
export const STOP_KEY = "engine-stop";
export const STATUS_KEY = "engine-status";

export async function setEngineStatus(state: string, message: string, applyJobId?: string | null) {
  await setState(STATUS_KEY, JSON.stringify({ state, message, applyJobId: applyJobId ?? null, at: new Date().toISOString() }));
}
export async function engineStatus(): Promise<{ state: string; message: string; applyJobId: string | null; at: string }> {
  const s = await db.systemState.findUnique({ where: { key: STATUS_KEY } });
  return s ? JSON.parse(s.value) : { state: "idle", message: "Waiting for jobs", applyJobId: null, at: new Date(0).toISOString() };
}
export async function stopAll(stop = true) {
  await setState(STOP_KEY, stop ? "1" : "0");
  if (stop) {
    await db.applyJob.updateMany({ where: { status: "running" }, data: { status: "queued", reason: "Stopped by you – will resume when you press Start" } });
    await setEngineStatus("stopped", "Stopped by you. Nothing will be submitted until you press Start.");
  } else await setEngineStatus("idle", "Ready");
}
export async function isStopped() {
  return (await db.systemState.findUnique({ where: { key: STOP_KEY } }))?.value === "1";
}

type FullJob = ApplyJob & { job: Job & { company: Company } };

async function addLog(id: string, msg: string, log?: (s: string) => void) {
  const j = await db.applyJob.findUnique({ where: { id }, select: { log: true } });
  const entries = parseJson<{ at: string; msg: string }[]>(j?.log, []);
  entries.push({ at: new Date().toISOString(), msg });
  await db.applyJob.update({ where: { id }, data: { log: JSON.stringify(entries.slice(-80)) } });
  log?.(msg);
}

/** Next job: approved reviews first, then queued by match score – within today's cap. */
export async function nextApplyJob(now = new Date()): Promise<FullJob | null> {
  const approved = await db.applyJob.findFirst({ where: { status: "approved" }, orderBy: { updatedAt: "asc" }, include: { job: { include: { company: true } } } });
  if (approved) return approved;
  const queued = await db.applyJob.findMany({ where: { status: "queued", notBefore: { lte: now } }, orderBy: [{ priority: "asc" }, { score: "desc" }, { createdAt: "asc" }], take: 50, include: { job: { include: { company: true } } } });
  for (const q of queued) {
    const cap = await capInfo(q.userId, now);
    if (cap.remaining > 0) return q;
  }
  if (queued.length) await setEngineStatus("cap", `Stopped – daily limit reached (${(await capInfo(queued[0].userId, now)).cap}). ${queued.length} job(s) wait for tomorrow.`);
  return null;
}

function factsFor(profile: Profile, doc: ResumeDoc, answers: ScreeningAnswer[], coverLetter: string | null, sensitive: Record<string, string>, applicationEmail: string): Facts {
  const [first, ...rest] = (doc.name || profile.fullName).trim().split(/\s+/);
  const edu = doc.education[0];
  return {
    firstName: first ?? "",
    lastName: rest.join(" "),
    fullName: doc.name || profile.fullName,
    email: applicationEmail || doc.contact.email,
    phone: doc.contact.phone,
    location: doc.contact.location,
    city: doc.contact.location.split(",")[0]?.trim() ?? "",
    country: profile.currentCountry ? countryName(profile.currentCountry) : doc.contact.location.split(",").pop()?.trim() ?? "",
    linkedin: doc.contact.linkedin,
    website: doc.contact.website,
    currentTitle: doc.experiences[0]?.title ?? doc.headline,
    currentCompany: doc.experiences[0]?.company ?? "",
    coverLetter,
    answers,
    sensitive,
    yearsExperience: profile.yearsExperience,
    school: edu?.school ?? "",
    degree: edu?.degree ?? "",
  };
}

async function humanDelay(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())));
}

/** Click the employer's "Apply" button if the form isn't on the page yet. */
async function openForm(page: Page, ats: string, url: string) {
  if (ats === "lever" && !/\/apply\/?$/.test(new URL(url).pathname)) await page.goto(url.replace(/\/?$/, "/apply"), { waitUntil: "domcontentloaded" });
  if (ats === "ashby" && !/\/application\/?$/.test(new URL(url).pathname)) await page.goto(url.replace(/\/?$/, "/application"), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("domcontentloaded");
  const inputs = await page.locator("input:visible:not([type=hidden]):not([type=search]), textarea:visible").count();
  if (inputs >= 2) return;
  const apply = page.getByRole("button", { name: /^(apply( now| for this (job|position|role))?|i'?m interested|start application)$/i }).or(page.getByRole("link", { name: /^(apply( now| for this (job|position|role))?|i'?m interested|start application)$/i }));
  if (await apply.count()) {
    await apply.first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function captchaVisible(page: Page) {
  // visible challenge widgets only – the invisible-reCAPTCHA corner badge is not a challenge
  const challenge = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).some((el) => {
      if (el.closest(".grecaptcha-badge")) return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 20 && r.height > 20 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
    });
  }, CAPTCHA_SELECTOR);
  if (challenge) return true;
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  return /verify (that )?you are (a )?human|are you a robot|security check|checking your browser/i.test(body);
}

/** Sign in / create an employer account, entering an email code from the inbox if asked. */
async function handleAccount(page: Page, aj: FullJob, applicationEmail: string, password: string | null, opts: EngineOptions): Promise<string | null> {
  const pw = page.locator("input[type=password]:visible");
  if (!(await pw.count())) return null;
  if (!password) return "This employer needs an account. Set an application password in Settings → Application password.";
  const email = page.locator('input[type=email]:visible, input[name*=email i]:visible, input[autocomplete=username]:visible').first();
  if (await email.count()) await email.fill(applicationEmail);
  const pws = await pw.all();
  for (const p of pws) await p.fill(password);
  await addLog(aj.id, `Signing in / creating an account with ${applicationEmail}.`, opts.log);
  const btn = page.getByRole("button", { name: /sign in|log ?in|create account|register|continue|next|verify/i });
  if (await btn.count()) await btn.first().click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(800);
  return enterVerificationCode(page, aj, opts);
}

async function enterVerificationCode(page: Page, aj: FullJob, opts: EngineOptions): Promise<string | null> {
  const codeInput = page.locator('input[name*=code i]:visible, input[id*=code i]:visible, input[autocomplete="one-time-code"]:visible, input[aria-label*=code i]:visible').first();
  if (!(await codeInput.count())) return null;
  await addLog(aj.id, "The employer sent a verification code – waiting for it in your inbox (max 10 minutes old).", opts.log);
  const deadline = Date.now() + (opts.codeWaitMs ?? 120_000);
  const startedAt = new Date(Date.now() - 60_000);
  while (Date.now() < deadline) {
    const v = await getVerificationCode(aj.userId, { applicationId: aj.applicationId, company: aj.job.company.name, since: startedAt });
    if (v?.code) {
      await codeInput.fill(v.code);
      await addLog(aj.id, "Entered the verification code from your inbox.", opts.log);
      const btn = page.getByRole("button", { name: /verify|continue|submit code|confirm|next/i });
      if (await btn.count()) await btn.first().click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(800);
      return null;
    }
    if (v?.link) {
      await page.goto(v.link, { waitUntil: "domcontentloaded" });
      return null;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "No verification code arrived in your inbox. Connect your mailbox (Inbox page) or enter the code yourself.";
}

async function launch(opts: EngineOptions, headless: boolean): Promise<BrowserContext> {
  if (opts.context) return opts.context;
  const { chromium } = await import("playwright");
  const dir = path.join(opts.dataDir ?? path.join(ROOT, "data"), "browser-profile");
  await mkdir(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, { headless, viewport: { width: 1280, height: 900 }, acceptDownloads: false });
}

export interface ProcessResult {
  status: string;
  reason?: string;
}

/** Process one apply job end to end. */
export async function processApplyJob(aj: FullJob, opts: EngineOptions = {}): Promise<ProcessResult> {
  const settings = await db.userSettings.findUnique({ where: { userId: aj.userId } });
  const headless = opts.headless ?? settings?.engineHeadless ?? false;
  const delayMs = opts.delayMs ?? settings?.humanDelayMs ?? 900;
  const delay = () => humanDelay(delayMs);
  const approvedRun = aj.status === "approved";
  const finish = async (status: string, data: Record<string, unknown> = {}, reason?: string) => {
    await db.applyJob.update({ where: { id: aj.id }, data: { status, reason: reason ?? null, finishedAt: new Date(), ...data } });
    if (reason) await addLog(aj.id, reason, opts.log);
    return { status, reason };
  };

  await db.applyJob.update({ where: { id: aj.id }, data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } } });
  await setEngineStatus("applying", `Applying… ${aj.job.title} at ${aj.job.company.name}`, aj.id);
  await addLog(aj.id, approvedRun ? "You approved – re-opening the form to submit." : "Started.", opts.log);

  // 1. Documents & answers (tailored resume, cover letter, screening answers)
  let applicationId = aj.applicationId;
  try {
    if (!applicationId) {
      const app = await createApplication(aj.userId, aj.jobId, { origin: "engine", savedSearchId: aj.savedSearchId, profileId: (await db.savedSearch.findUnique({ where: { id: aj.savedSearchId ?? "" } }))?.profileId });
      applicationId = app.id;
      await db.applyJob.update({ where: { id: aj.id }, data: { applicationId } });
      aj.applicationId = applicationId;
      await prepareApplication(app.id, aj.userId, { useAI: true });
      await addLog(aj.id, "Prepared tailored resume, cover letter and screening answers.", opts.log);
    }
  } catch (e) {
    if (e instanceof DuplicateError) return finish("skipped", {}, `Skipped: ${e.message}`);
    return finish("failed", {}, `Couldn't prepare documents: ${(e as Error).message}`);
  }
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId! }, include: { profile: true, tailoredResume: true } });
  const v = await validateApplication(app.id, aj.userId);
  const blockers = v.failing.filter((f) => !["resume", "cover", "ats", "auto-review"].includes(f.id));
  if (blockers.length) {
    await notify(aj.userId, "needs-you", `Needs you: ${aj.job.title} at ${aj.job.company.name}`, blockers.map((b) => b.label).join(", "), `/applications/${app.id}`);
    return finish("needs-you", { pendingQuestions: JSON.stringify(blockers.map((b) => ({ label: b.label, detail: b.detail }))) }, `Paused – needs you: ${blockers.map((b) => `${b.label} (${b.detail})`).join("; ")}`);
  }

  const doc = app.tailoredResume && app.tailoredResume.status !== "use-original" ? parseJson<ResumeDoc>(app.tailoredResume.tailored, resumeFromProfile(app.profile)) : resumeFromProfile(app.profile);
  const dir = path.join(opts.dataDir ?? path.join(ROOT, "data"), "apply", aj.id);
  await mkdir(dir, { recursive: true });
  const safeName = (doc.name || "resume").replace(/[^A-Za-z0-9]+/g, "_");
  const files = { resume: path.join(dir, `${safeName}_Resume.pdf`), cover: null as string | null };
  await writeFile(files.resume, await resumeToPdf(doc));
  if (app.coverLetterNeeded && app.coverLetter) {
    files.cover = path.join(dir, `${safeName}_Cover_Letter.pdf`);
    await writeFile(files.cover, await textToPdf("Cover letter", app.coverLetter));
  }
  const answers = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []);
  const facts = factsFor(app.profile, doc, answers, app.coverLetterNeeded ? app.coverLetter : null, parseJson(settings?.sensitiveDefaults, {}), settings?.applicationEmail || "");

  // 2. Browser
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    context = await launch(opts, headless);
    page = await context.newPage();
    await page.goto(aj.job.applyUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await addLog(aj.id, `Opened ${aj.job.applyUrl}`, opts.log);
    await openForm(page, aj.job.atsType, aj.job.applyUrl);

    // 3. CAPTCHA / bot check: never bypassed
    if (await captchaVisible(page)) {
      if (headless) return finish("paused", {}, "A CAPTCHA / bot check appeared. Turn on watch mode (Settings) and solve it yourself, or skip this job.");
      await notify(aj.userId, "captcha", "Please solve the CAPTCHA", `${aj.job.company.name} is asking you to prove you're human. Solve it in the Upvance browser window.`, "/jobs");
      await setEngineStatus("waiting", "Waiting for you to solve a CAPTCHA in the browser window", aj.id);
      const until = Date.now() + (opts.captchaWaitMs ?? 180_000);
      while (Date.now() < until && (await captchaVisible(page))) await page.waitForTimeout(2000);
      if (await captchaVisible(page)) return finish("paused", {}, "CAPTCHA wasn't solved in time – job paused. Retry it from the queue when you're ready.");
    }

    // 4. Employer account (Workday & co.)
    const accountProblem = await handleAccount(page, aj, facts.email, decryptSecret(settings?.encryptedAppPassword), opts);
    if (accountProblem) return finish("needs-you", {}, accountProblem);
    const preCode = await enterVerificationCode(page, aj, opts);
    if (preCode) return finish("needs-you", {}, preCode);
    if (await isStopped()) return finish("queued", { finishedAt: null }, "Stopped by you.");

    // 5. Fill the form
    const fields = await readFields(page);
    if (!fields.length) return finish("failed", {}, "Couldn't find an application form on the page.");
    const decisions: Decision[] = fields.map((f) => decide(f, facts));
    // Open questions ("Why do you want to work here?") – written by the app in plain English from
    // your resume and the job, checked for truthfulness, and saved with the application so you can
    // read and edit them before submitting.
    const open = fields.filter((f, i) => decisions[i].value === null && isOpenQuestion(f));
    if (open.length) {
      const { answers: written, rejected } = await writeOpenAnswers(
        open.map((f) => ({ uid: f.uid, label: f.label })),
        { jobTitle: aj.job.title, company: aj.job.company.name, jobDescription: aj.job.description, resumeText: resumeText(doc), profileSkills: parseJson<string[]>(app.profile.skills, []), currentTitle: doc.experiences?.[0]?.title || doc.headline, yearsExperience: app.profile.yearsExperience },
        aj.userId,
      );
      for (const d of decisions) if (written[d.uid]) Object.assign(d, { value: written[d.uid], source: "ai" });
      const saved = open.filter((f) => written[f.uid]).map((f) => ({ question: f.label, answer: written[f.uid], required: f.required }));
      if (saved.length) {
        await db.application.update({ where: { id: app.id }, data: { screeningAnswers: JSON.stringify(upsertOpenAnswers(answers, saved)) } });
        await addLog(aj.id, `Wrote ${saved.length} answer(s) to open questions (e.g. “${saved[0].question.slice(0, 60)}”) – check them in the review.`, opts.log);
      }
      for (const r of rejected) await addLog(aj.id, `Didn't use a drafted answer for “${open.find((f) => f.uid === r.uid)?.label.slice(0, 60)}”: it ${r.reason}.`, opts.log);
    }
    const unknown = fields.filter((f, i) => decisions[i].value === null && f.kind !== "file" && f.kind !== "password" && !isOpenQuestion(f));
    if (unknown.length) {
      const ai = await decideWithAI(unknown, facts, aj.userId, resumeText(doc) + "\n" + answers.map((a) => `${a.question}: ${a.answer}`).join("\n"));
      for (const d of decisions) if (ai[d.uid]) Object.assign(d, { value: ai[d.uid], source: "ai" });
    }
    const filled: { label: string; value: string; source: string }[] = [];
    const pending: { label: string; required: boolean }[] = [];
    for (const [i, f] of fields.entries()) {
      const d = decisions[i];
      if (await isStopped()) return finish("queued", { finishedAt: null }, "Stopped by you.");
      if (f.value && f.kind !== "file" && f.kind !== "checkbox" && f.kind !== "radio") {
        filled.push({ label: f.label, value: f.value, source: "already filled" });
        continue;
      }
      if (d.value === null || d.value === false || d.value === "") {
        if (f.required && f.kind !== "checkbox") pending.push({ label: f.label || f.name, required: true });
        continue;
      }
      try {
        await fillField(page, f, d.value, files, delay);
        filled.push({ label: f.label || f.name, value: f.kind === "file" ? path.basename(d.value === "cover" ? files.cover ?? "" : files.resume) : String(d.value).slice(0, 300), source: d.source });
        await delay();
      } catch (e) {
        if (f.required) pending.push({ label: f.label || f.name, required: true });
        await addLog(aj.id, `Couldn't fill “${f.label}”: ${(e as Error).message.split("\n")[0]}`, opts.log);
      }
    }
    // searchable dropdowns often have a hidden twin input with the same label – don't count those as unanswered
    const key = (s: string) => s.replace(/\*/g, "").trim().slice(0, 40).toLowerCase();
    const answered = new Set(filled.map((x) => key(x.label)));
    for (let i = pending.length - 1; i >= 0; i--) if (answered.has(key(pending[i].label))) pending.splice(i, 1);
    const seenPending = new Set<string>();
    for (let i = 0; i < pending.length; i++) {
      if (seenPending.has(key(pending[i].label))) pending.splice(i--, 1);
      else seenPending.add(key(pending[i].label));
    }
    const shot = path.join(dir, "filled.png");
    await page.screenshot({ path: shot, fullPage: true });
    await db.applyJob.update({ where: { id: aj.id }, data: { filledValues: JSON.stringify(filled), pendingQuestions: JSON.stringify(pending), screenshotPath: shot } });
    await addLog(aj.id, `Filled ${filled.length} field(s); ${pending.length} question(s) need you.`, opts.log);

    if (pending.length) {
      const state = parseJson<ValidationState>((await db.application.findUniqueOrThrow({ where: { id: app.id } })).validation, { checks: [], acknowledged: [] });
      await db.application.update({ where: { id: app.id }, data: { status: "Needs you", needsYou: JSON.stringify([...pending.map((p) => ({ id: "form", label: "Answer on the employer form", detail: p.label }))]), validation: JSON.stringify(state) } });
      await notify(aj.userId, "needs-you", `Needs you: ${aj.job.title}`, `The form asks: ${pending.map((p) => p.label).join("; ").slice(0, 300)}`, `/applications/${app.id}`);
      return finish("needs-you", {}, `Paused – the form asks questions your profile can't answer: ${pending.map((p) => p.label).join("; ")}`);
    }

    // 6. Review before submit (default) / dry run
    const dryRun = opts.dryRun || process.env.APPLY_ENGINE_DRY_RUN === "1";
    if ((aj.policy !== "auto" && !approvedRun) || dryRun) {
      await notify(aj.userId, "review", `Ready for your review: ${aj.job.title}`, `${aj.job.company.name} – check the filled form and click Approve.`, "/apply-queue");
      return finish("review", {}, dryRun ? "Dry run – stopped at the review screen. Nothing was submitted." : "Filled and waiting for your review. Nothing has been submitted.");
    }

    // 7. Submit (auto policy, or you approved)
    if (await isStopped()) return finish("queued", { finishedAt: null }, "Stopped by you.");
    await db.tailoredResume.updateMany({ where: { id: app.tailoredResumeId ?? "" }, data: { status: "approved" } });
    if (app.coverLetterNeeded) await db.application.update({ where: { id: app.id }, data: { coverLetterStatus: "approved" } });
    await logEvent(app.id, "engine", approvedRun ? "You approved the filled form in the apply queue." : "Auto submit is on for this search.");
    const submit = page
      .locator('button[type=submit]:visible, input[type=submit]:visible')
      .or(page.getByRole("button", { name: /^(submit( application)?|send application|apply( now)?|complete application)$/i }));
    if (!(await submit.count())) return finish("failed", {}, "Couldn't find the form's Submit button.");
    const before = page.url();
    await submit.first().click();
    await Promise.race([page.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }), page.waitForTimeout(6000)]).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    if (await captchaVisible(page)) {
      await notify(aj.userId, "captcha", "Please solve the CAPTCHA", `${aj.job.company.name} asked for a CAPTCHA after Submit. Solve it in the Upvance browser window.`, "/apply-queue");
      if (headless) return finish("paused", {}, "A CAPTCHA appeared after Submit – not confirmed. Open the form yourself or retry in watch mode.");
      const until = Date.now() + (opts.captchaWaitMs ?? 180_000);
      while (Date.now() < until && (await captchaVisible(page))) await page.waitForTimeout(2000);
    }
    const codeProblem = await enterVerificationCode(page, aj, opts);
    if (codeProblem) return finish("needs-you", {}, codeProblem);
    const body = await page.locator("body").innerText().catch(() => "");
    const confirmShot = path.join(dir, "confirmation.png");
    await page.screenshot({ path: confirmShot, fullPage: true });
    const errors = await page.locator('[aria-invalid="true"]:visible, .error:visible, .field-error:visible, [role=alert]:visible').count();
    if (CONFIRMATION_TEXT.test(body) || /confirm|thank|success|submitted/i.test(new URL(page.url()).pathname)) {
      await db.application.update({ where: { id: app.id }, data: { status: "Submitted", submittedAt: new Date(), confirmedAt: new Date(), confirmationSource: "page", queue: null, failed: false } });
      await logEvent(app.id, "submitted", "Submitted by the apply engine – confirmation page detected.");
      await logActivity(aj.userId, `Applied: ${aj.job.title} at ${aj.job.company.name}`, "confirmation page detected");
      return finish("submitted", { submittedAt: new Date(), confirmationPath: confirmShot }, "Submitted – confirmation page detected.");
    }
    if (errors) return finish("failed", { confirmationPath: confirmShot }, "The form showed errors after Submit – not submitted. Check the screenshot.");
    await logEvent(app.id, "engine", "Submit clicked – waiting for a confirmation email before marking it submitted.");
    return finish("awaiting-confirmation", { confirmationPath: confirmShot }, "Submit clicked but no confirmation page – waiting for the confirmation email.");
  } catch (e) {
    return finish("failed", {}, `Failed: ${(e as Error).message.split("\n")[0].slice(0, 300)}`);
  } finally {
    await page?.close().catch(() => {});
    if (context && !opts.context) await context.close().catch(() => {});
  }
}

/** Run the next job (if any). Called by the worker loop. */
export async function runEngineOnce(opts: EngineOptions = {}): Promise<ProcessResult | null> {
  if (await isStopped()) {
    await setEngineStatus("stopped", "Stopped by you. Press Start to continue.");
    return null;
  }
  const aj = await nextApplyJob();
  if (!aj) {
    const st = await engineStatus();
    if (st.state !== "cap") await setEngineStatus("idle", "Waiting for jobs in the queue");
    return null;
  }
  const r = await processApplyJob(aj, opts);
  await setEngineStatus("idle", `Last: ${aj.job.title} – ${r.status}`);
  return r;
}

export async function approveReview(userId: string, applyJobId: string) {
  const aj = await db.applyJob.findFirstOrThrow({ where: { id: applyJobId, userId } });
  if (aj.status !== "review") throw new Error("Only filled applications waiting for review can be approved.");
  await db.applyJob.update({ where: { id: aj.id }, data: { status: "approved", reason: "Approved by you – submitting next." } });
  await addLog(aj.id, "You approved the filled form.");
}
export async function skipApplyJob(userId: string, applyJobId: string, reason = "Skipped by you") {
  await db.applyJob.updateMany({ where: { id: applyJobId, userId, status: { notIn: ["submitted"] } }, data: { status: "skipped", reason } });
}
export async function retryApplyJob(userId: string, applyJobId: string) {
  await db.applyJob.updateMany({ where: { id: applyJobId, userId, status: { in: ["failed", "paused", "needs-you", "skipped", "stopped", "review"] } }, data: { status: "queued", reason: null, notBefore: new Date() } });
}
