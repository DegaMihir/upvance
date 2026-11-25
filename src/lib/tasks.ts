/**
 * Background task queue (stored in the DB, processed by the worker).
 * Bulk AI analysis is spread through the day so free-tier limits aren't burned at once.
 */
import { db } from "./db";
import { parseJson } from "./utils";
import { aiAvailable, dailyLimit, providerChain, today } from "./ai";
import { analyzeJob } from "./analysis";
import { loadUserContext, recomputeMatches, worthAiAnalysis } from "./matching";

export async function enqueue(kind: string, payload: Record<string, unknown>, runAfter = new Date()) {
  return db.task.create({ data: { kind, payload: JSON.stringify(payload), runAfter } });
}

/** Queue AI analysis only for jobs that pass the free keyword/rule pre-filter. */
export async function enqueueAiAnalysis(userId: string, jobIds: string[]) {
  if (!jobIds.length || !(await aiAvailable("analysis", userId))) return 0;
  const ctx = await loadUserContext(userId);
  if (!ctx.candidate) return 0;
  const jobs = await db.job.findMany({ where: { id: { in: jobIds }, analysisSource: { not: "ai" } }, include: { company: true } });
  let n = 0;
  for (const job of jobs) {
    if (!worthAiAnalysis(job, ctx.candidate, ctx.prefs).ok) continue;
    const exists = await db.task.findFirst({ where: { kind: "ai-analyze", status: "pending", payload: { contains: job.id } } });
    if (exists) continue;
    await enqueue("ai-analyze", { jobId: job.id, userId });
    n++;
  }
  return n;
}

async function getState(key: string) {
  return (await db.systemState.findUnique({ where: { key } }))?.value ?? null;
}
export async function setState(key: string, value: string) {
  await db.systemState.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** How many bulk AI requests are allowed so far today (pro-rata through the day). */
export async function bulkAllowance(now = new Date()) {
  const chain = await providerChain("analysis");
  const primary = chain[0];
  if (!primary) return { allowed: 0, used: 0 };
  const budget = Math.floor(dailyLimit(primary) * 0.6); // keep 40% for things you click on
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const allowed = Math.min(budget, Math.ceil((budget * (minutes + 60)) / 1440));
  const used = Number(await getState(`bulk-ai:${today(now)}`)) || 0;
  return { allowed, used };
}

export async function processTasks(maxPerRun = 5, log: (s: string) => void = () => {}) {
  let processed = 0;
  for (let i = 0; i < maxPerRun; i++) {
    const task = await db.task.findFirst({ where: { status: "pending", runAfter: { lte: new Date() } }, orderBy: { createdAt: "asc" } });
    if (!task) break;
    const payload = parseJson<Record<string, string>>(task.payload, {});
    if (task.kind === "ai-analyze") {
      const { allowed, used } = await bulkAllowance();
      if (used >= allowed) {
        log(`AI queue paused: ${used}/${allowed} bulk requests used so far today (spreading through the day).`);
        break;
      }
    }
    await db.task.update({ where: { id: task.id }, data: { status: "running", attempts: { increment: 1 } } });
    try {
      if (task.kind === "ai-analyze") {
        const job = await db.job.findUnique({ where: { id: payload.jobId }, include: { company: true } });
        if (job) {
          const { aiNote } = await analyzeJob(job, { useAI: true, userId: payload.userId });
          await setState(`bulk-ai:${today()}`, String((Number(await getState(`bulk-ai:${today()}`)) || 0) + 1));
          if (aiNote) {
            // Daily limit / rate limit: put back and retry later with backoff
            const delayMin = Math.min(240, 15 * 2 ** task.attempts);
            await db.task.update({ where: { id: task.id }, data: { status: task.attempts >= 5 ? "failed" : "pending", lastError: aiNote, runAfter: new Date(Date.now() + delayMin * 60_000) } });
            log(`AI analysis postponed ${delayMin} min: ${aiNote}`);
            break;
          }
          await recomputeMatches(payload.userId, [job.id]);
        }
      }
      await db.task.update({ where: { id: task.id }, data: { status: "done", lastError: null } });
      processed++;
    } catch (e) {
      await db.task.update({
        where: { id: task.id },
        data: { status: task.attempts >= 4 ? "failed" : "pending", lastError: (e as Error).message.slice(0, 300), runAfter: new Date(Date.now() + 2 ** task.attempts * 60_000) },
      });
    }
  }
  return processed;
}

export async function queueStats() {
  const [pending, failed, done] = await Promise.all([
    db.task.count({ where: { status: "pending" } }),
    db.task.count({ where: { status: "failed" } }),
    db.task.count({ where: { status: "done", updatedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  const last = await db.task.findFirst({ where: { lastError: { not: null }, status: "pending" }, orderBy: { updatedAt: "desc" } });
  return { pending, failed, done, lastError: last?.lastError ?? null };
}
