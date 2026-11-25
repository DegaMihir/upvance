/**
 * Storing, linking and acting on job-related emails.
 */
import { db } from "../db";
import { normalizeCompany } from "../text";
import { parseJson } from "../utils";
import { POST_SUBMIT, logEvent, setOutcome, type AppStatus } from "../applications";
import { notify } from "../notify";
import { classifyEmail, extractCodes, summarize, type EmailCategory } from "./classify";

export interface IncomingEmail {
  messageId: string;
  uid?: number;
  fromAddress: string;
  fromName?: string;
  toAddress?: string;
  subject: string;
  bodyText: string;
  date?: Date;
  inReplyTo?: string;
}

export const ATS_DOMAINS = /(greenhouse(-mail)?\.io|lever\.co|hire\.lever\.co|ashbyhq\.com|gem\.com|workablemail\.com|workable\.com|smartrecruiters\.com|recruitee\.com|personio\.(de|com)|teamtailor(-mail)?\.com|bamboohr\.com|breezy\.hr|applytojob\.com|jazzhr\.com|myworkday(jobs)?\.com|workday\.com|icims\.com|taleo\.net|jobvite\.com|successfactors|hackerrank\.com|codility\.com|codesignal\.com|calendly\.com|goodtime\.io|linkedin\.com)/i;

/** Is this email job-related? (sent to the application address, from an ATS, or from a company you applied to) */
export async function isJobRelated(userId: string, m: Pick<IncomingEmail, "fromAddress" | "fromName" | "toAddress" | "subject" | "bodyText">) {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const appAddr = settings?.applicationEmail?.toLowerCase();
  if (appAddr && (m.toAddress ?? "").toLowerCase().includes(appAddr)) return true;
  if (ATS_DOMAINS.test(m.fromAddress)) return true;
  const companies = await companiesAppliedTo(userId);
  const hay = normalizeCompany(`${m.fromName ?? ""} ${m.fromAddress.split("@")[1]?.split(".")[0] ?? ""} ${m.subject}`);
  return companies.some((c) => c.length >= 3 && new RegExp(`\\b${c.replace(/[^a-z0-9 ]/g, "")}\\b`).test(hay));
}

async function companiesAppliedTo(userId: string) {
  const apps = await db.application.findMany({ where: { userId }, select: { job: { select: { company: { select: { normalizedName: true } } } } } });
  return Array.from(new Set(apps.map((a) => a.job.company.normalizedName)));
}

/** Find the application an email is about: company name in sender/subject/body, then job title. */
export async function linkToApplication(userId: string, m: IncomingEmail) {
  const apps = await db.application.findMany({ where: { userId }, include: { job: { include: { company: true } } }, orderBy: { updatedAt: "desc" } });
  const domain = m.fromAddress.split("@")[1]?.toLowerCase() ?? "";
  const hay = normalizeCompany(`${m.fromName ?? ""} ${domain.split(".").slice(-2, -1)[0] ?? ""} ${m.subject} ${m.bodyText.slice(0, 2000)}`);
  const scored = apps
    .map((a) => {
      const name = a.job.company.normalizedName;
      let s = 0;
      if (name && new RegExp(`\\b${name.replace(/[^a-z0-9 ]/g, "")}\\b`).test(hay)) s += 10;
      if (name && domain.replace(/[^a-z0-9]/g, "").includes(name.replace(/[^a-z0-9]/g, ""))) s += 8;
      const title = a.job.title.toLowerCase();
      if (`${m.subject} ${m.bodyText.slice(0, 2000)}`.toLowerCase().includes(title)) s += 5;
      if (["Ready", "Submitted", "Recruiter response", "Assessment", "Interview"].includes(a.status)) s += 1;
      return { a, s };
    })
    .filter((x) => x.s >= 8)
    .sort((x, y) => y.s - x.s);
  return scored[0]?.a ?? null;
}

const STATUS_FOR: Partial<Record<EmailCategory, AppStatus>> = {
  Rejection: "Rejected",
  Interview: "Interview",
  Assessment: "Assessment",
  Offer: "Offer",
  Recruiter: "Recruiter response",
};
const ORDER: AppStatus[] = ["Submitted", "No response", "Recruiter response", "Assessment", "Interview", "Offer"];

/** Store one email, classify, link and update the application. Idempotent per messageId. */
export async function ingestEmail(userId: string, m: IncomingEmail, opts: { mailboxId?: string | null; classify?: boolean } = {}) {
  const existing = await db.email.findUnique({ where: { userId_messageId: { userId, messageId: m.messageId } } });
  if (existing) return { email: existing, created: false };
  const { category, by } = opts.classify === false ? { category: "Other" as EmailCategory, by: "rules" as const } : await classifyEmail(m, userId);
  const { codes, links } = extractCodes(m);
  const app = await linkToApplication(userId, m);
  const email = await db.email.create({
    data: {
      userId,
      mailboxId: opts.mailboxId ?? null,
      messageId: m.messageId,
      uid: m.uid ?? null,
      fromAddress: m.fromAddress,
      fromName: m.fromName ?? "",
      toAddress: m.toAddress ?? "",
      subject: m.subject,
      snippet: m.bodyText.replace(/\s+/g, " ").trim().slice(0, 200),
      bodyText: m.bodyText.slice(0, 100_000),
      date: m.date ?? new Date(),
      category,
      classifiedBy: by,
      applicationId: app?.id ?? null,
      companyName: app?.job.company.name ?? null,
      codes: JSON.stringify(codes),
      links: JSON.stringify(links),
      inReplyTo: m.inReplyTo ?? null,
    },
  });
  if (app) await applyEmailToApplication(userId, app.id, email.id);
  if (["Interview", "Offer", "Recruiter", "Assessment"].includes(category))
    await notify(userId, category.toLowerCase(), `${category}: ${app?.job.company.name ?? m.fromName ?? m.fromAddress}`, m.subject, app ? `/applications/${app.id}` : `/inbox?id=${email.id}`);
  return { email, created: true };
}

/** Update the application from a linked email. Never treats silence as rejection; never downgrades an offer. */
export async function applyEmailToApplication(userId: string, applicationId: string, emailId: string) {
  const email = await db.email.findUniqueOrThrow({ where: { id: emailId } });
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  const category = email.category as EmailCategory;
  const summary = summarize({ fromAddress: email.fromAddress, subject: email.subject, bodyText: email.bodyText }, category);

  if (category === "Verification" || category === "Other" || category === "Reminder") {
    await logEvent(app.id, "email", `Email (${category}): ${email.subject}`);
    return;
  }
  if (category === "Applied") {
    // confirmation email → submitted & confirmed
    if (!POST_SUBMIT.includes(app.status as AppStatus)) {
      await db.application.update({ where: { id: app.id }, data: { status: "Submitted", submittedAt: app.submittedAt ?? email.date, queue: null } });
    }
    await db.application.update({ where: { id: app.id }, data: { confirmedAt: app.confirmedAt ?? email.date, confirmationSource: app.confirmationSource ?? "email" } });
    await db.applyJob.updateMany({ where: { applicationId: app.id, status: "awaiting-confirmation" }, data: { status: "submitted", submittedAt: email.date } });
    await logEvent(app.id, "confirmed", `Confirmation email received: “${email.subject}”.`);
    return;
  }
  const target = STATUS_FOR[category];
  if (!target) return;
  if (!app.responseEdited) await db.application.update({ where: { id: app.id }, data: { latestResponse: summary, responseDate: email.date } });
  if (!POST_SUBMIT.includes(app.status as AppStatus)) {
    // an employer replied to something we never confirmed – record it as submitted first
    await db.application.update({ where: { id: app.id }, data: { status: "Submitted", submittedAt: app.submittedAt ?? email.date } });
  }
  const current = (await db.application.findUniqueOrThrow({ where: { id: app.id } })).status as AppStatus;
  const forward = target === "Rejected" ? current !== "Offer" : ORDER.indexOf(target) > ORDER.indexOf(current) || current === "No response";
  if (forward && current !== target) await setOutcome(app.id, userId, target, `from email “${email.subject}”`);
  else await logEvent(app.id, "email", `Email (${category}): ${email.subject}`);
}

/**
 * A verification code for an application the apply engine is working on –
 * only within the last 10 minutes, and only while that application is in progress.
 */
export async function getVerificationCode(userId: string, opts: { applicationId?: string | null; company?: string; since?: Date } = {}) {
  const since = new Date(Math.max((opts.since ?? new Date(0)).getTime(), Date.now() - 10 * 60_000));
  if (opts.applicationId) {
    const active = await db.applyJob.findFirst({ where: { applicationId: opts.applicationId, status: { in: ["running", "approved"] } } });
    if (!active) return null;
  }
  const emails = await db.email.findMany({ where: { userId, category: "Verification", date: { gte: since } }, orderBy: { date: "desc" }, take: 10 });
  const company = opts.company ? normalizeCompany(opts.company) : null;
  for (const e of emails) {
    if (company && opts.applicationId && e.applicationId && e.applicationId !== opts.applicationId) continue;
    if (company && !e.applicationId && !normalizeCompany(`${e.fromName} ${e.fromAddress} ${e.subject} ${e.bodyText.slice(0, 500)}`).includes(company) && !/(workday|greenhouse|lever|ashby|gem|workable|smartrecruiters)/i.test(e.fromAddress)) continue;
    const codes = parseJson<string[]>(e.codes, []);
    const links = parseJson<string[]>(e.links, []);
    if (codes.length || links.length) return { code: codes[0] ?? null, link: links[0] ?? null, emailId: e.id };
  }
  return null;
}
