/**
 * Demo data on/off. Real data (accounts, profiles, settings, real jobs and
 * imported sponsor lists) is never touched.
 */
import { db } from "../db";
import { slugify } from "../text";
import { ingestJobs, upsertCompany } from "../jobs/ingest";
import { recomputeMatches } from "../matching";
import { demoCompanies, demoJobs } from "./data";

export const DEMO_SOURCES = ["demo", "demo-history"];

/** Prisma filter that hides demo jobs unless the user turned them on. */
export function demoFilter(showDemo: boolean | null | undefined) {
  return showDemo ? {} : { source: { notIn: DEMO_SOURCES } };
}

export async function showsDemo(userId: string) {
  return (await db.userSettings.findUnique({ where: { userId }, select: { showDemoData: true } }))?.showDemoData ?? false;
}

/** Delete demo jobs/applications/history, demo-only companies and demo sponsor rows. */
export async function removeDemoData() {
  const demoJobIds = (await db.job.findMany({ where: { source: { in: DEMO_SOURCES } }, select: { id: true } })).map((j) => j.id);
  // outreach rows that only point at demo jobs
  const outreach = await db.outreach.deleteMany({ where: { jobId: { in: demoJobIds } } });
  const jobs = await db.job.deleteMany({ where: { id: { in: demoJobIds } } }); // cascades matches, applications, resumes, apply jobs
  const companies = await db.company.deleteMany({ where: { isDemo: true, jobs: { none: {} }, followed: { none: {} } } });
  // seeded demo recruiter without remaining messages
  await db.recruiter.deleteMany({ where: { name: "Priya Natarajan", company: "Northwind Analytics", outreach: { none: {} } } });
  const demoLists = await db.sponsorList.findMany({ where: { status: "demo" } });
  for (const l of demoLists) {
    await db.sponsorRecord.deleteMany({ where: { listId: l.id } });
    await db.sponsorList.delete({ where: { id: l.id } });
  }
  return { jobs: jobs.count, companies: companies.count, outreach: outreach.count, sponsorLists: demoLists.length };
}

/** Bring the fictional demo jobs back (for trying the app). */
export async function restoreDemoJobs(userId: string) {
  const now = Date.now();
  const res = await ingestJobs(
    demoJobs.map((j) => ({
      source: "demo",
      externalId: j.key,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description,
      applyUrl: `https://example.com/careers/${slugify(j.company)}/${j.key}`,
      sourceUrl: `https://example.com/careers/${slugify(j.company)}/${j.key}`,
      postedAt: new Date(now - j.daysAgo * 86_400_000),
      employmentType: j.employmentType ?? "full-time",
      salaryMin: j.salary?.[0] ?? null,
      salaryMax: j.salary?.[1] ?? null,
      salaryCurrency: j.salary?.[2] ?? null,
      atsType: j.ats,
    })),
    { isDemo: true },
  );
  for (const [name, meta] of Object.entries(demoCompanies)) await upsertCompany(name, { isDemo: true, website: meta.website });
  await recomputeMatches(userId, res.jobIds);
  return res.created;
}
