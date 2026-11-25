import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { boardFromUrl, detectAts } from "@/lib/ats";
import { fetchCompanyBoard, fetchJobFromUrl, resolveApplyUrl, slugGuesses } from "@/lib/sources";
import { parsePersonioXml, parseTeamtailorRss, workdayParts } from "@/lib/sources/boards";
import { ingestJobs } from "@/lib/jobs/ingest";
import { classifyWithRules, extractCodes } from "@/lib/inbox/classify";
import { ingestEmail, getVerificationCode, isJobRelated } from "@/lib/inbox/store";
import { createApplication, confirmSubmitted } from "@/lib/applications";
import { sheetRows, toCsv, toJson, toPdf, toXlsx, updateSheetCell, addManualApplication } from "@/lib/sheet";
import { applyView, normalizeView, totals, toTsv, COLUMNS } from "@/lib/sheet-view";
import { parseFilters, filtersToQuery, passes, describeFilters } from "@/lib/feed";
import { parseRequest, ask, undoChange } from "@/lib/assistant";
import { removeDemoData, restoreDemoJobs, demoFilter } from "@/lib/demo/visibility";
import { coreName } from "@/lib/discovery";
import { pdfToText } from "@/lib/resume/parse";

let userId: string;
beforeAll(async () => {
  ({ userId } = await seedDemo());
});
afterEach(() => vi.restoreAllMocks());

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const text = (data: string, type = "text/html") => new Response(data, { headers: { "content-type": type } });

/** Route fetch calls to recorded response shapes (see docs/connectors.md). */
function mockFetch(routes: [RegExp, (url: string, init?: RequestInit) => Response][]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return new Response("not found", { status: 404 });
  });
}

describe("job board connectors", () => {
  it("parses board URLs for every supported board", () => {
    expect(boardFromUrl("https://jobs.gem.com/nominal/am9icG9zdDq-S-CZabzn1Br_Eg1-thRF")).toEqual({ ats: "gem", slug: "nominal", jobId: "am9icG9zdDq-S-CZabzn1Br_Eg1-thRF" });
    expect(boardFromUrl("https://apply.workable.com/huggingface/j/DB4D7C0EC8/")).toEqual({ ats: "workable", slug: "huggingface", jobId: "DB4D7C0EC8" });
    expect(boardFromUrl("https://jobs.smartrecruiters.com/ServiceNow/744000161596339-senior")?.jobId).toBe("744000161596339");
    expect(boardFromUrl("https://bunq.recruitee.com/o/x")?.ats).toBe("recruitee");
    expect(boardFromUrl("https://personio.jobs.personio.de/job/2885178")).toEqual({ ats: "personio", slug: "personio", jobId: "2885178" });
    expect(boardFromUrl("https://acme.teamtailor.com/jobs")?.ats).toBe("teamtailor");
    expect(boardFromUrl("https://acme.bamboohr.com/careers")?.ats).toBe("bamboohr");
    expect(boardFromUrl("https://acme.breezy.hr/p/1")?.ats).toBe("breezy");
    expect(boardFromUrl("https://acme.applytojob.com/apply/AbC123/Engineer")?.ats).toBe("jazzhr");
    expect(boardFromUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Engineer_JR1")).toEqual({ ats: "workday", slug: "nvidia|wd5|NVIDIAExternalCareerSite", jobId: "/job/US-CA/Engineer_JR1" });
    expect(workdayParts("nvidia|wd5|Site")).toEqual({ tenant: "nvidia", wd: "wd5", site: "Site" });
    expect(detectAts("https://jobs.gem.com/x/y")).toBe("gem");
  });

  it("Gem: imports a pasted job link with full description and original apply link", async () => {
    const calls: string[] = [];
    mockFetch([
      [
        /jobs\.gem\.com\/api\/public\/graphql\/batch/,
        (_u, init) => {
          const op = JSON.parse(String(init?.body))[0];
          calls.push(op.operationName);
          return json([{ data: { oatsExternalJobPosting: { title: "Graduate Software Engineer - London", descriptionHtml: "<p>Build mission software in <b>Python</b>.</p><p>We sponsor visas.</p>", extId: op.variables.extId, firstPublishedTsSec: 1794600000, locations: [{ name: "London", city: "London", isoCountry: "GBR", isRemote: false }], job: { locationType: "IN_OFFICE", employmentType: "FULL_TIME", teamDisplayName: "Nominal" }, jobPostSectionHtml: null, compensationHtml: "<p>£60k</p>" } } }]);
        },
      ],
    ]);
    const j = await fetchJobFromUrl("https://jobs.gem.com/nominal/am9icG9zdDq-S-CZabzn1Br_Eg1-thRF");
    expect(calls).toEqual(["ExternalJobPosting"]);
    expect(j).toMatchObject({ source: "gem", title: "Graduate Software Engineer - London", company: "Nominal", location: "London, United Kingdom", applyUrl: "https://jobs.gem.com/nominal/am9icG9zdDq-S-CZabzn1Br_Eg1-thRF", employmentType: "full-time" });
    expect(j.description).toContain("Build mission software in Python");
    expect(j.description).toContain("£60k");
  });

  it("Workable, SmartRecruiters, Recruitee, Breezy, BambooHR, JazzHR and Workday map to jobs", async () => {
    mockFetch([
      [/apply\.workable\.com\/api\/v1\/widget\/accounts\/hf/, () => json({ name: "Hugging Face", jobs: [{ shortcode: "AB12", title: "ML Engineer", employment_type: "Full-time", telecommuting: true, locations: [{ city: "Paris", country: "France" }], description: "<p>Train models</p>", requirements: "<p>Python</p>", published_on: "2026-11-10" }] })],
      [/api\.smartrecruiters\.com\/v1\/companies\/Acme\/postings\?/, () => json({ totalFound: 1, content: [{ id: "77", name: "Data Engineer" }] })],
      [/api\.smartrecruiters\.com\/v1\/companies\/Acme\/postings\/77/, () => json({ id: "77", name: "Data Engineer", company: { name: "Acme" }, location: { fullLocation: "Berlin, Germany", remote: false }, typeOfEmployment: { label: "Full-time" }, releasedDate: "2026-11-01", jobAd: { sections: { jobDescription: { title: "Job", text: "<p>Spark & SQL</p>" } } }, postingUrl: "https://jobs.smartrecruiters.com/Acme/77-data-engineer" })],
      [/bunq\.recruitee\.com\/api\/offers/, () => json({ offers: [{ id: 5, slug: "sec", title: "Security Engineer", description: "<p>Secure things</p>", location: "Amsterdam, Netherlands", careers_url: "https://bunq.recruitee.com/o/sec", careers_apply_url: "https://bunq.recruitee.com/o/sec/c/new", published_at: "2026-11-12", company_name: "bunq" }] })],
      [/acme\.breezy\.hr\/json/, () => json([{ id: "b1", friendly_id: "b1-eng", name: "Engineer", url: "https://acme.breezy.hr/p/b1-eng", published_date: "2026-11-11", type: { name: "Full-Time" }, location: { name: "Austin, TX, US" }, company: { name: "Acme" } }])],
      [/acme\.breezy\.hr\/p\/b1-eng/, () => text(`<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Build APIs with Go</p>"}</script>`)],
      [/acme\.bamboohr\.com\/careers\/list/, () => json({ meta: { totalCount: 1 }, result: [{ id: "9", jobOpeningName: "Analyst", employmentStatusLabel: "Full-Time", location: { city: "Toronto", state: "ON" }, atsLocation: { country: "Canada" } }] })],
      [/acme\.bamboohr\.com\/careers\/9\/detail/, () => json({ result: { jobOpening: { description: "<p>Analyse data with SQL</p>" } } })],
      [/acme\.applytojob\.com\/apply$/, () => text(`<a href="/apply/AbC12345/Support-Engineer">Support Engineer</a>`)],
      [/acme\.applytojob\.com\/apply\/AbC12345/, () => text(`<script type="application/ld+json">{"@type":"JobPosting","title":"Support Engineer","hiringOrganization":{"name":"Acme Inc"},"description":"<p>Help customers</p>","jobLocation":{"address":{"addressLocality":"Dublin","addressCountry":"IE"}}}</script>`)],
      [/wd5\.myworkdayjobs\.com\/wday\/cxs\/acme\/Ext\/jobs$/, () => json({ total: 1, jobPostings: [{ title: "Platform Engineer", externalPath: "/job/London/Platform-Engineer_R1" }] })],
      [/wd5\.myworkdayjobs\.com\/wday\/cxs\/acme\/Ext\/job\/London/, () => json({ jobPostingInfo: { id: "w1", title: "Platform Engineer", jobDescription: "<p>Kubernetes</p>", location: "London", timeType: "Full time", startDate: "2026-11-09", externalUrl: "https://acme.wd5.myworkdayjobs.com/Ext/job/London/Platform-Engineer_R1", country: { descriptor: "United Kingdom" } }, hiringOrganization: { name: "0100 Acme UK Ltd" } })],
    ]);
    const wk = await fetchCompanyBoard("https://apply.workable.com/hf/");
    expect(wk.jobs[0]).toMatchObject({ source: "workable", title: "ML Engineer", company: "Hugging Face", location: "Paris, France (Remote)", applyUrl: "https://apply.workable.com/hf/j/AB12/" });
    const sr = await fetchCompanyBoard("Acme", "smartrecruiters");
    expect(sr.jobs[0]).toMatchObject({ title: "Data Engineer", location: "Berlin, Germany", applyUrl: "https://jobs.smartrecruiters.com/Acme/77-data-engineer" });
    expect(sr.jobs[0].description).toContain("Spark & SQL");
    const rc = await fetchCompanyBoard("https://bunq.recruitee.com");
    expect(rc.jobs[0]).toMatchObject({ title: "Security Engineer", applyUrl: "https://bunq.recruitee.com/o/sec/c/new" });
    const bz = await fetchCompanyBoard("https://acme.breezy.hr");
    expect(bz.jobs[0].description).toContain("Build APIs with Go");
    const bb = await fetchCompanyBoard("https://acme.bamboohr.com/careers");
    expect(bb.jobs[0]).toMatchObject({ title: "Analyst", location: "Toronto, ON, Canada" });
    expect(bb.jobs[0].description).toContain("Analyse data");
    const jz = await fetchCompanyBoard("https://acme.applytojob.com/apply");
    expect(jz.jobs[0]).toMatchObject({ source: "jazzhr", title: "Support Engineer", company: "Acme Inc" });
    const wd = await fetchCompanyBoard("https://acme.wd5.myworkdayjobs.com/en-US/Ext");
    expect(wd.jobs[0]).toMatchObject({ source: "workday", title: "Platform Engineer", company: "Acme", applyUrl: "https://acme.wd5.myworkdayjobs.com/Ext/job/London/Platform-Engineer_R1" });
  });

  it("Personio XML and Teamtailor RSS feeds", () => {
    const xml = `<workzag-jobs><position><id>42</id><office>Berlin</office><name>Backend Engineer (m/f/d)</name><jobDescriptions><jobDescription><name>Your tasks</name><value><![CDATA[<p>Build Go services</p>]]></value></jobDescription></jobDescriptions><employmentType>permanent</employmentType><createdAt>2026-11-11T10:00:00+00:00</createdAt></position></workzag-jobs>`;
    const p = parsePersonioXml(xml, "acme");
    expect(p[0]).toMatchObject({ title: "Backend Engineer (m/f/d)", location: "Berlin", applyUrl: "https://acme.jobs.personio.de/job/42" });
    expect(p[0].description).toContain("Build Go services");
    const rss = `<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme</title><item><title>Designer</title><link>https://acme.teamtailor.com/jobs/1-designer</link><guid>1</guid><pubDate>Tue, 10 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>Design things</p>]]></description><tt:locations><tt:location><tt:city>Stockholm</tt:city><tt:country>Sweden</tt:country></tt:location></tt:locations><remoteStatus>hybrid</remoteStatus></item></channel></rss>`;
    const t = parseTeamtailorRss(rss, "https://acme.teamtailor.com", "acme");
    expect(t[0]).toMatchObject({ title: "Designer", company: "Acme", location: "Stockholm, Sweden (Hybrid)" });
  });

  it("company-name guesses and core names for discovery", () => {
    expect(slugGuesses("Hugging Face Inc")).toEqual(expect.arrayContaining(["huggingface", "hugging-face"]));
    expect(coreName("CISCO SYSTEMS INC")).toBe("cisco");
    expect(coreName("Tech Mahindra Americas Inc")).toBe("tech mahindra");
  });

  it("aggregator jobs resolve to the employer's apply link and duplicates fold into the board copy", async () => {
    const resolved = await resolveApplyUrl({ source: "remotive", externalId: "r1", title: "X", company: "Y", location: "", description: "Apply here: https://boards.greenhouse.io/acme/jobs/123. Thanks", applyUrl: "https://remotive.com/job/1", sourceUrl: "https://remotive.com/job/1", postedAt: null });
    expect(resolved.applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/123");
    expect(resolved.atsType).toBe("greenhouse");

    const agg = await ingestJobs([{ source: "adzuna", externalId: "dz1", title: "Senior Data Engineer", company: "Dedupe Co", location: "London, UK", description: "Short snippet", applyUrl: "https://www.adzuna.co.uk/x", sourceUrl: "https://www.adzuna.co.uk/x", postedAt: new Date() }]);
    const board = await ingestJobs([{ source: "greenhouse", externalId: "dedupe:1", title: "Senior Data Engineer", company: "Dedupe Co", location: "London, United Kingdom", description: "Full description from the employer", applyUrl: "https://boards.greenhouse.io/dedupe/jobs/1", sourceUrl: "https://boards.greenhouse.io/dedupe/jobs/1", postedAt: new Date(), atsType: "greenhouse" }]);
    const aggJob = await db.job.findUniqueOrThrow({ where: { id: agg.jobIds[0] } });
    expect(aggJob.isActive).toBe(false);
    expect(aggJob.duplicateOfId).toBe(board.jobIds[0]);
    expect((await db.job.findUniqueOrThrow({ where: { id: board.jobIds[0] } })).isActive).toBe(true);
  });
});

describe("demo data toggle", () => {
  it("removes demo jobs but keeps the account, profile, settings and sponsor lists; can bring them back", async () => {
    const before = { users: await db.user.count(), profiles: await db.profile.count({ where: { userId } }), lists: await db.sponsorList.count({ where: { status: { not: "demo" } } }) };
    const r = await removeDemoData();
    expect(r.jobs).toBeGreaterThan(0);
    expect(await db.job.count({ where: { source: { in: ["demo", "demo-history"] } } })).toBe(0);
    expect(await db.user.count()).toBe(before.users);
    expect(await db.profile.count({ where: { userId } })).toBe(before.profiles);
    expect(await db.userSettings.count({ where: { userId } })).toBe(1);
    expect(await db.sponsorList.count({ where: { status: { not: "demo" } } })).toBe(before.lists);
    expect(demoFilter(false)).toEqual({ source: { notIn: ["demo", "demo-history"] } });
    expect(await restoreDemoJobs(userId)).toBe(20);
  });
});

describe("feed filters", () => {
  it("round-trip through the URL and filter consistently", async () => {
    const f = parseFilters({ countries: "GB,DE", workplace: "remote,hybrid", sponsorship: "1", noClearance: "1", maxExp: "5", q: "engineer" });
    expect(f).toMatchObject({ countries: ["GB", "DE"], workplace: ["remote", "hybrid"], sponsorship: true, noClearance: true, maxExp: 5, q: "engineer" });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f))))).toEqual(f);
    expect(describeFilters(f)).toContain("GB/DE");
    const rows = await db.match.findMany({ where: { userId, job: { source: "demo" } }, include: { job: { include: { company: true } } } });
    const clearance = rows.find((r) => r.job.externalId === "kestrel-defense-ml")!;
    expect(passes(clearance, { noClearance: true, eligibility: "all" })).toBe(false);
    expect(passes(clearance, { eligibility: "all" })).toBe(true);
    const nominalUk = rows.find((r) => r.job.externalId === "northwind-sr-mle")!;
    expect(passes(nominalUk, { countries: ["GB"] })).toBe(true);
    expect(passes(nominalUk, { countries: ["DE"] })).toBe(false);
    expect(passes(nominalUk, { maxExp: 3 })).toBe(false); // asks for 5+ years
  });
});

describe("inbox (acceptance)", () => {
  it("classifies emails with rules", () => {
    const c = (subject: string, body = "") => classifyWithRules({ fromAddress: "x@y.com", subject, bodyText: body }).category;
    expect(c("Thank you for applying to Acme")).toBe("Applied");
    expect(c("Your application", "Unfortunately we have decided to move forward with other candidates.")).toBe("Rejection");
    expect(c("Interview invitation – ML Engineer")).toBe("Interview");
    expect(c("Your HackerRank coding challenge")).toBe("Assessment");
    expect(c("We are pleased to offer you the position")).toBe("Offer");
    expect(c("Your verification code")).toBe("Verification");
    expect(c("Reminder: complete your application")).toBe("Reminder");
    expect(c("Quick chat?", "I'm a recruiter and came across your profile")).toBe("Recruiter");
    expect(c("Weekly newsletter")).toBe("Other");
    expect(extractCodes({ fromAddress: "a", subject: "Verify", bodyText: "Your verification code is 482913. Visit https://acme.myworkdayjobs.com/verify?token=abc" })).toEqual({ codes: ["482913"], links: ["https://acme.myworkdayjobs.com/verify?token=abc"] });
  });

  it("a confirmation email marks the matching application confirmed; a rejection sets it to Rejected", async () => {
    const job = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "lumen-mlplatform" } });
    const app = await createApplication(userId, job.id);
    await db.application.update({ where: { id: app.id }, data: { status: "Ready" } });
    await db.userSettings.update({ where: { userId }, data: { applicationEmail: "aarav+upvance@example.com" } });
    expect(await isJobRelated(userId, { fromAddress: "no-reply@personio.de", toAddress: "aarav+upvance@example.com", subject: "x", bodyText: "" })).toBe(true);
    expect(await isJobRelated(userId, { fromAddress: "deals@shop.example", toAddress: "aarav@example.com", subject: "50% off", bodyText: "" })).toBe(false);

    const conf = await ingestEmail(userId, { messageId: "<conf-1@lumen>", fromAddress: "jobs@lumen-mobility.example", fromName: "Lumen Mobility Recruiting", toAddress: "aarav+upvance@example.com", subject: "Thank you for applying to Lumen Mobility", bodyText: "We have received your application for ML Platform Engineer.", date: new Date("2026-11-10T09:00:00Z") });
    expect(conf.email.category).toBe("Applied");
    expect(conf.email.applicationId).toBe(app.id);
    let a = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(a.status).toBe("Submitted");
    expect(a.confirmationSource).toBe("email");
    expect(a.confirmedAt).not.toBeNull();

    // the same email again is ignored (idempotent)
    expect((await ingestEmail(userId, { messageId: "<conf-1@lumen>", fromAddress: "x", subject: "x", bodyText: "x" })).created).toBe(false);

    await ingestEmail(userId, { messageId: "<rej-1@lumen>", fromAddress: "jobs@lumen-mobility.example", fromName: "Lumen Mobility", subject: "Your application to Lumen Mobility", bodyText: "Thank you for your interest. Unfortunately we will not be moving forward with your application.", date: new Date("2026-11-14T15:30:00Z") });
    a = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(a.status).toBe("Rejected");
    expect(a.latestResponse).toMatch(/^Rejection:/);
    expect(a.responseDate?.toISOString()).toBe("2026-11-14T15:30:00.000Z");
  });

  it("verification codes are only handed out for an application in progress, within 10 minutes", async () => {
    const job = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "fernleaf-recs" } });
    const app = await createApplication(userId, job.id);
    await ingestEmail(userId, { messageId: "<code-old@x>", fromAddress: "noreply@myworkday.com", subject: "Your verification code", bodyText: "Your verification code is 111111", date: new Date(Date.now() - 20 * 60_000) });
    await ingestEmail(userId, { messageId: "<code-new@x>", fromAddress: "noreply@myworkday.com", subject: "Your verification code", bodyText: "Your verification code is 222222", date: new Date() });
    expect(await getVerificationCode(userId, { applicationId: app.id })).toBeNull(); // not in progress
    const aj = await db.applyJob.create({ data: { userId, jobId: job.id, applicationId: app.id, status: "running" } });
    expect((await getVerificationCode(userId, { applicationId: app.id }))?.code).toBe("222222"); // old code (20 min) ignored
    await db.applyJob.delete({ where: { id: aj.id } });
  });
});

describe("Applications sheet (acceptance)", () => {
  it("shows date applied, response and response date, and every download has the same rows and columns", async () => {
    const job = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "quanta-llm" } });
    const app = await createApplication(userId, job.id);
    await db.application.update({ where: { id: app.id }, data: { status: "Ready" } });
    await confirmSubmitted(app.id, userId, { confirmed: true });
    await db.application.update({ where: { id: app.id }, data: { submittedAt: new Date("2026-11-02T10:00:00Z") } });
    await ingestEmail(userId, { messageId: "<int-1@quanta>", fromAddress: "talent@quanta-ledger.example", fromName: "Quanta Ledger", subject: "Interview invitation – LLM Engineer", bodyText: "We'd like to invite you to an interview for the LLM Engineer role at Quanta Ledger.", date: new Date("2026-11-07T08:00:00Z") });
    await addManualApplication(userId, { company: "Manual Corp", role: "Data Scientist", location: "Dublin, Ireland", link: "https://example.com/job/1", date: "2026-11-05", status: "Ghosted/No response", notes: "Applied, via friend" });

    const rows = await sheetRows(userId);
    const q = rows.find((r) => r.id === app.id)!;
    expect(q).toMatchObject({ company: "Quanta Ledger", role: "LLM Engineer", dateApplied: "2026-11-02", status: "Interview", responseDate: "2026-11-07", daysToResponse: 5, sponsorship: "Confirmed", source: "assisted" });
    expect(q.latestResponse).toMatch(/Interview invitation/);
    const m = rows.find((r) => r.company === "Manual Corp")!;
    expect(m).toMatchObject({ status: "Ghosted/No response", dateApplied: "2026-11-05", source: "added manually", notes: "Applied, via friend" });

    // inline edit
    await updateSheetCell(userId, m.id, "status", "Rejected");
    await updateSheetCell(userId, m.id, "responseDate", "2026-11-09");
    await updateSheetCell(userId, m.id, "latestResponse", "Rejected by email");
    const m2 = (await sheetRows(userId)).find((r) => r.id === m.id)!;
    expect(m2).toMatchObject({ status: "Rejected", responseDate: "2026-11-09", latestResponse: "Rejected by email", daysToResponse: 4 });

    const view = normalizeView({ columns: ["company", "role", "dateApplied", "status", "latestResponse", "responseDate", "notes"], sort: { key: "company", dir: "asc" }, status: ["Interview", "Rejected"] });
    const shown = applyView(await sheetRows(userId), view);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(shown.every((r) => ["Interview", "Rejected"].includes(r.status))).toBe(true);
    const headers = view.columns.map((k) => COLUMNS.find((c) => c.key === k)!.label);
    const expected = shown.map((r) => view.columns.map((k) => String(r[k] ?? "")));

    // CSV
    const csv = toCsv(shown, view.columns).replace(/^﻿/, "");
    const { parseCsv } = await import("@/lib/csv");
    const parsed = parseCsv(csv);
    expect(parsed[0]).toEqual(headers);
    expect(parsed.slice(1)).toEqual(expected);
    // JSON
    const js = JSON.parse(toJson(shown, view.columns)) as Record<string, unknown>[];
    expect(js.map((o) => Object.keys(o))).toEqual(shown.map(() => headers));
    expect(js.map((o) => headers.map((h) => String(o[h] ?? "")))).toEqual(expected);
    // Excel
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(shown, view.columns)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Applications")!;
    const val = (v: ExcelJS.CellValue) => (v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === "object" && "text" in v ? String(v.text) : v == null ? "" : String(v));
    const xRows: string[][] = [];
    ws.eachRow((row) => xRows.push(view.columns.map((_, i) => val(row.getCell(i + 1).value))));
    expect(xRows[0]).toEqual(headers);
    expect(xRows.slice(1)).toEqual(expected);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    // PDF (printable) – every row's company, role and status appear
    const pdfText = await pdfToText(await toPdf(shown, view.columns));
    for (const h of ["Company", "Role / job title", "Status"]) expect(pdfText).toContain(h);
    for (const r of shown) {
      expect(pdfText).toContain(r.company);
      expect(pdfText).toContain(r.dateApplied);
    }
    // Google Sheets: tab-separated copy
    const tsv = toTsv(shown, view.columns).split("\n").map((l) => l.split("\t"));
    expect(tsv[0]).toEqual(headers);
    expect(tsv.slice(1)).toEqual(expected.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " "))));
    // totals
    expect(totals(shown).responses).toBe(shown.length);
  });
});

describe("assistant", () => {
  it("understands filter requests without AI", () => {
    const r = parseRequest("only remote jobs in Germany with sponsorship");
    expect(r.actions[0]).toEqual({ type: "set_filters", filters: { countries: ["DE"], workplace: ["remote"], sponsorship: true } });
    expect(parseRequest("keep applying to new ML engineer jobs in the UK").actions[0]).toMatchObject({ type: "keep_applying", filters: { countries: ["GB"], q: "ML engineer" }, policy: "review" });
    expect(parseRequest("summarise my inbox").actions[0].type).toBe("summarize_inbox");
  });

  it("makes changes through the app's actions, shows them, and can undo them", async () => {
    const before = await db.savedSearch.count({ where: { userId } });
    const r = await ask(userId, "keep applying to new data scientist jobs in the Netherlands");
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].description).toMatch(/Keep applying/);
    expect(await db.savedSearch.count({ where: { userId } })).toBe(before + 1);
    const u = await undoChange(userId, r.changes[0].id);
    expect(u.message).toMatch(/Undone/);
    expect(await db.savedSearch.count({ where: { userId } })).toBe(before);
    const f = await ask(userId, "only remote jobs in Germany with sponsorship");
    expect(f.navigate).toBe("/jobs?countries=DE&workplace=remote&sponsorship=1");
  });
});

describe("Applications sheet – recruiter / contact columns", () => {
  it("fills recruiter name, email and LinkedIn from saved recruiters and emails, and lets you edit them", async () => {
    const { personName } = await import("@/lib/sheet");
    expect(personName("Priya Shah")).toBe("Priya Shah");
    expect(personName("Priya Shah at Acme")).toBe("Priya Shah");
    expect(personName("Acme Careers")).toBeNull();
    expect(personName("Talent Team")).toBeNull();
    expect(personName("Greenhouse")).toBeNull();
    expect(personName("no-reply@acme.com")).toBeNull();

    // 1) a person emailed you directly (LinkedIn link in their signature)
    const a = await addManualApplication(userId, { company: "Contact Alpha", role: "ML Engineer", date: "2026-11-10" });
    await db.email.create({ data: { userId, messageId: "<c-1@alpha>", applicationId: a.id, fromName: "Priya Shah", fromAddress: "priya.shah@alpha.example", subject: "Your application", bodyText: "Thanks!\nPriya Shah\nhttps://www.linkedin.com/in/priya-shah-123/", category: "Recruiter" } });
    // 2) a person wrote through an ATS mail relay – name kept, relay address not shown as their email
    const b = await addManualApplication(userId, { company: "Contact Beta", role: "Data Scientist", date: "2026-11-11" });
    await db.email.create({ data: { userId, messageId: "<c-2@beta>", applicationId: b.id, fromName: "Tom Berg", fromAddress: "no-reply@us.greenhouse-mail.io", subject: "Next steps", bodyText: "Hi", category: "Interview" } });
    // 3) only a generic sender – no contact
    const c = await addManualApplication(userId, { company: "Contact Gamma", role: "AI Engineer", date: "2026-11-12" });
    await db.email.create({ data: { userId, messageId: "<c-3@gamma>", applicationId: c.id, fromName: "Contact Gamma Careers", fromAddress: "careers@gamma.example", subject: "Received", bodyText: "Thanks", category: "Applied" } });
    // 4) a recruiter you saved for that company (Outreach page / extension)
    const d = await addManualApplication(userId, { company: "Contact Delta", role: "LLM Engineer", date: "2026-11-13" });
    await db.recruiter.create({ data: { userId, name: "Lena Ortiz", title: "Technical Recruiter", company: "Contact Delta", profileUrl: "https://www.linkedin.com/in/lena-ortiz/" } });

    const rows = await sheetRows(userId);
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row(a.id)).toMatchObject({ contactName: "Priya Shah", contactEmail: "priya.shah@alpha.example", contactUrl: "https://www.linkedin.com/in/priya-shah-123/", contactFrom: "email" });
    expect(row(b.id)).toMatchObject({ contactName: "Tom Berg", contactEmail: "", contactFrom: "email" });
    expect(row(c.id)).toMatchObject({ contactName: "", contactEmail: "", contactUrl: "" });
    expect(row(d.id)).toMatchObject({ contactName: "Lena Ortiz (Technical Recruiter)", contactUrl: "https://www.linkedin.com/in/lena-ortiz/", contactFrom: "saved recruiter" });

    // typing in the sheet overrides what was found; bad values are refused
    await updateSheetCell(userId, c.id, "contactName", "Sam Lee");
    await updateSheetCell(userId, c.id, "contactEmail", "sam.lee@gamma.example");
    await updateSheetCell(userId, c.id, "contactUrl", "linkedin.com/in/sam-lee");
    await expect(updateSheetCell(userId, c.id, "contactEmail", "not an email")).rejects.toThrow(/email/);
    expect((await sheetRows(userId)).find((r) => r.id === c.id)).toMatchObject({ contactName: "Sam Lee", contactEmail: "sam.lee@gamma.example", contactUrl: "https://linkedin.com/in/sam-lee", contactFrom: "typed in the sheet" });

    // Excel download has the columns, with the LinkedIn link clickable
    const view = normalizeView({ columns: ["company", "contactName", "contactEmail", "contactUrl"], known: COLUMNS.map((x) => x.key) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(applyView(await sheetRows(userId), { ...view, company: "Contact Alpha" }), view.columns)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Applications")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Company", "Recruiter / contact", "Contact email", "LinkedIn / profile"]);
    expect(ws.getRow(2).getCell(4).value).toMatchObject({ hyperlink: "https://www.linkedin.com/in/priya-shah-123/" });
  });

  it("a view saved before the contact columns existed shows them; one that hid them keeps them hidden", () => {
    const old = normalizeView({ columns: ["company", "role", "status", "notes"], sort: { key: "company", dir: "asc" }, status: [] });
    expect(old.columns).toEqual(["company", "role", "status", "contactName", "contactEmail", "contactUrl", "notes"]);
    const hidden = normalizeView({ columns: ["company", "role"], known: COLUMNS.map((x) => x.key), sort: { key: "company", dir: "asc" }, status: [] });
    expect(hidden.columns).toEqual(["company", "role"]);
  });
});
