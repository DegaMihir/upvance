import { db } from "./db";

/** Every automatic action is logged (rule 3: opt-in, rate-limited and logged). */
export async function logActivity(userId: string | null, action: string, details = "", automatic = true) {
  await db.activityLog.create({ data: { userId, action, details: details.slice(0, 2000), automatic } });
}
