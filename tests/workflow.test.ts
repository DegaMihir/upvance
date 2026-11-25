import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import {
  DuplicateError,
  acknowledgeCheck,
  confirmSubmitted,
  createApplication,
  prepareApplication,
  saveAnswers,
  setCoverLetter,
  setOutcome,
  setResumeStatus,
  validateApplication,
} from "@/lib/applications";
import { ingestJobs } from "@/lib/jobs/ingest";
import { parseJson } from "@/lib/utils";
import type { ScreeningAnswer } from "@/lib/writing/screening";

let userId: string;
const jobId = async (key: string) => (await db.job.findFirstOrThrow({ where: { source: "demo", externalId: key } })).id;

beforeAll(async () => {
  ({ userId } = await seedDemo());
});

describe("manual workflow", () => {
  let appId: string;

  it("prepares documents and pauses under “Needs you” until approved", async () => {
    const app = await createApplication(userId, await jobId("northwind-sr-mle"));
    appId = app.id;
    const r = await prepareApplication(app.id, userId, { useAI: false });
    expect(r.status).toBe("Needs you");
    expect(r.failing.map((f) => f.id)).toContain("resume"); // approval required by default
    const full = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { tailoredResume: true } });
    expect(full.tailoredResume?.status).toBe("draft");
    expect(full.coverLetterNeeded).toBe(true); // posting accepts a cover letter
    expect(full.coverLetter).toContain("Northwind Analytics");
    const answers = parseJson<ScreeningAnswer[]>(full.screeningAnswers, []);
    expect(answers.find((a) => a.id === "work-auth")?.answer).toBe("No");
    expect(answers.find((a) => a.id === "sponsorship")?.answer).toBe("Yes");
  });

  it("cannot be marked Submitted before it is Ready", async () => {
    await expect(confirmSubmitted(appId, userId, { confirmed: true })).rejects.toThrow(/Only applications that are Ready/);
  });

  it("becomes Ready after the user approves resume and cover letter", async () => {
    await setResumeStatus(appId, userId, "approved");
    const r = await setCoverLetter(appId, userId, null, "approved");
    expect(r.failing).toEqual([]);
    expect(r.status).toBe("Ready");
  });

  it("is only Submitted after explicit confirmation", async () => {
    await expect(confirmSubmitted(appId, userId, { confirmed: false })).rejects.toThrow(/confirmed/);
    expect((await db.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe("Ready");
    await confirmSubmitted(appId, userId, { confirmed: true });
    const a = await db.application.findUniqueOrThrow({ where: { id: appId } });
    expect(a.status).toBe("Submitted");
    expect(a.submittedAt).not.toBeNull();
  });

  it("recording an interview pauses that company", async () => {
    await setOutcome(appId, userId, "Interview");
    const app = await db.application.findUniqueOrThrow({ where: { id: appId }, include: { job: true } });
    const pause = await db.companyPause.findFirst({ where: { userId, companyId: app.job.companyId } });
    expect(pause).not.toBeNull();
    expect(pause!.until.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });
});

describe("validation", () => {
  it("unknown sponsorship needs the user's confirmation; missing answers pause it", async () => {
    const app = await createApplication(userId, await jobId("arcadia-llm"));
    await prepareApplication(app.id, userId, { useAI: false });
    await setResumeStatus(app.id, userId, "use-original");
    let r = await validateApplication(app.id, userId);
    expect(r.failing.map((f) => f.id)).toContain("eligibility");
    r = await acknowledgeCheck(app.id, userId, "eligibility");
    expect(r.failing.map((f) => f.id)).not.toContain("eligibility");
    // blank the salary answer → paused again
    r = await saveAnswers(app.id, userId, [{ id: "salary", answer: "" }]);
    expect(r.status).toBe("Needs you");
    expect(r.failing.map((f) => f.id)).toContain("answer-salary");
  });

  it("ineligible jobs can't be acknowledged away", async () => {
    const app = await createApplication(userId, await jobId("kestrel-defense-ml"));
    const r = await prepareApplication(app.id, userId, { useAI: false });
    expect(r.status).toBe("Needs you");
    await expect(acknowledgeCheck(app.id, userId, "eligibility")).rejects.toThrow(/can't be skipped/);
  });
});

describe("duplicate detection (acceptance: a duplicate is blocked with a clear message)", () => {
  it("blocks the same job twice", async () => {
    const id = await jobId("quanta-llm");
    await createApplication(userId, id);
    await expect(createApplication(userId, id)).rejects.toThrow(DuplicateError);
    await expect(createApplication(userId, id)).rejects.toThrow(/pending application for this job/);
  });

  it("blocks the same job under a different URL / source", async () => {
    const original = await db.job.findFirstOrThrow({ where: { source: "demo", externalId: "quanta-llm" }, include: { company: true } });
    const res = await ingestJobs([
      {
        source: "url",
        externalId: original.applyUrl + "?utm_source=linkedin",
        title: original.title,
        company: original.company.name,
        location: original.location,
        description: original.description,
        applyUrl: original.applyUrl + "?utm_source=linkedin&gh_src=abc",
        sourceUrl: original.applyUrl + "?utm_source=linkedin&gh_src=abc",
        postedAt: new Date(),
      },
    ]);
    expect(res.jobIds[0]).not.toBe(original.id);
    await expect(createApplication(userId, res.jobIds[0])).rejects.toThrow(/same job listed under a different URL/);
  });

  it("enforces the per-company limit", async () => {
    await db.userSettings.update({ where: { userId }, data: { perCompanyLimit: 1 } });
    await expect(createApplication(userId, await jobId("quanta-ds"))).rejects.toThrow(/limit of 1 applications at Quanta Ledger/);
    await db.userSettings.update({ where: { userId }, data: { perCompanyLimit: 3 } });
  });

  it("blocks companies paused after an interview", async () => {
    await expect(createApplication(userId, await jobId("northwind-analyst"))).rejects.toThrow(/paused until/);
  });
});
