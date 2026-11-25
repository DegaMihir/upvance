/**
 * Runs due saved searches: 1–4 times a day at fixed local times in the
 * user's time zone. Each (search, day, slot) runs at most once.
 */
import { db } from "../db";
import { localNow } from "../time";
import { RUN_HOURS, runSavedSearch } from "./pipeline";

export function dueSlot(runsPerDay: number, tz: string, now = new Date()): { slot: string; hour: number } | null {
  const hours = RUN_HOURS[Math.min(4, Math.max(1, runsPerDay))];
  const local = localNow(tz, now);
  let idx = -1;
  hours.forEach((h, i) => {
    if (local.hour >= h) idx = i;
  });
  if (idx < 0) return null;
  return { slot: `${local.date}#${idx}`, hour: hours[idx] };
}

export async function runScheduler(opts: { now?: Date; network?: boolean; log?: (...a: unknown[]) => void } = {}) {
  const now = opts.now ?? new Date();
  const users = await db.user.findMany({ where: { settings: { autoModeEnabled: true } }, include: { savedSearches: { where: { enabled: true } } } });
  let runs = 0;
  for (const u of users) {
    for (const s of u.savedSearches) {
      const due = dueSlot(s.runsPerDay, u.timezone, now);
      if (!due) continue;
      const exists = await db.autoRun.findUnique({ where: { savedSearchId_slot: { savedSearchId: s.id, slot: due.slot } } });
      if (exists) continue;
      opts.log?.(`Running “${s.name}” (slot ${due.slot}, ${due.hour}:00 ${u.timezone}).`);
      const r = await runSavedSearch(s.id, { trigger: "schedule", slot: due.slot, now, network: opts.network, log: (m) => opts.log?.(m) });
      if (r.runId) runs++;
    }
  }
  return runs;
}
