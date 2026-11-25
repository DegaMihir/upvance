// One-time setup: creates .env from .env.example if missing, adds missing
// secrets, creates the database and seeds demo data.
// Never prints or overwrites existing values (including your API keys).
import { existsSync, readFileSync, appendFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env");

if (!existsSync(envPath)) {
  copyFileSync(path.join(root, ".env.example"), envPath);
  console.log("Created .env from .env.example");
}
const text = readFileSync(envPath, "utf8");
const has = (k) => new RegExp(`^${k}=.+`, "m").test(text);
const defined = (k) => new RegExp(`^${k}=`, "m").test(text);
const add = [];
if (!has("AUTH_SECRET")) add.push(`AUTH_SECRET=${randomBytes(32).toString("base64")}`);
if (!has("APP_ENCRYPTION_KEY")) add.push(`APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
for (const [k, v] of [["PORT", "3100"], ["DATABASE_URL", '"file:./dev.db"'], ["AUTH_TRUST_HOST", "true"], ["ANALYSIS_PROVIDER", "gemini"], ["WRITING_PROVIDER", "gemini"], ["AI_FALLBACK_PROVIDER", "groq"]]) {
  if (!defined(k)) add.push(`${k}=${v}`);
}
// Replace empty placeholder secrets by appending (dotenv uses the last value)
if (add.length) {
  appendFileSync(envPath, `${text.endsWith("\n") ? "" : "\n"}\n# Added by npm run setup\n${add.join("\n")}\n`);
  console.log(`Added to .env: ${add.map((l) => l.split("=")[0]).join(", ")}`);
}
process.loadEnvFile(envPath);
for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY"]) {
  console.log(`${k}: ${process.env[k] ? "set ✓" : "empty – the app will use rule-based fallbacks"}`);
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
run("npx prisma db push --skip-generate");
run("npx prisma generate");
run("npx tsx prisma/seed.ts");
console.log("\nSetup complete. Start the app with: npm run dev");
