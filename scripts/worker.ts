/**
 * Background worker (runs locally next to the web app; started by `npm run dev`).
 * - every 20 s: apply engine – next queued application (one at a time)
 * - every minute: auto-mode scheduler, "keep applying" watchers, spread-out AI queue
 * - every 5 min: inbox sync
 * - hourly: company discovery batch; every 2 h: refresh discovered boards
 * - every 6 h: refresh followed company boards
 * - weekly: official sponsor lists, insights suggestions
 * - daily 18:00: digest email (if turned on)
 */
import path from "node:path";
import cron from "node-cron";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));
} catch {
  /* optional */
}

const { db } = await import("../src/lib/db");
const { processTasks, enqueueAiAnalysis, setState } = await import("../src/lib/tasks");
const { refreshCompanyBoard } = await import("../src/lib/jobs/refresh");
const { refreshSponsorList } = await import("../src/lib/sponsors/importers");
const { SPONSOR_LISTS } = await import("../src/lib/sponsors/lookup");
const { recomputeMatches } = await import("../src/lib/matching");
const { runScheduler } = await import("../src/lib/auto/scheduler");
const { logActivity } = await import("../src/lib/activity");
const { runEngineOnce, setEngineStatus } = await import("../src/lib/apply/engine");
const { runWatchers } = await import("../src/lib/apply/queue");
const { syncAllMailboxes } = await import("../src/lib/inbox/mailbox");
const { runDiscovery, refreshDiscoveredBoards } = await import("../src/lib/discovery");
const { sendDigests } = await import("../src/lib/digest");
const { checkJobSites } = await import("../src/lib/jobs/job-sites");

const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString("en-GB"), ...a);
const locks = new Set<string>();
async function once(name: string, fn: () => Promise<unknown>) {
  if (locks.has(name)) return;
  locks.add(name);
  try {
    await fn();
  } catch (e) {
    log(`${name} error:`, (e as Error).message);
  } finally {
    locks.delete(name);
  }
}

async function everyMinute() {
  await setState("worker-heartbeat", new Date().toISOString());
  const runs = await runScheduler({ log });
  if (runs) log(`Scheduler: ${runs} saved-search run(s) completed.`);
  const queued = await runWatchers();
  if (queued) log(`Keep applying: ${queued} new matching job(s) queued.`);
  const n = await processTasks(3, log);
  if (n) log(`AI queue: ${n} job(s) analysed.`);
}

async function engineTick() {
  // drain the queue one job at a time
  for (let i = 0; i < 20; i++) {
    const r = await runEngineOnce({ log: (s) => log("[apply]", s) });
    if (!r) break;
    log(`[apply] → ${r.status}${r.reason ? `: ${r.reason}` : ""}`);
  }
}

/** Remotive, Remote OK, We Work Remotely and YC jobs for each user's target roles. */
async function jobSites() {
  const users = await db.user.findMany({ where: { profiles: { some: {} } }, select: { id: true } });
  for (const u of users) {
    try {
      const run = await checkJobSites(u.id, { log });
      await recomputeMatches(u.id, run.jobIds);
      await enqueueAiAnalysis(u.id, run.newJobIds);
      for (const e of run.errors) log(`Job site failed: ${e}`);
    } catch (e) {
      log(`Job sites check failed: ${(e as Error).message}`);
    }
  }
}

async function refreshBoards() {
  const followed = await db.followedCompany.findMany({ include: { company: true } });
  const companies = new Map(followed.map((f) => [f.companyId, f]));
  for (const [companyId, f] of companies) {
    try {
      const res = await refreshCompanyBoard(companyId);
      for (const u of new Set(followed.filter((x) => x.companyId === companyId).map((x) => x.userId))) {
        await recomputeMatches(u, res.jobIds);
        await enqueueAiAnalysis(u, res.newJobIds);
      }
      log(`Refreshed ${f.company.name}: ${res.created} new jobs.`);
    } catch (e) {
      log(`Refresh failed for ${f.company.name}: ${(e as Error).message}`);
    }
  }
}

async function discovery() {
  if (!(await db.userSettings.count({ where: { discoveryEnabled: true } }))) return;
  const r = await runDiscovery({ batch: 10, log: (s) => log("[discovery]", s) });
  log(`[discovery] checked ${r.checked}, found ${r.found}, ${r.jobsAdded} new jobs.`);
}

async function refreshSponsors() {
  for (const id of Object.keys(SPONSOR_LISTS) as (keyof typeof SPONSOR_LISTS)[]) {
    const r = await refreshSponsorList(id);
    log(`Sponsor list ${id}: ${r.message}`);
    await logActivity(null, `Sponsor list refresh: ${id}`, r.message);
  }
}

async function weeklySuggestions() {
  const { refreshSuggestions } = await import("../src/lib/insights");
  for (const u of await db.user.findMany({ select: { id: true } })) {
    const n = await refreshSuggestions(u.id);
    if (n) await logActivity(u.id, "Continuous optimisation", `${n} new suggestion(s) on the Insights page`);
  }
}

setInterval(() => void once("engine", engineTick), 20_000);
cron.schedule("* * * * *", () => void once("minute", everyMinute));
cron.schedule("*/5 * * * *", () => void once("inbox", async () => syncAllMailboxes(log)));
cron.schedule("7 * * * *", () => void once("discovery", discovery));
cron.schedule("37 */2 * * *", () => void once("discovered-boards", async () => log(`Discovered boards refreshed: ${(await refreshDiscoveredBoards(25)).boards}`)));
cron.schedule("17 */6 * * *", () => void once("boards", refreshBoards));
cron.schedule("47 */6 * * *", () => void once("job-sites", jobSites)); // every 6 h
cron.schedule("40 3 * * 0", () => void once("sponsors", refreshSponsors)); // Sundays 03:40
cron.schedule("10 7 * * 1", () => void once("suggestions", weeklySuggestions)); // Mondays 07:10
cron.schedule("0 18 * * *", () => void once("digest", async () => log(`Digest emails sent: ${await sendDigests()}`)));

await setEngineStatus("idle", "Ready");
log("Worker started: apply engine, scheduler, watchers, inbox sync, discovery and refresh jobs are running.");
void once("minute", everyMinute);
