/**
 * Job sites that list other companies' jobs: We Work Remotely (public RSS feeds) and
 * Y Combinator's job board (the job data embedded in its public pages).
 * Both allow these paths in robots.txt – see docs/connectors.md. Read-only and rate-limited.
 *
 * Neither site lets a tool apply: WWR hides the apply link behind a job-seeker account, and YC
 * applications go through a Work at a Startup account. So for each job we look for the same job
 * on the employer's own job board (Ashby, Greenhouse, Lever…) – that version is the one Upvance
 * can apply to. If it isn't found, the job is still shown, with a link to apply on the site yourself.
 */
import { decodeEntities, stripHtml } from "../text";
import { mapLimit } from "./boards";
import { fetchBoard, type RawJob } from "./index";
import type { BoardAts } from "../ats";
import { boardFromUrl } from "../ats";

const UA = "UpvanceLocal/1.0 (personal job-search assistant)";

async function getText(url: string, accept = "text/html") {
  const res = await fetch(url, { headers: { "user-agent": UA, accept }, signal: AbortSignal.timeout(25_000), redirect: "follow" });
  if (res.status === 429) throw new Error(`Rate limited by ${new URL(url).hostname} – try again later`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.text();
}

const tag = (block: string, name: string) =>
  decodeEntities(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() ?? "");
const toDate = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// ---------------------------------------------------------------- We Work Remotely (RSS)
export const WWR_FEEDS = ["remote-jobs", "categories/remote-programming-jobs", "categories/remote-full-stack-programming-jobs", "categories/remote-back-end-programming-jobs", "categories/remote-devops-sysadmin-jobs"];

export function parseWwrRss(xml: string): RawJob[] {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).map((it) => {
    const full = tag(it, "title");
    const i = full.indexOf(":");
    const company = i > 0 ? full.slice(0, i).trim() : "Unknown company";
    const title = i > 0 ? full.slice(i + 1).trim() : full;
    const link = tag(it, "link") || tag(it, "guid");
    const region = tag(it, "region");
    const description = stripHtml(decodeEntities(tag(it, "description")));
    // The region field is often "Anywhere in the World" even when the text limits it – the
    // job analysis reads the description too, so restrictions there still count.
    const location = region ? `Remote (${region})` : "Remote";
    return {
      source: "weworkremotely",
      externalId: link.replace(/^https?:\/\/[^/]+/, ""),
      title,
      company,
      location,
      description: region ? `Region: ${region}\n\n${description}` : description,
      applyUrl: link,
      sourceUrl: link,
      postedAt: toDate(tag(it, "pubDate")),
      employmentType: /contract/i.test(tag(it, "type")) ? "contract" : null,
    };
  });
}

export async function fetchWeWorkRemotely(feeds = WWR_FEEDS.slice(0, 2)): Promise<RawJob[]> {
  const seen = new Map<string, RawJob>();
  for (const f of feeds) {
    const xml = await getText(`https://weworkremotely.com/${f}.rss`, "application/rss+xml");
    for (const j of parseWwrRss(xml)) if (!seen.has(j.externalId)) seen.set(j.externalId, j);
    await new Promise((r) => setTimeout(r, 400));
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- Y Combinator jobs
type YcPosting = {
  id: number;
  title: string;
  url: string;
  location?: string;
  type?: string;
  salaryRange?: string;
  minExperience?: string;
  visa?: string;
  companyName: string;
  companyUrl?: string;
  companyOneLiner?: string;
  createdAt?: string;
  description?: string;
};

/** Pull the Inertia page data a ycombinator.com page renders from. */
export function ycPageData(html: string): { component: string; props: Record<string, unknown> } | null {
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
}

/** "$70K - $120K" → yearly USD numbers */
export function parseYcSalary(s?: string): { min: number | null; max: number | null; currency: string | null } {
  if (!s) return { min: null, max: null, currency: null };
  const cur = s.includes("£") ? "GBP" : s.includes("€") ? "EUR" : s.includes("₹") ? "INR" : s.includes("$") ? (/\bCA\$|C\$/.test(s) ? "CAD" : "USD") : null;
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([KkMm])?/g)].map((m) => Number(m[1]) * (/k/i.test(m[2] ?? "") ? 1_000 : /m/i.test(m[2] ?? "") ? 1_000_000 : 1));
  return { min: nums[0] ?? null, max: nums[1] ?? nums[0] ?? null, currency: cur };
}

/** YC's visa field, written so the job analysis reads it like posting text. */
export function ycVisaSentence(visa?: string) {
  if (!visa) return "";
  if (/will sponsor/i.test(visa)) return "Visa sponsorship: we will sponsor visas for this role.";
  if (/citizen\/visa only|citizenship\/visa required/i.test(visa)) return "Work authorization: US citizens or candidates who already hold a US work visa only. We do not sponsor visas.";
  if (/not required/i.test(visa)) return "Work authorization: US citizenship or a US visa is not required.";
  return `Visa: ${visa}.`;
}

/** "about 2 months" / "12 days" → a date (approximate) */
function ycAge(s?: string): Date | null {
  const m = s?.match(/(\d+|an?|about an?)\s+(minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const ms = { minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9, year: 3.1536e10 }[m[2].toLowerCase() as "day"];
  return new Date(Date.now() - n * ms);
}

export const YC_ROLES = ["software-engineer", "science", "product-manager", "designer", "operations", "marketing", "sales-manager", "support", "recruiting-hr"];

/** Which YC role pages fit your target titles. */
export function ycRolesFor(titles: string[]): string[] {
  const t = titles.join(" ").toLowerCase();
  const out = new Set<string>();
  if (!t || /engineer|developer|ml|ai|llm|machine learning|data|software|backend|frontend|full.?stack|devops|platform|sre/.test(t)) out.add("software-engineer");
  if (/scien|research|machine learning|\bml\b|data/.test(t)) out.add("science");
  if (/product/.test(t)) out.add("product-manager");
  if (/design|ux|ui/.test(t)) out.add("designer");
  if (/sales|account exec/.test(t)) out.add("sales-manager");
  if (/market/.test(t)) out.add("marketing");
  if (/operat/.test(t)) out.add("operations");
  return [...out];
}

export function ycPostingToRaw(p: YcPosting, company?: { website?: string; long_description?: string }): RawJob {
  const pay = parseYcSalary(p.salaryRange);
  const url = `https://www.ycombinator.com${p.url}`;
  const lines = [
    p.description ?? p.companyOneLiner ?? "",
    p.salaryRange ? `Salary: ${p.salaryRange}` : "",
    p.minExperience ? `Minimum experience: ${p.minExperience}` : "",
    ycVisaSentence(p.visa),
    company?.website ? `Company website: ${company.website}` : "",
  ].filter(Boolean);
  return {
    source: "ycombinator",
    externalId: String(p.id),
    title: p.title,
    company: p.companyName,
    location: p.location || "",
    description: stripHtml(lines.join("\n\n")),
    applyUrl: url,
    sourceUrl: url,
    postedAt: ycAge(p.createdAt),
    employmentType: p.type ? p.type.toLowerCase().replace(/\s+/g, "-") : null,
    salaryMin: pay.min,
    salaryMax: pay.max,
    salaryCurrency: pay.currency,
  };
}

/**
 * YC jobs for some roles (role page + its remote page), with the full description from each
 * job's page. `maxDetails` limits how many job pages are opened per run.
 */
export async function fetchYcJobs(opts: { roles?: string[]; remote?: boolean; maxDetails?: number } = {}): Promise<(RawJob & { website?: string })[]> {
  const roles = opts.roles?.length ? opts.roles : ["software-engineer"];
  const pages = roles.flatMap((r) => [`/jobs/role/${r}`, ...(opts.remote !== false ? [`/jobs/role/${r}/remote`] : [])]);
  const postings = new Map<number, YcPosting>();
  for (const p of pages) {
    const d = ycPageData(await getText(`https://www.ycombinator.com${p}`));
    for (const j of (d?.props.jobPostings as YcPosting[] | undefined) ?? []) postings.set(j.id, j);
    await new Promise((r) => setTimeout(r, 500));
  }
  const list = [...postings.values()].slice(0, opts.maxDetails ?? 60);
  return mapLimit(
    list,
    2,
    async (p) => {
      try {
        const d = ycPageData(await getText(`https://www.ycombinator.com${p.url}`));
        const job = d?.props.job as YcPosting | undefined;
        const company = d?.props.company as { website?: string; long_description?: string } | undefined;
        return { ...ycPostingToRaw({ ...p, ...(job ?? {}) }, company), website: company?.website };
      } catch {
        return ycPostingToRaw(p);
      }
    },
    400,
  );
}

// ---------------------------------------------------------------- find it on the employer's own board
const FAST_BOARDS: BoardAts[] = ["ashby", "greenhouse", "lever", "workable"];
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(remote|hybrid|onsite|us|usa|uk|eu|emea|apac|global|worldwide|anywhere)\b/g, " ").replace(/\s+/g, " ").trim();

/** Same job? Exact title, or one title contains the other and they share almost all words. */
export function sameTitle(a: string, b: string) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const wa = new Set(x.split(" "));
  const wb = new Set(y.split(" "));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.max(wa.size, wb.size) >= 0.8;
}

function slugsFor(company: string, website?: string) {
  const out = new Set<string>();
  const clean = company.toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|co|gmbh|labs?|technologies|technology|ai|hq)\b\.?/g, " ").trim();
  out.add(clean.replace(/[^a-z0-9]/g, ""));
  out.add(clean.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  out.add(company.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (website) {
    try {
      out.add(new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "").split(".")[0]);
    } catch {
      /* ignore */
    }
  }
  return [...out].filter((s) => s.length >= 2).slice(0, 4);
}

const boardCache = new Map<string, Promise<RawJob[] | null>>();

/** Load a company's public board (first one that exists), cached for this run. */
async function companyBoard(company: string, website?: string): Promise<RawJob[] | null> {
  const key = company.toLowerCase();
  if (!boardCache.has(key)) {
    boardCache.set(
      key,
      (async () => {
        if (website) {
          try {
            const { careersFromHomepage } = await import("../discovery");
            const hit = await careersFromHomepage(website);
            const b = hit?.board;
            if (b) return await fetchBoard(b.ats as BoardAts, b.slug);
          } catch {
            /* fall through to guesses */
          }
        }
        for (const kind of FAST_BOARDS) {
          for (const slug of slugsFor(company, website)) {
            try {
              const jobs = await fetchBoard(kind, slug);
              if (jobs.length) return jobs; // a wrong-company guess is harmless: the job title must match too
            } catch {
              /* not on this board */
            }
          }
        }
        return null;
      })(),
    );
  }
  return boardCache.get(key)!;
}

/**
 * Swap a job-site listing for the same job on the employer's own board (which Upvance can apply to).
 * Returns the board version, or the original when it isn't found.
 */
export async function onEmployerBoard(job: RawJob & { website?: string }): Promise<RawJob> {
  const link = job.description.match(/https?:\/\/[^\s"'<>)]+/g)?.find((l) => boardFromUrl(l)?.jobId);
  if (link) {
    try {
      const { fetchJobFromUrl } = await import("./index");
      return await fetchJobFromUrl(link);
    } catch {
      /* fall through */
    }
  }
  const board = await companyBoard(job.company, job.website);
  const hit = board?.find((b) => sameTitle(b.title, job.title));
  if (!hit) return job;
  return { ...hit, company: job.company, salaryMin: hit.salaryMin ?? job.salaryMin, salaryMax: hit.salaryMax ?? job.salaryMax, salaryCurrency: hit.salaryCurrency ?? job.salaryCurrency, description: job.source === "ycombinator" && ycVisaLine(job.description) && !/visa/i.test(hit.description) ? `${hit.description}\n\n${ycVisaLine(job.description)}` : hit.description };
}
const ycVisaLine = (d: string) => d.split("\n").find((l) => /^(Visa sponsorship|Work authorization|Visa):/.test(l)) ?? "";

export function clearBoardCache() {
  boardCache.clear();
}

/** One YC job page (pasted link). */
export async function fetchYcJob(url: string): Promise<RawJob & { website?: string }> {
  const d = ycPageData(await getText(url));
  const job = d?.props.job as YcPosting | undefined;
  if (!job) throw new Error("Couldn't read that YC job page.");
  const company = d?.props.company as { website?: string; long_description?: string } | undefined;
  return { ...ycPostingToRaw(job, company), website: company?.website };
}
