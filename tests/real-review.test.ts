/**
 * Opt-in check against ONE real employer form, in review mode with dry-run on:
 * the engine must fill the form and stop at the review screen WITHOUT submitting.
 * Uses the fictional demo profile and the throwaway test database.
 * Run: $env:REAL_SITE_TEST="1"; npx vitest run tests/real-review.test.ts
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { fetchCompanyBoard } from "@/lib/sources";
import { ingestJobs } from "@/lib/jobs/ingest";
import { recomputeMatches } from "@/lib/matching";
import { processApplyJob } from "@/lib/apply/engine";
import { parseJson } from "@/lib/utils";

describe.runIf(process.env.REAL_SITE_TEST === "1")("real employer form (review mode, never submits)", () => {
  it("fills a real Greenhouse form and stops at review", async () => {
    process.env.BOARD_MAX_JOBS = "5";
    const { userId } = await seedDemo();
    await db.userSettings.update({ where: { userId }, data: { applicationEmail: "aarav.mehta+upvance@example.com" } });
    const board = await fetchCompanyBoard(process.env.REAL_SITE_BOARD ?? "https://boards.greenhouse.io/gitlab");
    const res = await ingestJobs(board.jobs.slice(0, 80));
    await recomputeMatches(userId, res.jobIds);
    const match = (await db.match.findFirst({ where: { userId, jobId: { in: res.jobIds }, eligibility: "Eligible" }, orderBy: { score: "desc" } })) ?? (await db.match.findFirst({ where: { userId, jobId: { in: res.jobIds }, eligibility: { not: "Ineligible" } }, orderBy: { score: "desc" } }));
    expect(match, "no job on this board is open to the demo profile").toBeTruthy();
    const job = await db.job.findUniqueOrThrow({ where: { id: match!.jobId }, include: { company: true } });
    // the demo profile treats "needs review" eligibility as checked for this smoke test
    await db.userSettings.update({ where: { userId }, data: { strictSponsorship: false } });
    // bypass eligibility pre-checks for this smoke test: we only test filling + stopping
    await db.application.deleteMany({ where: { jobId: job.id } });
    const aj = await db.applyJob.create({ data: { userId, jobId: job.id, status: "queued", policy: "review" }, include: { job: { include: { company: true } } } });
    const r = await processApplyJob(aj, { headless: true, delayMs: 50, dryRun: true, dataDir: path.join(process.cwd(), "data", "test-engine") });
    const after = await db.applyJob.findUniqueOrThrow({ where: { id: aj.id } });
    const filled = parseJson<{ label: string; value: string }[]>(after.filledValues, []);
    console.log(`Real form: ${job.applyUrl}\nStatus: ${r.status} – ${r.reason}\nFilled ${filled.length} fields:\n${filled.map((f) => `  ${f.label.slice(0, 60)} = ${f.value.slice(0, 60)}`).join("\n")}\nScreenshot: ${after.screenshotPath}`);
    expect(["review", "needs-you"]).toContain(r.status); // never "submitted"
    expect(after.submittedAt).toBeNull();
    expect(filled.some((f) => /first name/i.test(f.label) && f.value === "Aarav")).toBe(true);
    expect(filled.some((f) => /e-?mail/i.test(f.label))).toBe(true);
    expect(filled.some((f) => /resume|cv/i.test(f.label))).toBe(true);
  }, 180_000);
});
