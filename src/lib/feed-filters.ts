/** Feed filter types and URL (de)serialisation – safe to import in client components. */
export interface FeedFilters {
  q?: string;
  posted?: number; // days
  countries?: string[];
  workplace?: ("remote" | "hybrid" | "onsite")[];
  companies?: string[]; // normalized names
  degree?: "none" | "bachelor" | "master" | "phd"; // the highest degree you have
  maxExp?: number; // max years of experience a job may ask for
  sponsorship?: boolean; // only jobs that could sponsor a visa
  noClearance?: boolean;
  /** only jobs whose title fits your target roles (Settings). Default: on when you have target roles. */
  targetRoles?: boolean;
  fairPay?: boolean; // hide remote jobs with location-adjusted pay and jobs paying below your minimum
  roles?: string[]; // role families
  level?: string[]; // Intern | Junior | Mid | Senior | Lead...
  employment?: string[]; // full-time | part-time | contract | internship
  pay?: number; // minimum yearly pay (job's max >= pay)
  exclude?: string[];
  band?: string;
  eligibility?: "default" | "eligible" | "review" | "ineligible" | "all";
  sort?: "priority" | "score" | "date";
  source?: string;
  strict?: boolean;
  skipped?: boolean;
  saved?: boolean;
}

export const FILTER_KEYS: (keyof FeedFilters)[] = ["q", "posted", "countries", "workplace", "companies", "degree", "maxExp", "sponsorship", "noClearance", "fairPay", "targetRoles", "roles", "level", "employment", "pay", "exclude", "band", "eligibility", "sort", "source", "strict", "skipped", "saved"];
const LISTS = new Set(["countries", "workplace", "companies", "roles", "level", "employment", "exclude"]);
const NUMS = new Set(["posted", "maxExp", "pay"]);
const BOOLS = new Set(["sponsorship", "noClearance", "fairPay", "targetRoles", "strict", "skipped", "saved"]);

export function parseFilters(sp: Record<string, string | string[] | undefined>): FeedFilters {
  const f: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) {
    const raw = sp[k];
    const v = Array.isArray(raw) ? raw.join(",") : raw;
    if (v == null || v === "") continue;
    if (LISTS.has(k)) f[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
    else if (NUMS.has(k)) f[k] = Number(v) || undefined;
    else if (BOOLS.has(k)) f[k] = v === "1" || v === "true";
    else f[k] = v;
  }
  // backwards compatibility with phase-1 URLs
  if (typeof sp.country === "string" && sp.country) f.countries = [sp.country];
  if (typeof sp.remote === "string" && sp.remote) f.workplace = sp.remote === "remote" || sp.remote === "worldwide" ? ["remote"] : [sp.remote as "hybrid" | "onsite"];
  if (sp.sponsorship === "required") f.sponsorship = true;
  return f as FeedFilters;
}

export function filtersToQuery(f: FeedFilters): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (k === "targetRoles" && v === false) {
      p.set(k, "0"); // "off" has to be written down, because the default is on
      continue;
    }
    if (v == null || v === "" || (Array.isArray(v) && !v.length) || v === false) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v));
  }
  return p.toString();
}

export function describeFilters(f: FeedFilters): string {
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  if (f.countries?.length) parts.push(f.countries.join("/"));
  if (f.workplace?.length) parts.push(f.workplace.join("/"));
  if (f.sponsorship) parts.push("visa sponsorship");
  if (f.roles?.length) parts.push(f.roles.join("/"));
  if (f.level?.length) parts.push(f.level.join("/"));
  if (f.employment?.length) parts.push(f.employment.join("/"));
  if (f.companies?.length) parts.push(`${f.companies.length} compan${f.companies.length === 1 ? "y" : "ies"}`);
  if (f.posted) parts.push(`last ${f.posted}d`);
  if (f.maxExp != null) parts.push(`≤${f.maxExp} yrs exp`);
  if (f.pay) parts.push(`pay ≥ ${f.pay.toLocaleString("en-US")}`);
  if (f.noClearance) parts.push("no clearance");
  if (f.fairPay) parts.push("fair remote pay");
  if (f.targetRoles) parts.push("your target roles");
  if (f.band) parts.push(`${f.band}+`);
  if (f.exclude?.length) parts.push(`not ${f.exclude.join("/")}`);
  return parts.join(" · ") || "All jobs";
}

