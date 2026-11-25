import bcrypt from "bcryptjs";
import { db } from "../db";
import { slugify } from "../text";
import { ingestJobs, upsertCompany } from "../jobs/ingest";
import { recomputeMatches } from "../matching";
import { storeSponsorRows } from "../sponsors/importers";
import { SPONSOR_LISTS, type SponsorListId } from "../sponsors/lookup";
import type { ResumeDoc } from "../resume/document";
import { DEMO_EMAIL, DEMO_PASSWORD, demoCompanies, demoHistory, demoJobs, demoSponsors, sampleResume, softwareResume } from "./data";

function profileData(doc: ResumeDoc, name: string, isDefault: boolean) {
  return {
    name,
    isDefault,
    fullName: doc.name,
    email: doc.contact.email,
    phone: doc.contact.phone,
    location: doc.contact.location,
    linkedin: doc.contact.linkedin,
    website: doc.contact.website,
    headline: doc.headline,
    summary: doc.summary,
    skills: JSON.stringify(doc.skills),
    experiences: JSON.stringify(doc.experiences),
    education: JSON.stringify(doc.education),
    certifications: JSON.stringify(doc.certifications),
    projects: JSON.stringify(doc.projects),
    citizenship: "India",
    currentCountry: "India",
    workAuthorizations: JSON.stringify(["IN"]),
    needsSponsorship: true,
    willingToRelocate: true,
    relocationCountries: JSON.stringify(["GB", "DE", "NL", "IE", "CA", "US", "AE", "AU"]),
    salaryExpectation: 95000,
    salaryCurrency: "USD",
    noticePeriod: "60 days",
    yearsExperience: 6,
    parsedBy: "demo",
  };
}

export async function seedDemo(opts: { log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});

  // 1. Sponsor lists – demo rows only where no real list has been imported
  const byList = new Map<SponsorListId, typeof demoSponsors>();
  for (const s of demoSponsors) byList.set(s.list, [...(byList.get(s.list) ?? []), s]);
  for (const [listId, rows] of byList) {
    const existing = await db.sponsorList.findUnique({ where: { id: listId } });
    if (existing?.status === "ok") continue;
    await storeSponsorRows(listId, rows.map((r) => ({ name: r.name, city: r.city, route: r.route })), SPONSOR_LISTS[listId].sourceUrl, "demo", "Demo data – import the official list from the Sponsor lists page.");
  }
  log("Sponsor lists: demo records added (real imports are kept).");

  // 2. Demo user (recreated each time)
  await db.user.deleteMany({ where: { email: DEMO_EMAIL } });
  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Aarav (demo)",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      timezone: "Asia/Kolkata",
      settings: {
        create: {
          targetCountries: JSON.stringify(["GB", "DE", "NL", "IE", "CA", "US", "AE"]),
          targetTitles: JSON.stringify(["Machine Learning Engineer", "ML Engineer", "AI Engineer", "LLM Engineer", "Data Scientist"]),
          targetSkills: JSON.stringify(["Python", "PyTorch", "LLMs", "MLOps"]),
          sponsorshipRequired: true,
          showDemoData: true,
          minExperience: 3,
          maxExperience: 8,
        },
      },
    },
  });
  const aiProfile = await db.profile.create({ data: { userId: user.id, ...profileData(sampleResume, "AI resume", true) } });
  const swProfile = await db.profile.create({ data: { userId: user.id, ...profileData(softwareResume, "Software resume", false) } });
  log(`Demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  // 3. Demo jobs
  await db.job.deleteMany({ where: { source: { in: ["demo", "demo-history"] } } });
  const now = Date.now();
  const ingest = await ingestJobs(
    demoJobs.map((j) => ({
      source: "demo",
      externalId: j.key,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description,
      applyUrl: `https://example.com/careers/${slugify(j.company)}/${j.key}`,
      sourceUrl: `https://example.com/careers/${slugify(j.company)}/${j.key}`,
      postedAt: new Date(now - j.daysAgo * 86_400_000 - 3_600_000),
      employmentType: j.employmentType ?? "full-time",
      salaryMin: j.salary?.[0] ?? null,
      salaryMax: j.salary?.[1] ?? null,
      salaryCurrency: j.salary?.[2] ?? null,
      atsType: j.ats,
    })),
    { isDemo: true },
  );
  for (const [name, meta] of Object.entries(demoCompanies)) {
    const c = await upsertCompany(name, { isDemo: true, website: meta.website });
    await db.company.update({
      where: { id: c.id },
      data: {
        size: meta.size,
        industry: meta.industry,
        headquarters: meta.headquarters,
        facts: JSON.stringify([
          { key: "Size", value: meta.size, source: "Demo data", confidence: "low" },
          { key: "Industry", value: meta.industry, source: "Demo data", confidence: "low" },
        ]),
      },
    });
  }
  log(`Demo jobs: ${ingest.created} created.`);

  // 4. History for dashboard / insights
  for (const [i, h] of demoHistory.entries()) {
    const created = new Date(now - h.daysAgo * 86_400_000);
    const company = await upsertCompany(h.company, { isDemo: true });
    const job = await db.job.create({
      data: {
        companyId: company.id,
        source: "demo-history",
        externalId: `hist-${i}`,
        title: h.title,
        location: h.location,
        description: `${h.title} at ${h.company}. (Archived demo job.)`,
        applyUrl: `https://example.com/careers/${slugify(h.company)}/hist-${i}`,
        canonicalUrl: `https://example.com/careers/${slugify(h.company)}/hist-${i}`,
        fingerprint: `hist-${i}`,
        atsType: "greenhouse",
        postedAt: new Date(created.getTime() - 2 * 86_400_000),
        isActive: false,
        sponsorshipCategory: i % 3 === 0 ? "Confirmed" : i % 3 === 1 ? "Likely" : "Unknown",
        remoteCategory: h.location.startsWith("Remote") ? "Worldwide" : "Onsite",
      },
    });
    const app = await db.application.create({
      data: {
        userId: user.id,
        jobId: job.id,
        profileId: h.profile === "AI resume" ? aiProfile.id : swProfile.id,
        status: h.status,
        origin: h.origin,
        submittedAt: created,
        createdAt: created,
        result: h.status === "Offer" || h.status === "Rejected" ? h.status : null,
      },
    });
    await db.applicationEvent.createMany({
      data: [
        { applicationId: app.id, type: "created", message: "Application created (demo history).", createdAt: created },
        { applicationId: app.id, type: "submitted", message: "You confirmed the application was submitted.", createdAt: created },
        ...(h.status !== "Submitted" ? [{ applicationId: app.id, type: "outcome", message: `Status → ${h.status}`, createdAt: new Date(created.getTime() + 6 * 86_400_000) }] : []),
      ],
    });
    if (h.status === "Interview") {
      await db.companyPause.create({ data: { userId: user.id, companyId: company.id, until: new Date(created.getTime() + 60 * 86_400_000), reason: `Interview recorded for ${h.title}` } });
    }
  }
  log(`Demo history: ${demoHistory.length} past applications.`);

  // 5. Recruiter outreach example
  const recruiter = await db.recruiter.create({
    data: { userId: user.id, name: "Priya Natarajan", title: "Technical Recruiter", company: "Northwind Analytics", profileUrl: "" },
  });
  const nwJob = await db.job.findFirst({ where: { source: "demo", externalId: "northwind-sr-mle" } });
  await db.outreach.create({
    data: {
      userId: user.id,
      recruiterId: recruiter.id,
      jobId: nwJob?.id,
      jobKey: nwJob?.id ?? "none",
      role: "Senior Machine Learning Engineer",
      message:
        "Hi Priya, I noticed Northwind Analytics is hiring a Senior Machine Learning Engineer in London. I'm an ML engineer in Bengaluru with 6 years of experience, most recently building PyTorch ranking models and moving 14 models onto Kubernetes serving. If you're the right person for this role, I'd be grateful to know whether my background fits – or who I should speak to. Thank you!",
      status: "Sent",
      sentAt: new Date(now - 3 * 86_400_000),
      followUpAt: new Date(now + 4 * 86_400_000),
    },
  });

  // 6. Example saved search (auto mode stays OFF until the user turns it on)
  await db.savedSearch.create({
    data: {
      userId: user.id,
      name: "ML roles with sponsorship (Europe)",
      includeKeywords: JSON.stringify(["machine learning", "ml engineer", "llm"]),
      excludeKeywords: JSON.stringify(["intern", "principal"]),
      locations: JSON.stringify(["GB", "DE", "NL", "IE"]),
      remotePreference: "any",
      sponsorshipNeeded: true,
      minBand: "Good",
      profileId: aiProfile.id,
      runsPerDay: 2,
    },
  });

  const n = await recomputeMatches(user.id);
  log(`Matches computed: ${n}.`);
  return { userId: user.id, aiProfileId: aiProfile.id, swProfileId: swProfile.id };
}
