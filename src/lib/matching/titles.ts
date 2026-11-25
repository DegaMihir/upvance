/**
 * Does a job title fit one of your target roles? Client-safe (no database).
 * A target matches when every key word of it appears in the job title, allowing common
 * spellings: engineer = developer, "Full-stack"/"Fullstack" = "Full Stack", "GenAI" = "Generative AI",
 * "Back-end" = "Backend", plurals ("AI Agents Engineer"). Words like Senior/Lead/Staff are ignored,
 * and text in brackets is treated as a detail, e.g. "Backend Developer (Node.js / Python)" matches any
 * Backend Developer / Backend Engineer.
 */

const STOP = new Set("senior junior lead staff principal head of and the for with remote hybrid sr jr ii iii iv mid level a an in at".split(" "));

const SAME: Record<string, string[]> = {
  engineer: ["engineer", "engineering", "developer", "swe", "dev"],
  developer: ["developer", "engineer", "engineering", "dev"],
  engineering: ["engineering", "engineer", "developer"],
  ml: ["ml", "machine learning"],
  ai: ["ai", "artificial intelligence"],
  llm: ["llm", "large language model"],
  scientist: ["scientist", "science"],
  agent: ["agent", "agentic"],
  agentic: ["agentic", "agent"],
  application: ["application", "app"],
};

/** Lower-case and unify spellings so titles can be compared word by word. */
export function normalizeTitle(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/full[\s-]?stack/g, "full stack")
    .replace(/back[\s-]end/g, "backend")
    .replace(/front[\s-]end/g, "frontend")
    .replace(/\bgen[\s-]?ai\b/g, "generative ai")
    .replace(/\bnode\.?js\b/g, "node")
    .replace(/\bllms\b/g, "llm")
    .replace(/\bai\/ml\b|\bml\/ai\b/g, "ai ml")
    .replace(/[^a-z0-9+# ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Key words of each target title (brackets are optional details, so they're left out). */
export function titleKeywords(titles: string[]): string[][] {
  return titles
    .map((t) => normalizeTitle(t.replace(/\(.*?\)|\[.*?\]/g, " ")).trim().split(" ").filter((w) => w.length > 1 && !STOP.has(w)))
    .filter((ws) => ws.length);
}

/** Does a job title fit one of your target titles? (all the key words of one target appear) */
export function fitsTargets(title: string, keys: string[][]): boolean {
  if (!keys.length) return true;
  const t = normalizeTitle(title);
  const has = (w: string) => (SAME[w] ?? [w]).some((x) => t.includes(` ${x} `) || t.includes(` ${x}s `));
  return keys.some((ws) => ws.every(has));
}

/** Which target title a job fits first (for showing "matches: AI Engineer"). */
export function matchingTarget(title: string, titles: string[]): string | null {
  for (const t of titles) if (fitsTargets(title, titleKeywords([t]))) return t;
  return null;
}
