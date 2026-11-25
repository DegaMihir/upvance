import { db } from "./db";
import { RESPONSE_STATUSES, POST_SUBMIT } from "./applications";

const REMOTE = ["Worldwide", "Country-only", "Region"];

export async function dashboardStats(userId: string) {
  const [jobs, matches, apps, failedTasks] = await Promise.all([
    db.job.count({ where: { isActive: true } }),
    db.match.findMany({ where: { userId, job: { isActive: true } }, include: { job: { select: { sponsorshipCategory: true, remoteCategory: true } } } }),
    db.application.findMany({ where: { userId }, select: { status: true, failed: true, submittedAt: true, createdAt: true } }),
    db.task.count({ where: { status: "failed" } }),
  ]);
  const relevant = matches.filter((m) => m.eligibility !== "Ineligible" && m.score >= 65 && m.status !== "skipped");
  const count = (s: string) => apps.filter((a) => a.status === s).length;
  return {
    jobsDiscovered: jobs,
    relevantMatches: relevant.length,
    confirmedSponsorship: relevant.filter((m) => m.job.sponsorshipCategory === "Confirmed").length,
    likelySponsorship: relevant.filter((m) => m.job.sponsorshipCategory === "Likely").length,
    unknownSponsorship: relevant.filter((m) => m.job.sponsorshipCategory === "Unknown").length,
    remoteEligible: matches.filter((m) => REMOTE.includes(m.job.remoteCategory) && m.eligibility === "Eligible").length,
    relocationRequired: relevant.filter((m) => m.job.remoteCategory === "Relocation required" || (["Onsite", "Hybrid"].includes(m.job.remoteCategory) && m.reasons.includes("visa"))).length,
    submitted: apps.filter((a) => POST_SUBMIT.includes(a.status as never)).length,
    needsYou: count("Needs you"),
    ready: count("Ready"),
    rejected: count("Rejected"),
    recruiterResponses: apps.filter((a) => RESPONSE_STATUSES.includes(a.status as never)).length,
    interviews: count("Interview"),
    offers: count("Offer"),
    errors: apps.filter((a) => a.failed).length + failedTasks,
  };
}

export async function applicationsOverTime(userId: string, weeks = 10) {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000);
  const apps = await db.application.findMany({ where: { userId, submittedAt: { gte: since } }, select: { submittedAt: true, status: true } });
  const buckets: { week: string; submitted: number; responses: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(Date.now() - (i + 1) * 7 * 86_400_000);
    const end = new Date(Date.now() - i * 7 * 86_400_000);
    const inWeek = apps.filter((a) => a.submittedAt! >= start && a.submittedAt! < end);
    buckets.push({
      week: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      submitted: inWeek.length,
      responses: inWeek.filter((a) => RESPONSE_STATUSES.includes(a.status as never)).length,
    });
  }
  return buckets;
}

export function rate(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : 0;
}
