/**
 * Company discovery: a directory of employers (seeded from the official sponsor
 * lists plus companies you add) and a background job that finds each one's
 * public job board. Rate-limited, resumable (state lives in the DB) and
 * prioritised by your target countries and roles.
 */
import { db } from "./db";
import { normalizeCompany, stripHtml } from "./text";
import { parseJson } from "./utils";
import { boardFromUrl, type BoardAts } from "./ats";
import { slugGuesses } from "./sources";
import { refreshCompanyBoard } from "./jobs/refresh";
import { upsertCompany } from "./jobs/ingest";
import { recomputeMatches } from "./matching";
import { setState } from "./tasks";
import { logActivity } from "./activity";

const LIST_COUNTRY: Record<string, string> = { UK: "GB", US: "US", NL: "NL", CA: "CA" };
const UA = { "user-agent": "UpvanceLocal/1.0 (personal job-search assistant)", accept: "application/json" };
const TECH_WORDS = /\b(tech|technolog|software|digital|data|analytics|ai|labs?|cloud|systems|robotics|cyber|fintech|computing|networks?|platforms?|automation|intelligence|semiconductor|bio|health)\b/i;

/** Real, public boards used to bootstrap the feed on the first discovery run (several countries). */
export const STARTER_BOARDS: { url: string; name: string }[] = [
  { url: "https://jobs.gem.com/nominal", name: "Nominal" },
  { url: "https://boards.greenhouse.io/gitlab", name: "GitLab" },
  { url: "https://apply.workable.com/huggingface/", name: "Hugging Face" },
  { url: "https://bunq.recruitee.com", name: "bunq" },
  { url: "https://personio.jobs.personio.de", name: "Personio" },
  { url: "https://career.teamtailor.com", name: "Teamtailor" },
  { url: "https://jobs.lever.co/palantir", name: "Palantir" },
  { url: "https://jobs.ashbyhq.com/ramp", name: "Ramp" },
];

// ----------------------------------------------------------------------------- directory
export async function seedDirectory(log: (s: string) => void = () => {}) {
  const existing = new Set((await db.directoryCompany.findMany({ select: { normalizedName: true } })).map((d) => d.normalizedName));
  const byName = new Map<string, { name: string; countries: Set<string>; sources: Set<string>; approvals: number }>();
  const BATCH = 20000;
  for (let skip = 0; ; skip += BATCH) {
    const rows = await db.sponsorRecord.findMany({ select: { name: true, normalizedName: true, listId: true, extra: true }, skip, take: BATCH, orderBy: { id: "asc" } });
    if (!rows.length) break;
    for (const r of rows) {
      if (!r.normalizedName || r.normalizedName.length < 2) continue;
      const e = byName.get(r.normalizedName) ?? { name: r.name, countries: new Set(), sources: new Set(), approvals: 0 };
      e.countries.add(LIST_COUNTRY[r.listId] ?? r.listId);
      e.sources.add(r.listId);
      e.approvals += Number(r.extra.match(/(\d+) approvals/)?.[1] ?? 0);
      byName.set(r.normalizedName, e);
    }
  }
  const fresh = Array.from(byName.entries()).filter(([n]) => !existing.has(n));
  for (let i = 0; i < fresh.length; i += 2000) {
    await db.directoryCompany.createMany({
      data: fresh.slice(i, i + 2000).map(([normalizedName, e]) => ({
        name: e.name.slice(0, 200),
        normalizedName,
        countries: JSON.stringify(Array.from(e.countries)),
        sources: JSON.stringify(Array.from(e.sources)),
        notes: e.approvals ? `${e.approvals} H-1B approvals` : null,
      })),
    });
  }
  log(`Directory: ${fresh.length} new employers added (${existing.size} already present).`);
  return fresh.length;
}

/** Re-rank pending companies: target countries first, larger sponsors, tech-sounding names for tech roles. */
export async function prioritiseDirectory(userId?: string) {
  const settings = userId ? await db.userSettings.findUnique({ where: { userId } }) : await db.userSettings.findFirst();
  const targets = new Set(parseJson<string[]>(settings?.targetCountries, []));
  const titles = parseJson<string[]>(settings?.targetTitles, []).join(" ");
  const techRoles = /engineer|developer|data|scien|ml|ai|software|product|devops|analyst/i.test(titles || "engineer");
  const pending = await db.directoryCompany.findMany({ where: { status: "pending" }, select: { id: true, name: true, countries: true, sources: true, notes: true, priority: true } });
  const updates: { id: string; priority: number }[] = [];
  for (const d of pending) {
    const countries = parseJson<string[]>(d.countries, []);
    let p = 0;
    if (!targets.size || countries.some((c) => targets.has(c))) p += 50;
    const approvals = Number(d.notes?.match(/(\d+)/)?.[1] ?? 0);
    p += approvals >= 5 && approvals <= 300 ? 15 : approvals > 300 ? 5 : 0; // mid-size sponsors are the most discoverable
    if (techRoles && TECH_WORDS.test(d.name)) p += 20;
    p += Math.min(10, (parseJson<string[]>(d.sources, []).length - 1) * 5); // sponsors in several countries
    if (p !== d.priority) updates.push({ id: d.id, priority: p });
  }
  for (let i = 0; i < updates.length; i += 500) {
    await db.$transaction(updates.slice(i, i + 500).map((u) => db.directoryCompany.update({ where: { id: u.id }, data: { priority: u.priority } })));
  }
  return updates.length;
}

/** Add (or update) a company you care about; with a website we also look for its careers link. */
export async function addDirectoryCompany(name: string, website?: string) {
  const normalizedName = normalizeCompany(name) || name.toLowerCase();
  return db.directoryCompany.upsert({
    where: { normalizedName },
    create: { name, normalizedName, website: website || null, sources: JSON.stringify(["you"]), priority: 100 },
    update: { website: website || undefined, priority: 100, status: "pending", attempts: 0 },
  });
}

// ----------------------------------------------------------------------------- probing (cheap list calls only)
async function json<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init?.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
async function text(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { ...UA, accept: "*/*" }, signal: AbortSignal.timeout(12_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export interface ProbeHit {
  ats: BoardAts;
  slug: string;
  jobs: number;
  displayName?: string;
}

export async function probeBoard(kind: BoardAts, slug: string): Promise<ProbeHit | null> {
  const s = encodeURIComponent(slug);
  switch (kind) {
    case "greenhouse": {
      const [board, d] = await Promise.all([json<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${s}`), json<{ jobs?: unknown[] }>(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`)]);
      return d?.jobs ? { ats: kind, slug, jobs: d.jobs.length, displayName: board?.name } : null;
    }
    case "lever": {
      const d = await json<unknown[]>(`https://api.lever.co/v0/postings/${s}?mode=json`);
      return Array.isArray(d) ? { ats: kind, slug, jobs: d.length } : null;
    }
    case "ashby": {
      const d = await json<{ jobs?: unknown[] }>(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
      return d?.jobs ? { ats: kind, slug, jobs: d.jobs.length } : null;
    }
    case "gem": {
      const d = await json<{ data?: { oatsExternalJobPostings?: { jobPostings: unknown[] } | null; jobBoardExternal?: { teamDisplayName?: string } | null } }[]>("https://jobs.gem.com/api/public/graphql/batch", {
        method: "POST",
        body: JSON.stringify([{ operationName: "JobBoardList", variables: { boardId: slug }, query: "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { extId } } jobBoardExternal(vanityUrlPath: $boardId) { teamDisplayName } }" }]),
      });
      const posts = d?.[0]?.data?.oatsExternalJobPostings?.jobPostings;
      return posts ? { ats: kind, slug, jobs: posts.length, displayName: d?.[0]?.data?.jobBoardExternal?.teamDisplayName } : null;
    }
    case "workable": {
      const d = await json<{ name?: string; jobs?: unknown[] }>(`https://apply.workable.com/api/v1/widget/accounts/${s}`);
      return d?.jobs ? { ats: kind, slug, jobs: d.jobs.length, displayName: d.name } : null;
    }
    case "smartrecruiters": {
      const d = await json<{ totalFound?: number; content?: { company?: { name?: string } }[] }>(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`);
      return d?.totalFound ? { ats: kind, slug, jobs: d.totalFound, displayName: d.content?.[0]?.company?.name } : null;
    }
    case "recruitee": {
      const d = await json<{ offers?: { company_name?: string }[] }>(`https://${s}.recruitee.com/api/offers/`);
      return d?.offers ? { ats: kind, slug, jobs: d.offers.length, displayName: d.offers[0]?.company_name } : null;
    }
    case "personio": {
      const x = await text(`https://${s}.jobs.personio.de/xml`);
      return x?.includes("<workzag-jobs") ? { ats: kind, slug, jobs: (x.match(/<position>/g) ?? []).length } : null;
    }
    case "teamtailor": {
      const x = await text(`https://${s}.teamtailor.com/jobs.rss`);
      return x?.includes("<rss") ? { ats: kind, slug: `${slug}.teamtailor.com`, jobs: (x.match(/<item>/g) ?? []).length, displayName: x.match(/<channel>\s*<title>([^<]+)/)?.[1] } : null;
    }
    case "breezy": {
      const d = await json<unknown[]>(`https://${s}.breezy.hr/json`);
      return Array.isArray(d) ? { ats: kind, slug, jobs: d.length } : null;
    }
    case "bamboohr": {
      const d = await json<{ result?: unknown[] }>(`https://${s}.bamboohr.com/careers/list`);
      return d?.result ? { ats: kind, slug, jobs: d.result.length } : null;
    }
    default:
      return null;
  }
}

/** Look for a careers page / ATS link on a company's homepage. */
export async function careersFromHomepage(website: string): Promise<{ url: string; board: ReturnType<typeof boardFromUrl> } | null> {
  const home = website.startsWith("http") ? website : `https://${website}`;
  const html = await text(home);
  if (!html) return null;
  const links = [...html.matchAll(/href="([^"#]+)"/gi)].map((m) => {
    try {
      return new URL(m[1], home).toString();
    } catch {
      return "";
    }
  });
  const ats = links.find((l) => boardFromUrl(l));
  if (ats) return { url: ats, board: boardFromUrl(ats) };
  const careers = links.find((l) => /\/(careers?|jobs|join(-us)?|work-with-us|vacancies)(\/|$)/i.test(new URL(l || home).pathname));
  if (!careers) return null;
  const page = await text(careers);
  const inner = page ? [...page.matchAll(/(?:href|src)="([^"]+)"/gi)].map((m) => m[1]).find((l) => /^https?:/.test(l) && boardFromUrl(l)) : null;
  return { url: inner ?? careers, board: inner ? boardFromUrl(inner) : null };
}

function confidenceFor(name: string, hit: ProbeHit): "high" | "medium" | "low" {
  const n = normalizeCompany(name);
  if (hit.displayName && normalizeCompany(hit.displayName) === n) return "high";
  if (hit.slug.toLowerCase().replace(/[^a-z0-9]/g, "") === n.replace(/[^a-z0-9]/g, "")) return hit.displayName ? "low" : "medium";
  return "low";
}

const PROBE_ORDER: BoardAts[] = ["greenhouse", "lever", "ashby", "workable", "gem", "smartrecruiters", "recruitee", "personio", "teamtailor", "breezy"];

const CORP_WORDS = /\b(inc|incorporated|llc|l\.?l\.?c|ltd|limited|plc|gmbh|ag|b\.?v|n\.?v|s\.?a|corp|corporation|co|company|group|holdings?|systems?|software|technolog(y|ies)|solutions|services|data|digital|global|international|americas?|usa|us|uk|europe|platforms?|networks?|labs?|the|of|and|a)\b\.?/gi;

/** "CISCO SYSTEMS INC" → "cisco", "Tech Mahindra Americas Inc" → "tech mahindra". */
export function coreName(name: string) {
  const core = name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(CORP_WORDS, " ").replace(/\s+/g, " ").trim();
  return core || normalizeCompany(name);
}

/** Find one directory company's board. */
export async function discoverOne(id: string) {
  const d = await db.directoryCompany.findUniqueOrThrow({ where: { id } });
  let hit: ProbeHit | null = null;
  let careersUrl: string | null = null;
  const core = coreName(d.name);
  const website = d.website ?? (core.split(" ").length <= 2 ? `https://www.${core.replace(/ /g, "")}.com` : null);
  // 1) homepage careers links (known website, or a guessed <name>.com)
  if (website) {
    const c = await careersFromHomepage(website);
    if (c) {
      careersUrl = c.url;
      if (c.board) hit = await probeBoard(c.board.ats, c.board.slug);
      if (hit) hit.displayName ??= d.name;
    }
  }
  // 2) known URL patterns (board slug guesses from the core name)
  if (!hit) {
    const guesses = Array.from(new Set([core.replace(/ /g, ""), core.replace(/ /g, "-"), ...slugGuesses(d.name)])).filter((g) => g.length >= 2).slice(0, 2);
    outer: for (const kind of PROBE_ORDER) {
      for (const g of guesses) {
        const h = await probeBoard(kind, g);
        if (h && h.jobs > 0) {
          hit = h;
          break outer;
        }
      }
    }
  }
  if (!hit) {
    await db.directoryCompany.update({
      where: { id },
      data: { status: "not-found", attempts: { increment: 1 }, lastCheckedAt: new Date(), careersUrl: d.website ? careersUrl : null, notes: d.website && careersUrl ? "Careers page found, but no supported public job board" : d.notes },
    });
    return null;
  }
  const confidence = d.website && careersUrl ? "high" : careersUrl ? "medium" : confidenceFor(d.name, hit);
  const company = await upsertCompany(d.name, { atsType: hit.ats, boardSlug: hit.slug });
  await db.company.update({ where: { id: company.id }, data: { careersUrl, discoveryConfidence: confidence, priority: d.priority } });
  await db.directoryCompany.update({
    where: { id },
    data: { status: "found", atsType: hit.ats, boardSlug: hit.slug, confidence, jobCount: hit.jobs, careersUrl, companyId: company.id, attempts: { increment: 1 }, lastCheckedAt: new Date() },
  });
  return { company, hit, confidence };
}

export interface DiscoveryRun {
  checked: number;
  found: number;
  jobsAdded: number;
  countries: number;
  log: string[];
}

/**
 * One discovery batch: bootstrap boards (first run), then the highest-priority
 * pending directory companies. Boards found with medium/high confidence are
 * pulled straight away. Safe to stop and resume at any time.
 */
export async function runDiscovery(opts: { batch?: number; pause?: number; log?: (s: string) => void; starter?: boolean } = {}): Promise<DiscoveryRun> {
  const log = (s: string) => {
    run.log.push(s);
    opts.log?.(s);
  };
  const run: DiscoveryRun = { checked: 0, found: 0, jobsAdded: 0, countries: 0, log: [] };
  if (!(await db.directoryCompany.count())) await seedDirectory(log);
  await prioritiseDirectory();

  const newJobIds: string[] = [];
  const firstRun = opts.starter ?? !(await db.systemState.findUnique({ where: { key: "discovery-starter-done" } }));
  if (firstRun) {
    for (const b of STARTER_BOARDS) {
      try {
        const board = boardFromUrl(b.url)!;
        const company = await upsertCompany(b.name, { atsType: board.ats, boardSlug: board.slug });
        await db.company.update({ where: { id: company.id }, data: { careersUrl: b.url, discoveryConfidence: "high", priority: 90 } });
        const r = await refreshCompanyBoard(company.id);
        newJobIds.push(...r.newJobIds);
        run.jobsAdded += r.created;
        log(`Starter board ${b.name} (${board.ats}): ${r.created} new jobs.`);
      } catch (e) {
        log(`Starter board ${b.name} failed: ${(e as Error).message}`);
      }
    }
    await setState("discovery-starter-done", new Date().toISOString());
  }

  const batch = await db.directoryCompany.findMany({ where: { status: "pending", attempts: { lt: 3 } }, orderBy: [{ priority: "desc" }, { name: "asc" }], take: opts.batch ?? 10 });
  for (const d of batch) {
    run.checked++;
    try {
      const r = await discoverOne(d.id);
      if (r) {
        run.found++;
        log(`Found ${d.name} on ${r.hit.ats} (“${r.hit.slug}”, ${r.hit.jobs} jobs, confidence ${r.confidence}).`);
        if (r.confidence !== "low") {
          const res = await refreshCompanyBoard(r.company.id);
          newJobIds.push(...res.newJobIds);
          run.jobsAdded += res.created;
        }
      }
    } catch (e) {
      await db.directoryCompany.update({ where: { id: d.id }, data: { status: "error", notes: (e as Error).message.slice(0, 200), attempts: { increment: 1 } } });
    }
    await new Promise((r) => setTimeout(r, opts.pause ?? 1500)); // be polite
  }

  if (newJobIds.length) for (const u of await db.user.findMany({ select: { id: true } })) await recomputeMatches(u.id, newJobIds);
  const jobs = await db.job.findMany({ where: { isActive: true, source: { notIn: ["demo", "demo-history"] } }, select: { remoteCountries: true, analysis: true } });
  const countries = new Set<string>();
  for (const j of jobs) for (const c of [...parseJson<string[]>(j.remoteCountries, []), ...(parseJson<{ locationCountries?: string[] }>(j.analysis, {}).locationCountries ?? [])]) countries.add(c);
  run.countries = countries.size;
  await setState("discovery-last-run", JSON.stringify({ at: new Date().toISOString(), ...run, log: run.log.slice(-20) }));
  await logActivity(null, "Company discovery run", `checked ${run.checked}, found ${run.found}, ${run.jobsAdded} new jobs, jobs from ${run.countries} countries`);
  return run;
}

export async function directoryStats() {
  const grouped = await db.directoryCompany.groupBy({ by: ["status"], _count: true });
  const recent = await db.directoryCompany.findMany({ where: { status: "found" }, orderBy: { lastCheckedAt: "desc" }, take: 12 });
  const last = await db.systemState.findUnique({ where: { key: "discovery-last-run" } });
  return { counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Record<string, number>, recent, last: last ? parseJson<DiscoveryRun & { at: string }>(last.value, null as never) : null };
}

/** Refresh discovered boards (medium/high confidence), most important first. */
export async function refreshDiscoveredBoards(limit = 25) {
  const companies = await db.company.findMany({
    where: { boardSlug: { not: null }, discoveryConfidence: { in: ["high", "medium"] }, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - 4 * 3_600_000) } }] },
    orderBy: [{ priority: "desc" }, { lastFetchedAt: "asc" }],
    take: limit,
  });
  const newJobIds: string[] = [];
  for (const c of companies) {
    try {
      newJobIds.push(...(await refreshCompanyBoard(c.id)).newJobIds);
    } catch {
      /* next time */
    }
  }
  if (newJobIds.length) for (const u of await db.user.findMany({ select: { id: true } })) await recomputeMatches(u.id, newJobIds);
  return { boards: companies.length, newJobIds };
}

export { stripHtml };
