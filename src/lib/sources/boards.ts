/**
 * Public job-board connectors (Phase 4). Each uses only the public endpoint the
 * board page itself loads its jobs from – see docs/connectors.md for how each
 * endpoint was found and its response shape. Read-only, rate-limited.
 */
import { stripHtml, decodeEntities } from "../text";
import type { RawJob } from "./index";

const UA = "UpvanceLocal/1.0 (personal job-search assistant)";
const MAX_PER_BOARD = Number(process.env.BOARD_MAX_JOBS) || 150;

export class BoardNotFound extends Error {}

async function http(url: string, init: RequestInit & { accept?: string } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: init.accept ?? "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
    redirect: "follow",
  });
  if (res.status === 404 || res.status === 410) throw new BoardNotFound(`No board at ${new URL(url).hostname}`);
  if (res.status === 429) throw new Error(`Rate limited by ${new URL(url).hostname} – try again later`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res;
}
const getJson = async <T>(url: string, init?: RequestInit) => (await http(url, init)).json() as Promise<T>;
const getText = async (url: string, accept = "text/html") => (await http(url, { accept })).text();

/** Run async work with a small concurrency limit and a polite pause between calls. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>, pauseMs = 150): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
        if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      }
    }),
  );
  return out;
}

const date = (v: unknown) => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
const ISO3: Record<string, string> = { USA: "United States", GBR: "United Kingdom", DEU: "Germany", NLD: "Netherlands", CAN: "Canada", IND: "India", IRL: "Ireland", FRA: "France", ESP: "Spain", AUS: "Australia", ARE: "United Arab Emirates", SGP: "Singapore", POL: "Poland", PRT: "Portugal", CHE: "Switzerland", SWE: "Sweden", ITA: "Italy", BRA: "Brazil", MEX: "Mexico", JPN: "Japan" };
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------- Gem
const GEM_GQL = "https://jobs.gem.com/api/public/graphql/batch";
const GEM_LIST = `query JobBoardList($boardId: String!) {
  oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { name city isoCountry isRemote } job { department { name } locationType employmentType } } }
  jobBoardExternal(vanityUrlPath: $boardId) { teamDisplayName pageTitle }
}`;
const GEM_DETAIL = `query ExternalJobPosting($boardId: String!, $extId: String!) {
  oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
    title descriptionHtml extId firstPublishedTsSec companyUrl
    locations { name city isoCountry isRemote }
    job { locationType employmentType teamDisplayName department { name } }
    jobPostSectionHtml { introHtml outroHtml }
    compensationHtml
  }
}`;
type GemLoc = { name: string; city?: string; isoCountry?: string; isRemote?: boolean };
async function gemQuery<T>(operationName: string, query: string, variables: Record<string, string>): Promise<T> {
  const r = await getJson<{ data?: T; errors?: { message: string }[] }[]>(GEM_GQL, { method: "POST", body: JSON.stringify([{ operationName, query, variables }]) });
  if (r[0]?.errors?.length) throw new BoardNotFound(r[0].errors[0].message);
  return r[0].data as T;
}
function gemLocation(locs: GemLoc[], locationType?: string) {
  const names = locs.map((l) => (l.isRemote ? `Remote – ${ISO3[l.isoCountry ?? ""] ?? l.isoCountry ?? ""}` : `${l.name}${l.isoCountry ? `, ${ISO3[l.isoCountry] ?? l.isoCountry}` : ""}`));
  const mode = locationType === "HYBRID" ? " (Hybrid)" : locationType === "REMOTE" ? " (Remote)" : "";
  return names.join("; ") + mode;
}
export async function fetchGemJob(board: string, extId: string, companyName?: string): Promise<RawJob> {
  const d = await gemQuery<{ oatsExternalJobPosting: { title: string; descriptionHtml: string; extId: string; firstPublishedTsSec?: number; companyUrl?: string; locations: GemLoc[]; job: { locationType?: string; employmentType?: string; teamDisplayName?: string }; jobPostSectionHtml?: { introHtml?: string; outroHtml?: string }; compensationHtml?: string } | null }>(
    "ExternalJobPosting",
    GEM_DETAIL,
    { boardId: board, extId },
  );
  const p = d.oatsExternalJobPosting;
  if (!p) throw new BoardNotFound("Gem job not found");
  const url = `https://jobs.gem.com/${board}/${extId}`;
  return {
    source: "gem",
    externalId: `${board}:${extId}`,
    title: p.title,
    company: companyName ?? p.job.teamDisplayName ?? titleCase(board),
    location: gemLocation(p.locations ?? [], p.job.locationType),
    description: stripHtml([p.jobPostSectionHtml?.introHtml, p.descriptionHtml, p.compensationHtml, p.jobPostSectionHtml?.outroHtml].filter(Boolean).join("\n")),
    applyUrl: url,
    sourceUrl: url,
    postedAt: date(p.firstPublishedTsSec),
    employmentType: p.job.employmentType?.toLowerCase().replace("_", "-") ?? null,
    boardSlug: board,
    atsType: "gem",
  };
}
export async function fetchGem(board: string): Promise<RawJob[]> {
  const d = await gemQuery<{ oatsExternalJobPostings: { jobPostings: { extId: string; title: string }[] } | null; jobBoardExternal: { teamDisplayName?: string } | null }>("JobBoardList", GEM_LIST, { boardId: board });
  if (!d.oatsExternalJobPostings) throw new BoardNotFound(`No Gem board “${board}”`);
  const name = d.jobBoardExternal?.teamDisplayName ?? titleCase(board);
  const posts = d.oatsExternalJobPostings.jobPostings.slice(0, MAX_PER_BOARD);
  return mapLimit(posts, 3, (p) => fetchGemJob(board, p.extId, name));
}

// ---------------------------------------------------------------- Workable
type WorkableJob = { shortcode: string; title: string; employment_type?: string; telecommuting?: boolean; city?: string; country?: string; locations?: { city?: string; country?: string }[]; description?: string; requirements?: string; benefits?: string; published_on?: string; created_at?: string; url?: string; application_url?: string };
export async function fetchWorkable(slug: string): Promise<RawJob[]> {
  const d = await getJson<{ name?: string; jobs?: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);
  if (!d.jobs) throw new BoardNotFound(`No Workable account “${slug}”`);
  return d.jobs.slice(0, MAX_PER_BOARD).map((j) => {
    const locs = (j.locations?.length ? j.locations : [{ city: j.city, country: j.country }]).map((l) => [l.city, l.country].filter(Boolean).join(", ")).filter(Boolean);
    const url = `https://apply.workable.com/${slug}/j/${j.shortcode}/`;
    return {
      source: "workable",
      externalId: `${slug}:${j.shortcode}`,
      title: j.title,
      company: d.name ?? titleCase(slug),
      location: locs.join("; ") + (j.telecommuting ? " (Remote)" : ""),
      description: stripHtml([j.description, j.requirements, j.benefits].filter(Boolean).join("\n")),
      applyUrl: url,
      sourceUrl: url,
      postedAt: date(j.published_on ?? j.created_at),
      employmentType: j.employment_type ?? null,
      boardSlug: slug,
      atsType: "workable",
    };
  });
}
export async function fetchWorkableJob(slug: string, shortcode: string): Promise<RawJob> {
  const all = await fetchWorkable(slug);
  const hit = all.find((j) => j.externalId === `${slug}:${shortcode}`);
  if (!hit) throw new BoardNotFound("Workable job not found");
  return hit;
}

// ---------------------------------------------------------------- SmartRecruiters (official public Posting API)
type SrPosting = { id: string; name: string; releasedDate?: string; location?: { city?: string; country?: string; remote?: boolean; fullLocation?: string }; typeOfEmployment?: { label?: string }; company?: { name?: string }; ref?: string };
type SrDetail = SrPosting & { jobAd?: { sections?: Record<string, { title?: string; text?: string }> }; applyUrl?: string; postingUrl?: string };
export async function fetchSmartRecruitersJob(company: string, id: string): Promise<RawJob> {
  const p = await getJson<SrDetail>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`);
  const sections = Object.values(p.jobAd?.sections ?? {}).map((s) => `${s.title ?? ""}\n${s.text ?? ""}`).join("\n\n");
  const url = p.postingUrl ?? `https://jobs.smartrecruiters.com/${company}/${id}`;
  return {
    source: "smartrecruiters",
    externalId: `${company}:${id}`,
    title: p.name,
    company: p.company?.name ?? company,
    location: (p.location?.fullLocation ?? [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(", ")) + (p.location?.remote ? " (Remote)" : ""),
    description: stripHtml(sections),
    applyUrl: p.applyUrl ?? url,
    sourceUrl: url,
    postedAt: date(p.releasedDate),
    employmentType: p.typeOfEmployment?.label ?? null,
    boardSlug: company,
    atsType: "smartrecruiters",
  };
}
export async function fetchSmartRecruiters(company: string): Promise<RawJob[]> {
  const d = await getJson<{ totalFound: number; content: SrPosting[] }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`);
  if (!d.totalFound) throw new BoardNotFound(`No SmartRecruiters jobs for “${company}”`);
  return mapLimit(d.content.slice(0, MAX_PER_BOARD), 4, (p) => fetchSmartRecruitersJob(company, p.id));
}

// ---------------------------------------------------------------- Recruitee (public offers API)
type RecruiteeOffer = { id: number; slug: string; title: string; description?: string; requirements?: string; location?: string; city?: string; country?: string; remote?: boolean; careers_url?: string; careers_apply_url?: string; published_at?: string; employment_type_code?: string; company_name?: string };
export async function fetchRecruitee(slug: string): Promise<RawJob[]> {
  const d = await getJson<{ offers: RecruiteeOffer[] }>(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`);
  if (!d.offers) throw new BoardNotFound("No Recruitee board");
  return d.offers.slice(0, MAX_PER_BOARD).map((o) => ({
    source: "recruitee",
    externalId: `${slug}:${o.id}`,
    title: o.title,
    company: o.company_name ?? titleCase(slug),
    location: (o.location || [o.city, o.country].filter(Boolean).join(", ")) + (o.remote ? " (Remote)" : ""),
    description: stripHtml(`${o.description ?? ""}\n${o.requirements ?? ""}`),
    applyUrl: o.careers_apply_url ?? o.careers_url ?? `https://${slug}.recruitee.com/o/${o.slug}`,
    sourceUrl: o.careers_url ?? `https://${slug}.recruitee.com/o/${o.slug}`,
    postedAt: date(o.published_at),
    employmentType: o.employment_type_code?.replace(/_/g, "-") ?? null,
    boardSlug: slug,
    atsType: "recruitee",
  }));
}

// ---------------------------------------------------------------- Personio (official XML feed)
const xmlTag = (block: string, tag: string) =>
  decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() ?? "");
export function parsePersonioXml(xml: string, slug: string, host = "jobs.personio.de"): RawJob[] {
  const positions = xml.match(/<position>[\s\S]*?<\/position>/g) ?? [];
  return positions.slice(0, MAX_PER_BOARD).map((p) => {
    const id = xmlTag(p, "id");
    const descriptions = (p.match(/<jobDescription>[\s\S]*?<\/jobDescription>/g) ?? []).map((d) => `${xmlTag(d, "name")}\n${stripHtml(xmlTag(d, "value"))}`).join("\n\n");
    const url = `https://${slug}.${host}/job/${id}`;
    return {
      source: "personio",
      externalId: `${slug}:${id}`,
      title: xmlTag(p, "name"),
      company: xmlTag(p, "subcompany") || titleCase(slug),
      location: xmlTag(p, "office"),
      description: descriptions,
      applyUrl: url,
      sourceUrl: url,
      postedAt: date(xmlTag(p, "createdAt")),
      employmentType: xmlTag(p, "employmentType") || xmlTag(p, "schedule") || null,
      boardSlug: slug,
      atsType: "personio",
    };
  });
}
export async function fetchPersonio(slug: string): Promise<RawJob[]> {
  for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
    try {
      const xml = await getText(`https://${encodeURIComponent(slug)}.${host}/xml`, "application/xml");
      if (xml.includes("<workzag-jobs")) {
        const jobs = parsePersonioXml(xml, slug, host);
        // Some boards leave descriptions out of the feed – read the public job page instead
        const { parseJobHtml } = await import("./index");
        return mapLimit(jobs, 3, async (j) => {
          if (j.description) return j;
          try {
            return { ...j, description: parseJobHtml(await getText(j.sourceUrl), j.sourceUrl).description };
          } catch {
            return j;
          }
        });
      }
    } catch (e) {
      if (!(e instanceof BoardNotFound)) throw e;
    }
  }
  throw new BoardNotFound("No Personio board");
}

// ---------------------------------------------------------------- Teamtailor (public RSS feed)
export function parseTeamtailorRss(xml: string, base: string, slug: string): RawJob[] {
  const company = xmlTag(xml.match(/<channel>[\s\S]*?<item>/)?.[0] ?? "", "title");
  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, MAX_PER_BOARD).map((it) => {
    const link = xmlTag(it, "link");
    const locs = (it.match(/<tt:location>[\s\S]*?<\/tt:location>/g) ?? []).map((l) => [xmlTag(l, "tt:city"), xmlTag(l, "tt:country")].filter(Boolean).join(", "));
    const remote = xmlTag(it, "remoteStatus") || xmlTag(it, "tt:remoteStatus");
    return {
      source: "teamtailor",
      externalId: `${slug}:${xmlTag(it, "guid") || link}`,
      title: xmlTag(it, "title"),
      company: company || titleCase(slug),
      location: locs.join("; ") + (/fully|remote/i.test(remote) ? " (Remote)" : /hybrid/i.test(remote) ? " (Hybrid)" : ""),
      description: stripHtml(xmlTag(it, "description")),
      applyUrl: link,
      sourceUrl: link,
      postedAt: date(xmlTag(it, "pubDate")),
      boardSlug: slug,
      atsType: "teamtailor",
    };
  });
}
export async function fetchTeamtailor(slugOrHost: string): Promise<RawJob[]> {
  const host = slugOrHost.includes(".") ? slugOrHost : `${slugOrHost}.teamtailor.com`;
  const xml = await getText(`https://${host}/jobs.rss`, "application/rss+xml");
  if (!xml.includes("<rss")) throw new BoardNotFound("No Teamtailor feed");
  return parseTeamtailorRss(xml, `https://${host}`, slugOrHost);
}

// ---------------------------------------------------------------- BambooHR (careers JSON)
type BambooItem = { id: string; jobOpeningName: string; departmentLabel?: string; employmentStatusLabel?: string; location?: { city?: string; state?: string }; atsLocation?: { country?: string; city?: string }; isRemote?: boolean | null; locationType?: string };
export async function fetchBambooHR(slug: string): Promise<RawJob[]> {
  const res = await http(`https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`);
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new BoardNotFound("No BambooHR careers site");
  const d = (await res.json()) as { result?: BambooItem[] };
  const items = (d.result ?? []).slice(0, MAX_PER_BOARD);
  return mapLimit(items, 3, async (j) => {
    let description = "";
    try {
      const det = await getJson<{ result?: { jobOpening?: { description?: string } } }>(`https://${slug}.bamboohr.com/careers/${j.id}/detail`);
      description = stripHtml(det.result?.jobOpening?.description ?? "");
    } catch {
      /* description optional */
    }
    const url = `https://${slug}.bamboohr.com/careers/${j.id}`;
    return {
      source: "bamboohr",
      externalId: `${slug}:${j.id}`,
      title: j.jobOpeningName,
      company: titleCase(slug),
      location: [j.location?.city ?? j.atsLocation?.city, j.location?.state, j.atsLocation?.country].filter(Boolean).join(", ") + (j.isRemote || j.locationType === "1" ? " (Remote)" : ""),
      description,
      applyUrl: url,
      sourceUrl: url,
      postedAt: null,
      employmentType: j.employmentStatusLabel ?? null,
      boardSlug: slug,
      atsType: "bamboohr",
    };
  });
}

// ---------------------------------------------------------------- Breezy HR (public JSON)
type BreezyJob = { id: string; friendly_id: string; name: string; url: string; published_date?: string; type?: { name?: string }; location?: { name?: string; city?: string; country?: { name?: string }; is_remote?: boolean }; company?: { name?: string } };
export async function fetchBreezy(slug: string): Promise<RawJob[]> {
  const list = await getJson<BreezyJob[]>(`https://${encodeURIComponent(slug)}.breezy.hr/json`);
  if (!Array.isArray(list)) throw new BoardNotFound("No Breezy board");
  const { parseJobHtml } = await import("./index");
  return mapLimit(list.slice(0, MAX_PER_BOARD), 3, async (j) => {
    let description = "";
    try {
      description = parseJobHtml(await getText(j.url), j.url).description;
    } catch {
      /* optional */
    }
    return {
      source: "breezy",
      externalId: `${slug}:${j.id}`,
      title: j.name,
      company: j.company?.name ?? titleCase(slug),
      location: (j.location?.name ?? [j.location?.city, j.location?.country?.name].filter(Boolean).join(", ")) + (j.location?.is_remote ? " (Remote)" : ""),
      description,
      applyUrl: j.url,
      sourceUrl: j.url,
      postedAt: date(j.published_date),
      employmentType: j.type?.name ?? null,
      boardSlug: slug,
      atsType: "breezy",
    };
  });
}

// ---------------------------------------------------------------- JazzHR (applytojob.com career pages)
export async function fetchJazzHR(slug: string): Promise<RawJob[]> {
  const base = `https://${encodeURIComponent(slug)}.applytojob.com`;
  const html = await getText(`${base}/apply`);
  if (/Inactive Career Page/i.test(html)) throw new BoardNotFound("JazzHR page inactive");
  const links = Array.from(new Set([...html.matchAll(/href="((?:https:\/\/[^"]+\.applytojob\.com)?\/apply\/[A-Za-z0-9]{6,}\/[^"#?]*)"/g)].map((m) => (m[1].startsWith("http") ? m[1] : base + m[1]))));
  if (!links.length) throw new BoardNotFound("No JazzHR jobs");
  const { parseJobHtml } = await import("./index");
  return mapLimit(links.slice(0, MAX_PER_BOARD), 3, async (url) => {
    const j = parseJobHtml(await getText(url), url);
    return { ...j, source: "jazzhr", externalId: `${slug}:${url.split("/apply/")[1]?.split("/")[0]}`, company: j.company.includes("applytojob") ? titleCase(slug) : j.company, boardSlug: slug, atsType: "jazzhr" };
  });
}

// ---------------------------------------------------------------- Workday (cxs JSON used by career sites)
export function workdayParts(input: string): { tenant: string; wd: string; site: string } | null {
  const m = input.match(/^([^|]+)\|([^|]+)\|([^|]+)$/);
  if (m) return { tenant: m[1], wd: m[2], site: m[3] };
  try {
    const u = new URL(input);
    const hm = u.hostname.match(/^([^.]+)\.(wd\d+)\.myworkday(?:jobs|site)\.com$/);
    if (!hm) return null;
    const parts = u.pathname.split("/").filter(Boolean).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
    const site = parts[0] === "recruiting" ? parts[2] : parts[0];
    return site ? { tenant: hm[1], wd: hm[2], site } : null;
  } catch {
    return null;
  }
}
type WdPosting = { title: string; externalPath: string; locationsText?: string; postedOn?: string };
type WdDetail = { jobPostingInfo: { id: string; title: string; jobDescription?: string; location?: string; additionalLocations?: string[]; timeType?: string; startDate?: string; externalUrl?: string; country?: { descriptor?: string }; remoteType?: string }; hiringOrganization?: { name?: string } };
export async function fetchWorkdayJob(slug: string, externalPath: string): Promise<RawJob> {
  const p = workdayParts(slug)!;
  const base = `https://${p.tenant}.${p.wd}.myworkdayjobs.com`;
  const d = await getJson<WdDetail>(`${base}/wday/cxs/${p.tenant}/${p.site}${externalPath}`);
  const i = d.jobPostingInfo;
  const url = i.externalUrl ?? `${base}/${p.site}${externalPath}`;
  return {
    source: "workday",
    externalId: `${p.tenant}:${i.id}`,
    title: i.title,
    company: titleCase(p.tenant), // hiringOrganization is often a legal entity such as "2100 NVIDIA USA"
    location: [i.location, ...(i.additionalLocations ?? [])].filter(Boolean).join("; ") + (i.country?.descriptor ? `, ${i.country.descriptor}` : "") + (i.remoteType ? ` (${i.remoteType})` : ""),
    description: stripHtml(i.jobDescription ?? ""),
    applyUrl: url,
    sourceUrl: url,
    postedAt: date(i.startDate),
    employmentType: i.timeType ?? null,
    boardSlug: `${p.tenant}|${p.wd}|${p.site}`,
    atsType: "workday",
  };
}
export async function fetchWorkday(slug: string): Promise<RawJob[]> {
  const p = workdayParts(slug);
  if (!p) throw new BoardNotFound("Workday boards need the career-site URL (https://<company>.wdN.myworkdayjobs.com/<site>)");
  const base = `https://${p.tenant}.${p.wd}.myworkdayjobs.com/wday/cxs/${p.tenant}/${p.site}/jobs`;
  const postings: WdPosting[] = [];
  for (let offset = 0; offset < MAX_PER_BOARD; offset += 20) {
    const d = await getJson<{ total: number; jobPostings: WdPosting[] }>(base, { method: "POST", body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }) });
    postings.push(...d.jobPostings);
    if (d.jobPostings.length < 20 || postings.length >= d.total) break;
  }
  return mapLimit(postings.slice(0, MAX_PER_BOARD), 4, (j) => fetchWorkdayJob(slug, j.externalPath));
}

// ---------------------------------------------------------------- registry
export const BOARD_CONNECTORS = {
  gem: { label: "Gem", fetch: fetchGem },
  workable: { label: "Workable", fetch: fetchWorkable },
  smartrecruiters: { label: "SmartRecruiters", fetch: fetchSmartRecruiters },
  recruitee: { label: "Recruitee", fetch: fetchRecruitee },
  personio: { label: "Personio", fetch: fetchPersonio },
  teamtailor: { label: "Teamtailor", fetch: fetchTeamtailor },
  bamboohr: { label: "BambooHR", fetch: fetchBambooHR },
  breezy: { label: "Breezy HR", fetch: fetchBreezy },
  jazzhr: { label: "JazzHR", fetch: fetchJazzHR },
  workday: { label: "Workday", fetch: fetchWorkday },
} as const;
export type BoardKind = keyof typeof BOARD_CONNECTORS;
