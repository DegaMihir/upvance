/**
 * Job sources – official/public APIs only. No scraping of sites that forbid it.
 */
import { stripHtml, decodeEntities } from "../text";
import { detectAts, boardFromUrl, type BoardAts } from "../ats";
import { BOARD_CONNECTORS, BoardNotFound, fetchGemJob, fetchSmartRecruitersJob, fetchWorkableJob, fetchWorkdayJob } from "./boards";

export interface RawJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  sourceUrl: string;
  postedAt: Date | null;
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  boardSlug?: string;
  atsType?: string;
}

const HEADERS = { "user-agent": "UpvanceLocal/1.0 (personal job-search assistant)", accept: "application/json" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return (await res.json()) as T;
}
export class NotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${new URL(url).hostname}`);
  }
}

const date = (v: unknown) => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

// ---------- Greenhouse ----------
type GhJob = { id: number; title: string; absolute_url: string; location?: { name?: string }; updated_at?: string; first_published?: string; content?: string; metadata?: unknown };
export async function fetchGreenhouse(slug: string): Promise<RawJob[]> {
  const [board, data] = await Promise.all([
    getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`).catch(() => ({ name: undefined })),
    getJson<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`),
  ]);
  const company = board.name || slug;
  return data.jobs.map((j) => ghToRaw(j, slug, company));
}
function ghToRaw(j: GhJob, slug: string, company: string): RawJob {
  return {
    source: "greenhouse",
    externalId: `${slug}:${j.id}`,
    title: j.title,
    company,
    location: j.location?.name ?? "",
    description: stripHtml(decodeEntities(j.content ?? "")),
    applyUrl: j.absolute_url,
    sourceUrl: j.absolute_url,
    postedAt: date(j.first_published ?? j.updated_at),
    boardSlug: slug,
    atsType: "greenhouse",
  };
}
export async function fetchGreenhouseJob(slug: string, id: string): Promise<RawJob> {
  const [board, j] = await Promise.all([
    getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`).catch(() => ({ name: undefined })),
    getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`),
  ]);
  return ghToRaw(j, slug, board.name || slug);
}

// ---------- Lever ----------
type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
};
function leverToRaw(j: LeverJob, slug: string): RawJob {
  const lists = (j.lists ?? []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n\n");
  const desc = [j.descriptionPlain ?? stripHtml(j.description ?? ""), lists, j.additionalPlain ?? ""].filter(Boolean).join("\n\n");
  const workplace = j.workplaceType && j.workplaceType !== "unspecified" ? ` (${j.workplaceType})` : "";
  return {
    source: "lever",
    externalId: `${slug}:${j.id}`,
    title: j.text,
    company: slug,
    location: (j.categories?.location ?? "") + workplace,
    description: desc,
    applyUrl: j.applyUrl || j.hostedUrl,
    sourceUrl: j.hostedUrl,
    postedAt: date(j.createdAt),
    employmentType: j.categories?.commitment ?? null,
    salaryMin: j.salaryRange?.min ?? null,
    salaryMax: j.salaryRange?.max ?? null,
    salaryCurrency: j.salaryRange?.currency ?? null,
    boardSlug: slug,
    atsType: "lever",
  };
}
export async function fetchLever(slug: string): Promise<RawJob[]> {
  const data = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  if (!Array.isArray(data)) throw new NotFoundError("https://api.lever.co");
  return data.map((j) => leverToRaw(j, slug));
}
export async function fetchLeverJob(slug: string, id: string) {
  return leverToRaw(await getJson<LeverJob>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`), slug);
}

// ---------- Ashby ----------
type AshbyJob = {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: { summaryComponents?: { compensationType?: string; minValue?: number; maxValue?: number; currencyCode?: string }[] };
};
export async function fetchAshby(slug: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs: AshbyJob[]; apiVersion?: string }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
  );
  return (data.jobs ?? []).map((j) => {
    const salary = j.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
    const locs = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join("; ");
    return {
      source: "ashby",
      externalId: `${slug}:${j.id}`,
      title: j.title,
      company: slug,
      location: locs + (j.isRemote ? " (Remote)" : j.workplaceType === "Hybrid" ? " (Hybrid)" : ""),
      description: j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? ""),
      applyUrl: j.applyUrl || j.jobUrl,
      sourceUrl: j.jobUrl,
      postedAt: date(j.publishedAt),
      employmentType: j.employmentType ?? null,
      salaryMin: salary?.minValue ?? null,
      salaryMax: salary?.maxValue ?? null,
      salaryCurrency: salary?.currencyCode ?? null,
      boardSlug: slug,
      atsType: "ashby",
    };
  });
}

/** Boards tried (in this order) when only a company name is given. Workday needs a URL. */
export const GUESSABLE_BOARDS: BoardAts[] = ["greenhouse", "lever", "ashby", "gem", "workable", "smartrecruiters", "recruitee", "personio", "teamtailor", "breezy", "bamboohr"];

export async function fetchBoard(kind: BoardAts, slug: string): Promise<RawJob[]> {
  if (kind === "greenhouse") return fetchGreenhouse(slug);
  if (kind === "lever") return fetchLever(slug);
  if (kind === "ashby") return fetchAshby(slug);
  return BOARD_CONNECTORS[kind].fetch(slug);
}

export function slugGuesses(name: string): string[] {
  const n = name.trim();
  const clean = n.toLowerCase().replace(/\b(ltd|limited|inc|llc|gmbh|plc|b\.?v\.?|corp|corporation|co|company|group|holdings)\b\.?/g, "").trim();
  return Array.from(new Set([n, clean.replace(/[^a-z0-9]/g, ""), clean.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), n.toLowerCase().replace(/[^a-z0-9]/g, "")])).filter((s) => s.length >= 2);
}

const isNotFound = (e: unknown) => e instanceof NotFoundError || e instanceof BoardNotFound;

/** Try a company name/slug (or careers URL) on every public board type. */
export async function fetchCompanyBoard(input: string, ats?: BoardAts, opts: { kinds?: BoardAts[] } = {}) {
  const fromUrl = boardFromUrl(input);
  const slugs = fromUrl ? [fromUrl.slug] : slugGuesses(input);
  const order: BoardAts[] = fromUrl ? [fromUrl.ats] : ats ? [ats] : (opts.kinds ?? GUESSABLE_BOARDS);
  const errors: string[] = [];
  for (const kind of order) {
    for (const slug of slugs) {
      try {
        const jobs = await fetchBoard(kind, slug);
        if (!jobs.length && !fromUrl) continue; // empty boards are usually wrong guesses
        return { ats: kind, slug, jobs };
      } catch (e) {
        if (!isNotFound(e)) errors.push(`${kind}: ${(e as Error).message}`);
      }
    }
  }
  throw new Error(
    errors.length
      ? `Couldn't load the job board (${errors[0]}).`
      : `No public job board found for “${input}”. Paste the company's careers page URL (e.g. jobs.gem.com/<board>, apply.workable.com/<board>, <company>.wd5.myworkdayjobs.com/<site>).`,
  );
}

// ---------- Remotive ----------
export async function fetchRemotive(search = "", limit = 50, category = ""): Promise<RawJob[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (search) q.set("search", search);
  if (category) q.set("category", category);
  const data = await getJson<{ jobs: { id: number; url: string; title: string; company_name: string; job_type?: string; publication_date?: string; candidate_required_location?: string; salary?: string; description?: string }[] }>(
    `https://remotive.com/api/remote-jobs?${q}`,
  );
  return data.jobs.map((j) => ({
    source: "remotive",
    externalId: String(j.id),
    title: j.title,
    company: j.company_name,
    location: `Remote${j.candidate_required_location ? ` – ${j.candidate_required_location}` : ""}`,
    description: stripHtml(j.description ?? "") + (j.salary ? `\n\nSalary: ${j.salary}` : ""),
    applyUrl: j.url,
    sourceUrl: j.url,
    postedAt: date(j.publication_date),
    employmentType: j.job_type?.replace("_", "-") ?? null,
  }));
}

// ---------- RemoteOK (attribution: jobs link back to Remote OK) ----------
export async function fetchRemoteOk(tag = ""): Promise<RawJob[]> {
  const data = await getJson<({ legal?: string } & { id?: string; slug?: string; url?: string; apply_url?: string; position?: string; company?: string; location?: string; description?: string; date?: string; salary_min?: number; salary_max?: number })[]>(
    `https://remoteok.com/api${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`,
  );
  return data
    .filter((j) => j.id && j.position)
    .map((j) => ({
      source: "remoteok",
      externalId: String(j.id),
      title: decodeEntities(j.position!),
      company: decodeEntities(j.company ?? "Unknown"),
      location: `Remote${j.location ? ` – ${j.location}` : ""}`,
      description: stripHtml(j.description ?? ""),
      applyUrl: j.url ?? j.apply_url ?? "",
      sourceUrl: j.url ?? "",
      postedAt: date(j.date),
      salaryMin: j.salary_min || null,
      salaryMax: j.salary_max || null,
      salaryCurrency: j.salary_min ? "USD" : null,
    }));
}

// ---------- Arbeitnow ----------
export async function fetchArbeitnow(pages = 1): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let p = 1; p <= pages; p++) {
    const data = await getJson<{ data: { slug: string; company_name: string; title: string; description: string; remote: boolean; url: string; job_types?: string[]; location: string; created_at: number }[] }>(
      `https://www.arbeitnow.com/api/job-board-api?page=${p}`,
    );
    out.push(
      ...data.data.map((j) => ({
        source: "arbeitnow",
        externalId: j.slug,
        title: j.title,
        company: j.company_name,
        location: `${j.location}${j.remote ? " (Remote)" : ""}`,
        description: stripHtml(j.description),
        applyUrl: j.url,
        sourceUrl: j.url,
        postedAt: date(j.created_at),
        employmentType: j.job_types?.[0] ?? null,
      })),
    );
  }
  return out;
}

// ---------- Adzuna (optional; key in .env) ----------
export function adzunaConfigured() {
  return !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
}
export async function fetchAdzuna(what: string, country = "gb"): Promise<RawJob[]> {
  if (!adzunaConfigured()) throw new Error("Adzuna isn't configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.");
  const q = new URLSearchParams({ app_id: process.env.ADZUNA_APP_ID!, app_key: process.env.ADZUNA_APP_KEY!, what, results_per_page: "50", "content-type": "application/json" });
  const data = await getJson<{ results: { id: string; title: string; description: string; redirect_url: string; company?: { display_name?: string }; location?: { display_name?: string }; created?: string; salary_min?: number; salary_max?: number; contract_time?: string }[] }>(
    `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country.toLowerCase())}/search/1?${q}`,
  );
  return data.results.map((j) => ({
    source: "adzuna",
    externalId: j.id,
    title: stripHtml(j.title),
    company: j.company?.display_name ?? "Unknown",
    location: j.location?.display_name ?? "",
    description: stripHtml(j.description),
    applyUrl: j.redirect_url,
    sourceUrl: j.redirect_url,
    postedAt: date(j.created),
    salaryMin: j.salary_min ? Math.round(j.salary_min) : null,
    salaryMax: j.salary_max ? Math.round(j.salary_max) : null,
    employmentType: j.contract_time?.replace("_", "-") ?? null,
  }));
}

// ---------- Pasted URL ----------
const BLOCKED_HOSTS = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|ziprecruiter\.com|monster\.[a-z.]+|naukri\.com|seek\.com\.au)$/i;

export class BlockedSiteError extends Error {}

async function robotsAllows(u: URL): Promise<boolean> {
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return true;
    const txt = await res.text();
    let applies = false;
    const disallows: string[] = [];
    for (const line of txt.split(/\r?\n/)) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k.trim())) applies = v === "*";
      else if (applies && /^disallow$/i.test(k.trim()) && v) disallows.push(v);
    }
    return !disallows.some((d) => {
      const prefix = d.replace(/\*.*$/, "");
      return prefix === "/" || (prefix.length > 0 && u.pathname.startsWith(prefix));
    });
  } catch {
    return true;
  }
}

/** Fetch ONE job posting from a URL the user pasted. */
export async function fetchJobFromUrl(url: string): Promise<RawJob> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are supported.");
  if (BLOCKED_HOSTS.test(u.hostname)) {
    throw new BlockedSiteError(
      `${u.hostname} doesn't allow automated access, so Upvance won't fetch it. Open the job in Chrome and click the Upvance extension, or paste the job description text instead.`,
    );
  }
  const board = boardFromUrl(u.toString());
  if (board?.jobId) {
    if (board.ats === "greenhouse") return fetchGreenhouseJob(board.slug, board.jobId);
    if (board.ats === "lever") return fetchLeverJob(board.slug, board.jobId);
    if (board.ats === "gem") return fetchGemJob(board.slug, board.jobId);
    if (board.ats === "workable") return fetchWorkableJob(board.slug, board.jobId);
    if (board.ats === "smartrecruiters") return fetchSmartRecruitersJob(board.slug, board.jobId);
    if (board.ats === "workday") return fetchWorkdayJob(board.slug, board.jobId);
    if (board.ats === "ashby" || board.ats === "personio") {
      const all = await fetchBoard(board.ats, board.slug);
      const hit = all.find((j) => j.externalId.endsWith(`:${board.jobId}`));
      if (hit) return hit;
    }
  }
  if (/(^|\.)ycombinator\.com$/i.test(u.hostname) && /^\/companies\/[^/]+\/jobs\//.test(u.pathname)) {
    const yc = await import("./remote-boards");
    return yc.onEmployerBoard(await yc.fetchYcJob(u.toString()));
  }
  if (!(await robotsAllows(u))) throw new BlockedSiteError(`${u.hostname}'s robots.txt disallows automated access to this page. Use the browser extension or paste the description text.`);
  const res = await fetch(u, { headers: { ...HEADERS, accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  const html = await res.text();
  const parsed = parseJobHtml(html, res.url || u.toString());
  if (/(^|\.)weworkremotely\.com$/i.test(u.hostname)) {
    // WWR hides the apply link from tools – use the employer's own posting when we can find it
    const { onEmployerBoard } = await import("./remote-boards");
    return onEmployerBoard({ ...parsed, source: "weworkremotely", atsType: "weworkremotely" });
  }
  return parsed;
}

/** Extract a job from HTML: JSON-LD JobPosting first, then page text. */
export function parseJobHtml(html: string, url: string): RawJob {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items: Record<string, unknown>[] = (Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed]) as Record<string, unknown>[];
      const jp = items.find((i) => i && (i["@type"] === "JobPosting" || (Array.isArray(i["@type"]) && (i["@type"] as string[]).includes("JobPosting"))));
      if (jp) {
        const org = jp.hiringOrganization as { name?: string } | undefined;
        const locs = ([] as unknown[]).concat(jp.jobLocation ?? []) as { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } }[];
        const loc = locs
          .map((l) => [l.address?.addressLocality, l.address?.addressRegion, typeof l.address?.addressCountry === "string" ? l.address?.addressCountry : l.address?.addressCountry?.name].filter(Boolean).join(", "))
          .filter(Boolean)
          .join("; ");
        const remote = jp.jobLocationType === "TELECOMMUTE";
        const reqs = ([] as unknown[]).concat(jp.applicantLocationRequirements ?? []) as { name?: string }[];
        const salary = jp.baseSalary as { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number } } | undefined;
        return {
          source: "url",
          externalId: url,
          title: String(jp.title ?? "Untitled role"),
          company: org?.name ?? new URL(url).hostname.replace(/^www\./, ""),
          location: [remote ? "Remote" : "", reqs.map((r) => r.name).filter(Boolean).join("/"), loc].filter(Boolean).join(" – "),
          description: stripHtml(String(jp.description ?? "")),
          applyUrl: (jp.url as string) || url,
          sourceUrl: url,
          postedAt: date(jp.datePosted),
          employmentType: Array.isArray(jp.employmentType) ? String(jp.employmentType[0]) : (jp.employmentType as string) ?? null,
          salaryMin: salary?.value?.minValue ?? salary?.value?.value ?? null,
          salaryMax: salary?.value?.maxValue ?? null,
          salaryCurrency: salary?.currency ?? null,
          atsType: detectAts(url),
        };
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  const title = decodeEntities(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "Untitled role").trim();
  const siteName = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i)?.[1];
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const text = stripHtml(main.replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " "));
  if (text.length < 200) throw new Error("Couldn't read a job description from that page (it may need JavaScript). Paste the description text instead.");
  return {
    source: "url",
    externalId: url,
    title: title.split(/ [|–-] /)[0].slice(0, 150),
    company: siteName ?? new URL(url).hostname.replace(/^www\./, "").split(".")[0],
    location: "",
    description: text.slice(0, 20000),
    applyUrl: url,
    sourceUrl: url,
    postedAt: null,
    atsType: detectAts(url),
  };
}

// ---------- Aggregators: multi-country Adzuna + Google Jobs (SerpApi) ----------
const ADZUNA_COUNTRIES = ["gb", "us", "de", "nl", "ca", "au", "in", "fr", "es", "it", "pl", "at", "ch", "be", "nz", "sg", "za", "br", "mx"];

/** Adzuna across several countries (only those it supports). */
export async function fetchAdzunaMulti(what: string, countryCodes: string[]): Promise<RawJob[]> {
  const codes = countryCodes.map((c) => (c.toUpperCase() === "GB" ? "gb" : c.toLowerCase())).filter((c) => ADZUNA_COUNTRIES.includes(c));
  const out: RawJob[] = [];
  for (const c of codes.length ? codes : ["gb", "us"]) {
    try {
      out.push(...(await fetchAdzuna(what, c)));
    } catch {
      /* one country failing shouldn't stop the rest */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

export function googleJobsConfigured() {
  return !!process.env.SERPAPI_KEY;
}

/** Google Jobs results via SerpApi (optional SERPAPI_KEY in .env). */
export async function fetchGoogleJobs(q: string, location?: string): Promise<RawJob[]> {
  if (!googleJobsConfigured()) throw new Error("Google Jobs needs SERPAPI_KEY in .env (serpapi.com).");
  const params = new URLSearchParams({ engine: "google_jobs", q, api_key: process.env.SERPAPI_KEY!, hl: "en" });
  if (location) params.set("location", location);
  const data = await getJson<{ jobs_results?: { title: string; company_name: string; location?: string; description?: string; job_id: string; share_link?: string; detected_extensions?: { posted_at?: string; schedule_type?: string }; apply_options?: { title: string; link: string }[] }[] }>(`https://serpapi.com/search.json?${params}`);
  return (data.jobs_results ?? []).map((j) => {
    const links = (j.apply_options ?? []).map((o) => o.link);
    const employer = links.find((l) => detectAts(l) !== "unknown" && !["linkedin", "indeed"].includes(detectAts(l))) ?? links.find((l) => !/linkedin|indeed|glassdoor|ziprecruiter/i.test(l)) ?? links[0] ?? j.share_link ?? "";
    return {
      source: "googlejobs",
      externalId: j.job_id.slice(0, 180),
      title: j.title,
      company: j.company_name,
      location: j.location ?? "",
      description: j.description ?? "",
      applyUrl: employer,
      sourceUrl: j.share_link ?? employer,
      postedAt: null,
      employmentType: j.detected_extensions?.schedule_type ?? null,
      atsType: detectAts(employer),
    };
  });
}

const ATS_LINK = /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/[^\s"'<>)]+|https?:\/\/jobs\.lever\.co\/[^\s"'<>)]+|https?:\/\/jobs\.ashbyhq\.com\/[^\s"'<>)]+|https?:\/\/jobs\.gem\.com\/[^\s"'<>)]+|https?:\/\/apply\.workable\.com\/[^\s"'<>)]+|https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/[^\s"'<>)]+|https?:\/\/jobs\.smartrecruiters\.com\/[^\s"'<>)]+/i;

/**
 * Point aggregator jobs at the employer's original apply page:
 * an ATS link in the description, or where an aggregator redirect lands.
 */
export async function resolveApplyUrl(job: RawJob): Promise<RawJob> {
  if (detectAts(job.applyUrl) !== "unknown" && !["linkedin", "indeed"].includes(detectAts(job.applyUrl))) return job;
  const inText = job.description.match(ATS_LINK)?.[0];
  if (inText) return { ...job, applyUrl: inText.replace(/[.,;]+$/, ""), atsType: detectAts(inText) };
  if (job.source !== "adzuna") return job;
  try {
    let url = job.applyUrl;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, { method: "GET", redirect: "manual", headers: HEADERS, signal: AbortSignal.timeout(8000) });
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) break;
      url = new URL(loc, url).toString();
      if (!/adzuna\./i.test(url)) break;
    }
    if (!/adzuna\./i.test(url)) return { ...job, applyUrl: url, atsType: detectAts(url) };
  } catch {
    /* keep aggregator link */
  }
  return job;
}
