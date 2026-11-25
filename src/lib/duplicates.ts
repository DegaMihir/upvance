/**
 * Duplicate detection before an application is created or marked Ready.
 */
import { db } from "./db";

export const ACTIVE_STATUSES = ["Preparing", "Needs you", "Ready"];
export const SENT_STATUSES = ["Submitted", "Recruiter response", "Assessment", "Interview", "Offer", "Rejected", "No response"];

export interface DuplicateCheck {
  blocked: boolean;
  messages: { level: "block" | "warn"; text: string; applicationId?: string }[];
  sameCompanyCount: number;
}

export async function checkDuplicates(userId: string, jobId: string, opts: { excludeApplicationId?: string } = {}): Promise<DuplicateCheck> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const perCompanyLimit = settings?.perCompanyLimit ?? 3;
  const notThis = opts.excludeApplicationId ? { id: { not: opts.excludeApplicationId } } : {};
  const messages: DuplicateCheck["messages"] = [];

  // 1. Same job (same record)
  const same = await db.application.findFirst({ where: { userId, jobId, failed: false, ...notThis }, orderBy: { createdAt: "desc" } });
  if (same) {
    const sent = SENT_STATUSES.includes(same.status);
    messages.push({
      level: "block",
      text: sent ? `You already applied to this job (status: ${same.status}).` : `There's already a pending application for this job (status: ${same.status}).`,
      applicationId: same.id,
    });
  }

  // 2. Same job under a different URL / source
  const twins = await db.job.findMany({
    where: {
      id: { not: jobId },
      OR: [...(job.canonicalUrl ? [{ canonicalUrl: job.canonicalUrl }] : []), ...(job.fingerprint ? [{ fingerprint: job.fingerprint }] : [])],
    },
    select: { id: true, source: true },
  });
  if (twins.length) {
    const twinApp = await db.application.findFirst({ where: { userId, jobId: { in: twins.map((t) => t.id) }, failed: false, ...notThis } });
    if (twinApp)
      messages.push({
        level: "block",
        text: `You already have an application (${twinApp.status}) for the same job listed under a different URL or source.`,
        applicationId: twinApp.id,
      });
  }

  // 3. Other applications at the same company
  const companyApps = await db.application.findMany({
    where: { userId, job: { companyId: job.companyId }, jobId: { not: jobId }, failed: false, ...notThis },
    include: { job: true },
  });
  const counted = companyApps.filter((a) => [...SENT_STATUSES, ...ACTIVE_STATUSES, "Saved"].includes(a.status));
  if (counted.length >= perCompanyLimit) {
    messages.push({ level: "block", text: `You've reached your limit of ${perCompanyLimit} applications at ${job.company.name}. Change the limit in Settings if you want more.` });
  } else if (counted.length) {
    const pending = counted.filter((a) => ACTIVE_STATUSES.includes(a.status));
    if (pending.length && settings?.blockSameCompanyPending)
      messages.push({ level: "block", text: `You have a pending application at ${job.company.name} (${pending[0].job.title}). Your settings block parallel applications to one company.` });
    else
      messages.push({ level: "warn", text: `You have ${counted.length} other application(s) at ${job.company.name}: ${counted.map((a) => `${a.job.title} (${a.status})`).join(", ")}.` });
  }

  // 4. Interview pause
  const pause = await db.companyPause.findFirst({ where: { userId, companyId: job.companyId, until: { gt: new Date() } } });
  if (pause) messages.push({ level: "block", text: `Applications to ${job.company.name} are paused until ${pause.until.toDateString()} (${pause.reason}).` });

  return { blocked: messages.some((m) => m.level === "block"), messages, sameCompanyCount: counted.length };
}
