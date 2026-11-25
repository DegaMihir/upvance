import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { ingestJobs } from "@/lib/jobs/ingest";
import { recomputeMatches } from "@/lib/matching";
import { encryptSecret } from "@/lib/crypto";
import { applyToAll, previewApplyAll, runWatchers, saveWatcher, setWatcher } from "@/lib/apply/queue";
import { approveReview, runEngineOnce, stopAll } from "@/lib/apply/engine";
import { ingestEmail } from "@/lib/inbox/store";
import { parseJson } from "@/lib/utils";
import { startMockAts, type MockAts } from "./mock-ats";

let userId: string;
let mock: MockAts;
let browser: Browser;
let context: BrowserContext;
const opts = () => ({ context, headless: true, delayMs: 0, codeWaitMs: 15_000, dataDir: path.join(process.cwd(), "data", "test-engine") });

const DESC = (title: string) => `${title} at Mock Co.\n\nWhat you'll do\n• Build ML systems in Python and PyTorch\n• Deploy models on AWS with Docker\n\nRequirements\n• 4+ years of experience with machine learning\n\nThis role is in our London office. We offer Skilled Worker visa sponsorship.`;

async function addMockJobs(jobs: { key: string; title: string; path?: string }[]) {
  const res = await ingestJobs(
    jobs.map((j) => ({
      source: "mockboard",
      externalId: j.key,
      title: j.title,
      company: `Mock Co ${j.key}`,
      location: "London, United Kingdom",
      description: DESC(j.title),
      applyUrl: `${mock.url}/${j.path ?? "apply"}/${j.key}`,
      sourceUrl: `${mock.url}/jobs/${j.key}`,
      postedAt: new Date(),
      atsType: "unknown",
    })),
  );
  await recomputeMatches(userId, res.jobIds);
  return res.jobIds;
}

async function drain(max = 10) {
  const results = [];
  for (let i = 0; i < max; i++) {
    const r = await runEngineOnce(opts());
    if (!r) break;
    results.push(r);
  }
  return results;
}

beforeAll(async () => {
  ({ userId } = await seedDemo());
  await db.job.updateMany({ where: { source: { in: ["demo", "demo-history"] } }, data: { isActive: false } });
  await db.userSettings.update({ where: { userId }, data: { applyDailyCap: 25, applicationEmail: "aarav+upvance@example.com", encryptedAppPassword: encryptSecret("a-strong-test-password") } });
  mock = await startMockAts();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
}, 60_000);
afterAll(async () => {
  await context?.close();
  await browser?.close();
  await mock?.close();
});
beforeEach(async () => {
  await stopAll(false);
  await db.applyJob.deleteMany({});
  mock.submissions.length = 0;
});

describe("Apply to all (acceptance)", () => {
  it("fills and submits every matching mock job and skips non-matching ones", async () => {
    await addMockJobs([
      { key: "a1", title: "ML Engineer A" },
      { key: "a2", title: "ML Engineer B" },
      { key: "a3", title: "ML Engineer C" },
      { key: "x1", title: "Sales Manager" },
    ]);
    const preview = await previewApplyAll(userId, { q: "ML Engineer", source: "mockboard" }, { policy: "auto" });
    expect(preview.candidates).toHaveLength(3);
    expect(preview.estimatedMinutes).toBe(9);
    const r = await applyToAll(userId, { q: "ML Engineer", source: "mockboard" }, { policy: "auto" });
    expect(r.queued).toBe(3);
    const results = await drain();
    expect(results.map((x) => x.status)).toEqual(["submitted", "submitted", "submitted"]);
    expect(mock.submissions.map((s) => s.jobId).sort()).toEqual(["a1", "a2", "a3"]);
    for (const s of mock.submissions) {
      expect(s.fields.first_name).toBe("Aarav");
      expect(s.fields.last_name).toBe("Mehta");
      expect(s.fields.email).toBe("aarav+upvance@example.com");
      expect(s.fields.auth).toBe("No"); // truthful: not authorised to work in the UK
      expect(s.fields.sponsorship).toBe("yes");
      expect(s.fields.gender).toBe("Prefer not to say");
      expect(s.fields.privacy).toBe("on");
      expect(s.fields.marketing).toBeUndefined();
      expect(s.files[0]).toMatch(/^resume:Aarav_Mehta_Resume\.pdf:pdf$/);
    }
    const apps = await db.application.findMany({ where: { userId, origin: "engine" }, include: { job: true } });
    expect(apps.every((a) => a.status === "Submitted" && a.confirmationSource === "page")).toBe(true);
    expect(apps.some((a) => a.job.title === "Sales Manager")).toBe(false);
    const jobs = await db.applyJob.findMany({ where: { userId } });
    for (const j of jobs) expect(j.confirmationPath).toBeTruthy();
  }, 120_000);

  it("review mode stops at the review screen with fields filled and does NOT submit until approved", async () => {
    await addMockJobs([{ key: "r1", title: "ML Engineer Review" }]);
    await applyToAll(userId, { q: "ML Engineer Review" }, { policy: "review" });
    const [first] = await drain();
    expect(first.status).toBe("review");
    expect(mock.submissions).toHaveLength(0);
    const aj = await db.applyJob.findFirstOrThrow({ where: { userId } });
    const filled = parseJson<{ label: string; value: string }[]>(aj.filledValues, []);
    expect(filled.find((f) => /First Name/.test(f.label))?.value).toBe("Aarav");
    expect(aj.screenshotPath).toBeTruthy();
    await approveReview(userId, aj.id);
    const [second] = await drain();
    expect(second.status).toBe("submitted");
    expect(mock.submissions).toHaveLength(1);
  }, 90_000);

  it("pauses for questions the profile can't answer and never bypasses CAPTCHAs", async () => {
    await addMockJobs([
      { key: "q1", title: "ML Engineer Custom", path: "custom" },
      { key: "c1", title: "ML Engineer Captcha", path: "captcha" },
    ]);
    await applyToAll(userId, { q: "ML Engineer", source: "mockboard" }, { policy: "auto" });
    const results = await drain();
    const byJob = await db.applyJob.findMany({ where: { userId }, include: { job: true } });
    expect(byJob.find((j) => j.job.externalId === "q1")?.status).toBe("needs-you");
    expect(byJob.find((j) => j.job.externalId === "q1")?.reason).toMatch(/favourite data structure/);
    expect(byJob.find((j) => j.job.externalId === "c1")?.status).toBe("paused");
    expect(byJob.find((j) => j.job.externalId === "c1")?.reason).toMatch(/CAPTCHA/);
    expect(mock.submissions).toHaveLength(0);
    expect(results.length).toBe(2);
  }, 90_000);

  it("creates an employer account and uses the verification code from the inbox", async () => {
    mock.onCodeSent = async (email, code) => {
      await ingestEmail(userId, { messageId: `<code-${code}@mock>`, fromAddress: "noreply@myworkday.com", fromName: "Mock Co (Workday)", toAddress: email, subject: "Your verification code", bodyText: `Your verification code is ${code}. It expires in 10 minutes.` });
    };
    await addMockJobs([{ key: "w1", title: "ML Engineer Workday", path: "account" }]);
    await applyToAll(userId, { q: "ML Engineer Workday" }, { policy: "auto" });
    const [r] = await drain();
    expect(mock.codesSent).toHaveLength(1);
    expect(r.status).toBe("submitted");
    expect(mock.submissions.map((s) => s.jobId)).toEqual(["w1"]);
  }, 90_000);

  it("respects the daily cap (over-cap jobs stay queued) and the Stop-all switch", async () => {
    await db.userSettings.update({ where: { userId }, data: { applyDailyCap: 1 } });
    await db.applyJob.deleteMany({});
    await addMockJobs([{ key: "k1", title: "ML Engineer Cap One" }, { key: "k2", title: "ML Engineer Cap Two" }]);
    await applyToAll(userId, { q: "ML Engineer Cap" }, { policy: "auto" });
    const results = await drain();
    expect(results).toHaveLength(1);
    expect(await db.applyJob.count({ where: { userId, status: "queued" } })).toBe(1);
    await db.userSettings.update({ where: { userId }, data: { applyDailyCap: 25 } });
    await stopAll(true);
    expect(await runEngineOnce(opts())).toBeNull();
    expect(await db.applyJob.count({ where: { userId, status: "queued" } })).toBe(1);
  }, 90_000);
});

describe("Keep applying to new matches (acceptance)", () => {
  it("queues and applies to a new matching job automatically; a non-matching job is ignored", async () => {
    const watcher = await saveWatcher(userId, { q: "ML Engineer", source: "mockboard" }, { policy: "auto", intervalMin: 15, minBand: "Moderate" });
    // the mock job board publishes two new jobs
    await new Promise((r) => setTimeout(r, 20));
    await addMockJobs([{ key: "n1", title: "ML Engineer New" }, { key: "n2", title: "Barista" }]);
    const queued = await runWatchers({ force: true, userId });
    expect(queued).toBe(1);
    const [r] = await drain();
    expect(r.status).toBe("submitted");
    expect(mock.submissions.map((s) => s.jobId)).toEqual(["n1"]);
    // turning it off stops new jobs being queued; submitted stays submitted
    await setWatcher(userId, watcher.id, false);
    await addMockJobs([{ key: "n3", title: "ML Engineer Newer" }]);
    expect(await runWatchers({ force: true, userId })).toBe(0);
    expect((await db.applyJob.findFirstOrThrow({ where: { userId, job: { externalId: "n1" } } })).status).toBe("submitted");
  }, 90_000);
});
