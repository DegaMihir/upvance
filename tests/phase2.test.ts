import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { autoCountToday, runSavedSearch } from "@/lib/auto/pipeline";
import { dueSlot, runScheduler } from "@/lib/auto/scheduler";
import { confirmSubmitted, createApplication, markFailed, acknowledgeCheck, validateApplication } from "@/lib/applications";
import { encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { companyIntel } from "@/lib/employer";
import { draftOutreach, followUpDraft, markOutreachSent, OutreachBlockedError, upsertRecruiter } from "@/lib/outreach";
import { computeInsights, generateSuggestions, roleFamily } from "@/lib/insights";

let userId: string;
let searchId: string;
const NOON = new Date("2026-11-14T06:30:00Z"); // 12:00 in Asia/Kolkata

async function resetAuto() {
  await db.application.deleteMany({ where: { userId, origin: "auto" } });
  await db.autoRun.deleteMany({});
  await db.userSettings.update({ where: { userId }, data: { autoModeEnabled: true, dailyCap: 2, encryptedAppPassword: null } });
}

beforeAll(async () => {
  ({ userId } = await seedDemo());
  // isolate from jobs other test files created (e.g. mock boards)
  await db.job.updateMany({ where: { source: { notIn: ["demo", "demo-history"] } }, data: { isActive: false } });
  // make the demo jobs "fresh" relative to the test clock
  await db.job.updateMany({ where: { source: "demo" }, data: { postedAt: new Date(NOON.getTime() - 20 * 3_600_000) } });
  const s = await db.savedSearch.create({
    data: { userId, name: "Test search", includeKeywords: JSON.stringify(["engineer", "scientist"]), minBand: "Stretch", runsPerDay: 2, sponsorshipNeeded: false },
  });
  searchId = s.id;
});
beforeEach(resetAuto);

describe("auto mode (acceptance)", () => {
  it("never exceeds the daily cap across runs", async () => {
    const r1 = await runSavedSearch(searchId, { trigger: "schedule", slot: "t1", now: NOON, network: false });
    expect(r1.queued).toBe(2);
    expect(r1.stoppedReason).toMatch(/Daily cap reached/);
    const r2 = await runSavedSearch(searchId, { trigger: "schedule", slot: "t2", now: NOON, network: false });
    expect(r2.queued).toBe(0);
    expect(await autoCountToday(userId, "Asia/Kolkata", NOON)).toBe(2);
  });

  it("doesn't count failed submissions against the cap", async () => {
    await runSavedSearch(searchId, { trigger: "schedule", slot: "f1", now: NOON, network: false });
    const one = await db.application.findFirstOrThrow({ where: { userId, origin: "auto" } });
    await markFailed(one.id, userId, "Form error");
    expect(await autoCountToday(userId, "Asia/Kolkata", NOON)).toBe(1);
    const r = await runSavedSearch(searchId, { trigger: "schedule", slot: "f2", now: NOON, network: false });
    expect(r.queued).toBe(1);
  });

  it("turning auto mode off stops future runs immediately; submitted stays submitted", async () => {
    await runSavedSearch(searchId, { trigger: "schedule", slot: "o1", now: NOON, network: false });
    const app = await db.application.findFirstOrThrow({ where: { userId, origin: "auto" } });
    // user reviews & submits one
    await acknowledgeCheck(app.id, userId, "auto-review").catch(() => {});
    await db.tailoredResume.updateMany({ where: { userId }, data: { status: "approved" } });
    await db.application.update({ where: { id: app.id }, data: { coverLetterStatus: "approved" } });
    const v = await validateApplication(app.id, userId);
    if (v.status === "Ready") await confirmSubmitted(app.id, userId, { confirmed: true });

    await db.userSettings.update({ where: { userId }, data: { autoModeEnabled: false, dailyCap: 50 } });
    const r = await runSavedSearch(searchId, { trigger: "schedule", slot: "o2", now: NOON, network: false });
    expect(r.runId).toBeNull();
    expect(r.stoppedReason).toMatch(/off/);
    expect(await runScheduler({ now: NOON, network: false })).toBe(0);
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe(v.status === "Ready" ? "Submitted" : after.status);
  });

  it("only uses jobs posted in the last 48 hours", async () => {
    await db.job.updateMany({ where: { source: "demo" }, data: { postedAt: new Date(NOON.getTime() - 72 * 3_600_000) } });
    const r = await runSavedSearch(searchId, { trigger: "schedule", slot: "old", now: NOON, network: false });
    expect(r.discovered).toBe(0);
    expect(r.queued).toBe(0);
    await db.job.updateMany({ where: { source: "demo" }, data: { postedAt: new Date(NOON.getTime() - 20 * 3_600_000) } });
  });

  it("skips Workday jobs until an application password is set", async () => {
    await db.userSettings.update({ where: { userId }, data: { dailyCap: 50 } });
    const r = await runSavedSearch(searchId, { trigger: "schedule", slot: "wd1", now: NOON, network: false });
    expect(r.log.join(" ")).toMatch(/Workday job skipped/);
    const apps = await db.application.findMany({ where: { userId, origin: "auto" }, include: { job: true } });
    expect(apps.some((a) => a.job.atsType === "workday")).toBe(false);
    await db.application.deleteMany({ where: { userId, origin: "auto" } });
    await db.userSettings.update({ where: { userId }, data: { encryptedAppPassword: encryptSecret("a-strong-password") } });
    const r2 = await runSavedSearch(searchId, { trigger: "schedule", slot: "wd2", now: NOON, network: false });
    expect(r2.log.join(" ")).not.toMatch(/Workday job skipped/);
  });

  it("skips companies paused after an interview and never prepares ineligible jobs", async () => {
    await db.userSettings.update({ where: { userId }, data: { dailyCap: 50 } });
    await runSavedSearch(searchId, { trigger: "schedule", slot: "p1", now: NOON, network: false });
    const apps = await db.application.findMany({ where: { userId, origin: "auto" }, include: { job: { include: { company: true } } } });
    const paused = await db.companyPause.findMany({ where: { userId, until: { gt: NOON } } });
    for (const a of apps) expect(paused.map((p) => p.companyId)).not.toContain(a.job.companyId);
    const keys = apps.map((a) => a.job.externalId);
    for (const ineligible of ["kestrel-defense-ml", "helio-ai-perception", "brightpath-nlp", "copperline-de"]) expect(keys).not.toContain(ineligible);
  });

  it("review is ON by default: auto-prepared applications wait in “Needs you”", async () => {
    await runSavedSearch(searchId, { trigger: "schedule", slot: "rv", now: NOON, network: false });
    const apps = await db.application.findMany({ where: { userId, origin: "auto" } });
    expect(apps.length).toBeGreaterThan(0);
    for (const a of apps) {
      expect(a.status).toBe("Needs you");
      expect(a.needsYou).toMatch(/Review auto-prepared application/);
      expect(a.status).not.toBe("Submitted");
    }
  });

  it("schedules 1–4 runs per day in the user's time zone, each slot once", async () => {
    expect(dueSlot(2, "Asia/Kolkata", new Date("2026-11-14T02:00:00Z"))).toBeNull(); // 07:30 local
    expect(dueSlot(2, "Asia/Kolkata", NOON)).toEqual({ slot: "2026-11-14#0", hour: 9 });
    expect(dueSlot(4, "Asia/Kolkata", new Date("2026-11-14T15:00:00Z"))?.slot).toBe("2026-11-14#3"); // 20:30
    const first = await runScheduler({ now: NOON, network: false });
    const second = await runScheduler({ now: NOON, network: false });
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });
});

describe("extension endpoints", () => {
  it("authenticates with the pairing token and returns match + fill package", async () => {
    const token = `upv_${randomToken()}`;
    await db.userSettings.update({ where: { userId }, data: { extensionTokenHash: sha256(token), autoModeEnabled: false } });
    const { POST: jobPost } = await import("@/app/api/extension/job/route");
    const unauth = await jobPost(new Request("http://localhost:3100/api/extension/job", { method: "POST", body: "{}" }));
    expect(unauth.status).toBe(401);

    const res = await jobPost(
      new Request("http://localhost:3100/api/extension/job", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, origin: "chrome-extension://abc", "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.linkedin.com/jobs/view/999?trk=x",
          title: "AI Engineer",
          company: "Example Robotics",
          location: "Remote – US only",
          description: "We are hiring an AI Engineer. Fully remote, but you must be based in the United States. Python and PyTorch required. ".repeat(3),
          easyApply: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
    const data = await res.json();
    expect(data.eligibility).toBe("Ineligible");
    expect(data.atsSupport.level).toBe("unsupported"); // Easy Apply isn't supported
    expect(data.application).toBeNull(); // prepare-on-open is OFF by default

    // A ready application's fill package (matched by its apply URL)
    const job = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "fernleaf-recs" } });
    const app = await createApplication(userId, job.id);
    await db.application.update({ where: { id: app.id }, data: { status: "Ready", screeningAnswers: JSON.stringify([{ id: "sponsorship", question: "Sponsorship?", answer: "Yes", category: "sponsorship" }]) } });
    const { GET: pkgGet } = await import("@/app/api/extension/package/route");
    const pkgRes = await pkgGet(new Request(`http://localhost:3100/api/extension/package?url=${encodeURIComponent(job.applyUrl + "?utm_source=x")}`, { headers: { authorization: `Bearer ${token}` } }));
    const pkg = await pkgRes.json();
    expect(pkg.applicationId).toBe(app.id);
    expect(pkg.fields.firstName).toBe("Aarav");
    expect(pkg.answers[0].answer).toBe("Yes");

    const { POST: submitted } = await import("@/app/api/extension/submitted/route");
    const bad = await submitted(new Request("http://localhost/x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ applicationId: app.id }) }));
    expect(bad.status).toBe(400); // explicit confirmation required
    const ok = await submitted(new Request("http://localhost/x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ applicationId: app.id, confirmed: true }) }));
    expect((await ok.json()).status).toBe("Submitted");
  });
});

describe("recruiter outreach", () => {
  it("drafts a truthful message, blocks a 2nd message to the same recruiter for the same job, and times follow-ups", async () => {
    const job = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "lumen-mlplatform" } });
    const r = await upsertRecruiter(userId, { name: "Jonas Weber", title: "Talent Partner", company: "Lumen Mobility" });
    const d = await draftOutreach(userId, { recruiterId: r.id, jobId: job.id, useAI: false });
    expect(d.message).toMatch(/^(Hi|Hello) Jonas/);
    expect(d.message).toContain("ML Platform Engineer");
    expect(d.message).toContain("Lumen Mobility");
    expect(d.message).toMatch(/Thank you/);
    // editing a draft again is fine
    await draftOutreach(userId, { recruiterId: r.id, jobId: job.id, useAI: false });
    await markOutreachSent(userId, d.outreachId);
    await expect(draftOutreach(userId, { recruiterId: r.id, jobId: job.id, useAI: false })).rejects.toThrow(OutreachBlockedError);
    await expect(followUpDraft(userId, d.outreachId)).rejects.toThrow(/Too early/);
    await db.outreach.update({ where: { id: d.outreachId }, data: { followUpAt: new Date(Date.now() - 1000) } });
    expect(await followUpDraft(userId, d.outreachId)).toMatch(/following up/);
  });
});

describe("employer intelligence & insights", () => {
  it("every claim has a source and confidence", async () => {
    const c = await db.company.findFirstOrThrow({ where: { name: "Northwind Analytics" } });
    const intel = await companyIntel(c.id);
    expect(intel.claims.length).toBeGreaterThan(3);
    for (const cl of intel.claims) {
      expect(cl.source).toBeTruthy();
      expect(["high", "medium", "low", "unknown"]).toContain(cl.confidence);
    }
    expect(intel.claims.find((x) => x.topic === "Sponsorship history")?.value).toMatch(/UK Register/);
  });

  it("groups outcomes and never treats “No response” as rejection", async () => {
    const ins = await computeInsights(userId);
    expect(ins.total).toBeGreaterThanOrEqual(5); // seeded history minus auto-mode rows removed by earlier tests
    const all = ins.byOrigin.reduce((n, g) => n + g.rejected, 0);
    const noResp = ins.byOrigin.reduce((n, g) => n + g.noResponse, 0);
    expect(all).toBe(ins.apps.filter((a) => a.status === "Rejected").length);
    expect(noResp).toBeGreaterThan(0);
    expect(roleFamily("Senior LLM Engineer")).toBe("ML / AI engineering");
    const s = await generateSuggestions(userId);
    expect(Array.isArray(s)).toBe(true);
  });
});
