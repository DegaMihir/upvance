/**
 * Check the job sites (Remotive, Remote OK, We Work Remotely, YC jobs) for your target roles,
 * swap each listing for the employer's own posting when it can be found, and import the result.
 * Runs every 6 hours from the worker, or from "Check job sites now" on Discover jobs.
 */
import { db } from "../db";
import { parseJson } from "../utils";
import { fetchRemoteOk, fetchRemotive, resolveApplyUrl, type RawJob } from "../sources";
import { mapLimit } from "../sources/boards";
import { clearBoardCache, fetchWeWorkRemotely, fetchYcJobs, onEmployerBoard, ycRolesFor } from "../sources/remote-boards";
import { ingestJobs } from "./ingest";
import { candidateFromProfile } from "../matching/candidate";

export const JOB_SITES = ["remotive", "remoteok", "weworkremotely", "ycombinator"] as const;
export type JobSite = (typeof JOB_SITES)[number];
export const JOB_SITE_LABEL: Record<JobSite, string> = { remotive: "Remotive", remoteok: "Remote OK", weworkremotely: "We Work Remotely", ycombinator: "Y Combinator jobs" };

export { fitsTargets, titleKeywords } from "../matching/titles";
import { fitsTargets, titleKeywords } from "../matching/titles";

export interface JobSitesRun {
  found: Record<string, number>;
  kept: number;
  onEmployerBoard: number;
  created: number;
  jobIds: string[];
  newJobIds: string[];
  errors: string[];
}

export async function checkJobSites(userId: string, opts: { sites?: readonly JobSite[]; maxResolve?: number; log?: (s: string) => void } = {}): Promise<JobSitesRun> {
  const log = opts.log ?? (() => {});
  const sites = opts.sites ?? JOB_SITES;
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const profile = await db.profile.findFirst({ where: { userId, isDefault: true } });
  const titles = parseJson<string[]>(settings?.targetTitles, []).length ? parseJson<string[]>(settings?.targetTitles, []) : profile ? candidateFromProfile(profile).titles.slice(0, 3) : [];
  const keys = titleKeywords(titles);
  const found: Record<string, number> = {};
  const errors: string[] = [];
  let all: (RawJob & { website?: string })[] = [];

  const take = async (site: JobSite, fn: () => Promise<(RawJob & { website?: string })[]>) => {
    if (!sites.includes(site)) return;
    try {
      const jobs = await fn();
      found[site] = jobs.length;
      all.push(...jobs);
    } catch (e) {
      errors.push(`${site}: ${(e as Error).message}`);
    }
  };
  // Remotive's feed only returns a few jobs without a search, so search a few short terms from your roles
  // (at most 6, spaced out), then filter by your roles here.
  await take("remotive", async () => {
    const terms: string[] = [];
    for (const ws of keys) {
      const t = ws.filter((w) => !["engineer", "developer", "engineering"].includes(w)).slice(0, 2).join(" ") || ws.join(" ");
      // skip a term that only narrows one already searched ("python backend" after "python")
      if (!terms.some((x) => ` ${t} `.includes(` ${x} `))) terms.push(t);
    }
    terms.splice(6);
    const out: RawJob[] = [];
    for (const t of terms.length ? terms : [""]) {
      out.push(...(await fetchRemotive(t, 50)));
      await new Promise((r) => setTimeout(r, 1500));
    }
    return out;
  });
  await take("remoteok", () => fetchRemoteOk());
  await take("weworkremotely", () => fetchWeWorkRemotely());
  // YC listing pages give little text, so only open the job pages whose titles fit your targets.
  await take("ycombinator", async () => (await fetchYcJobs({ roles: ycRolesFor(titles), maxDetails: 60 })).filter((j) => fitsTargets(j.title, keys)));

  // free keyword pre-filter before any lookups or AI
  all = all.filter((j) => fitsTargets(j.title, keys));
  const seen = new Set<string>();
  all = all.filter((j) => {
    const k = `${j.company.toLowerCase()}|${j.title.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  log(`Job sites: ${Object.entries(found).map(([k, v]) => `${k} ${v}`).join(", ")} → ${all.length} fit your target roles.`);

  // Point each at the employer's own posting (the one Upvance can apply to).
  clearBoardCache();
  let swapped = 0;
  const maxResolve = opts.maxResolve ?? 40;
  const resolved = await mapLimit(
    all,
    2,
    async (j) => {
      if (all.indexOf(j) >= maxResolve) return j;
      try {
        let r: RawJob = await resolveApplyUrl(j);
        if (r.applyUrl === j.applyUrl) r = await onEmployerBoard(j);
        if (r.source !== j.source || r.applyUrl !== j.applyUrl) swapped++;
        return r;
      } catch {
        return j;
      }
    },
    250,
  );
  const res = resolved.length ? await ingestJobs(resolved) : { jobIds: [] as string[], newJobIds: [] as string[], created: 0 };
  log(`Job sites: imported ${resolved.length} (${res.created} new), ${swapped} matched to the employer's own job page.`);
  return { found, kept: resolved.length, onEmployerBoard: swapped, created: res.created, jobIds: res.jobIds, newJobIds: res.newJobIds, errors };
}
