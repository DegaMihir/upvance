import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** Creates a fresh, throwaway test database (prisma/test.db) – never touches dev.db. */
export default function setup() {
  const root = path.resolve(import.meta.dirname, "..");
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(root, "prisma", f), { force: true });
  execSync("npx prisma db push --skip-generate", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.db", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
