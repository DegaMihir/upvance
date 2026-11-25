/* Run one company-discovery batch now: npm run discover  (optional: npm run discover -- 50) */
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));
} catch {
  /* optional */
}
const { db } = await import("../src/lib/db");
const { runDiscovery } = await import("../src/lib/discovery");
const batch = Number(process.argv[2]) || 20;
console.log(`Discovering job boards for up to ${batch} companies (plus starter boards on the first run)…`);
const r = await runDiscovery({ batch, log: (s) => console.log("  •", s) });
console.log(`Done: checked ${r.checked}, found ${r.found} boards, ${r.jobsAdded} new jobs. Jobs now come from ${r.countries} countries.`);
await db.$disconnect();
