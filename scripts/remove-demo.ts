/* Remove demo jobs/applications/history but keep accounts, profiles, settings and sponsor lists.
   Run: npm run demo:remove */
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));
} catch {
  /* optional */
}
const { db } = await import("../src/lib/db");
const { removeDemoData } = await import("../src/lib/demo/visibility");
const r = await removeDemoData();
await db.userSettings.updateMany({ data: { showDemoData: false } });
console.log(`Removed ${r.jobs} demo jobs (with their applications), ${r.companies} demo companies, ${r.outreach} demo messages, ${r.sponsorLists} demo sponsor lists.`);
console.log("Kept: your account(s), profiles, settings, saved searches and the official sponsor lists.");
await db.$disconnect();
