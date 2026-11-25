/* Seed demo data: npm run seed */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedDemo } from "../src/lib/demo/seed";
import { sampleResume } from "../src/lib/demo/data";
import { resumeToPdf } from "../src/lib/resume/export";
import { db } from "../src/lib/db";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env"));
} catch {
  /* .env optional for seeding */
}

async function main() {
  console.log("Seeding Upvance demo data…");
  await seedDemo({ log: (s) => console.log("  •", s) });
  const dir = path.resolve(import.meta.dirname, "../public/samples");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "sample-resume.pdf"), await resumeToPdf(sampleResume));
  console.log("  • Sample resume PDF: public/samples/sample-resume.pdf");
  console.log("Done. Sign in with demo@upvance.local / demo12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
