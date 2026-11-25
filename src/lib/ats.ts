export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "icims"
  | "taleo"
  | "jobvite"
  | "workable"
  | "bamboohr"
  | "recruitee"
  | "personio"
  | "teamtailor"
  | "gem"
  | "breezy"
  | "jazzhr"
  | "linkedin"
  | "indeed"
  | "weworkremotely"
  | "ycombinator"
  | "unknown";

const RULES: [RegExp, AtsType][] = [
  [/(boards|job-boards)(\.eu)?\.greenhouse\.io|[?&]gh_jid=/i, "greenhouse"],
  [/jobs\.(eu\.)?lever\.co/i, "lever"],
  [/jobs\.ashbyhq\.com|ashby_jid=/i, "ashby"],
  [/myworkdayjobs\.com|\.workday\.com|myworkdaysite\.com/i, "workday"],
  [/smartrecruiters\.com/i, "smartrecruiters"],
  [/icims\.com/i, "icims"],
  [/taleo\.net/i, "taleo"],
  [/jobvite\.com/i, "jobvite"],
  [/apply\.workable\.com|workable\.com\/j/i, "workable"],
  [/bamboohr\.com/i, "bamboohr"],
  [/recruitee\.com/i, "recruitee"],
  [/jobs\.personio\.(de|com)/i, "personio"],
  [/teamtailor\.com/i, "teamtailor"],
  [/jobs\.gem\.com/i, "gem"],
  [/\.breezy\.hr/i, "breezy"],
  [/applytojob\.com/i, "jazzhr"],
  [/weworkremotely\.com/i, "weworkremotely"],
  [/ycombinator\.com\/companies\/|workatastartup\.com/i, "ycombinator"],
  [/linkedin\.com/i, "linkedin"],
  [/indeed\.(com|co\.[a-z]+|[a-z]{2})/i, "indeed"],
];

export function detectAts(url: string | null | undefined): AtsType {
  if (!url) return "unknown";
  for (const [re, t] of RULES) if (re.test(url)) return t;
  return "unknown";
}

export const ATS_LABEL: Record<AtsType, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  icims: "iCIMS",
  taleo: "Taleo",
  jobvite: "Jobvite",
  workable: "Workable",
  bamboohr: "BambooHR",
  recruitee: "Recruitee",
  personio: "Personio",
  teamtailor: "Teamtailor",
  gem: "Gem",
  breezy: "Breezy HR",
  jazzhr: "JazzHR",
  linkedin: "LinkedIn",
  indeed: "Indeed",
  weworkremotely: "We Work Remotely",
  ycombinator: "YC Work at a Startup",
  unknown: "Company site",
};

export type AtsSupport = { level: "supported" | "partial" | "needs-password" | "unsupported"; note: string };

/** How well assisted-apply (extension autofill) works for each ATS. */
export function atsSupport(ats: string, hasAppPassword = false): AtsSupport {
  switch (ats) {
    case "greenhouse":
    case "lever":
    case "ashby":
    case "gem":
      return { level: "supported", note: "Standard form – the extension can fill fields and attach your documents." };
    case "workable":
    case "smartrecruiters":
    case "recruitee":
    case "bamboohr":
    case "personio":
    case "teamtailor":
    case "breezy":
    case "jazzhr":
      return { level: "partial", note: "Most fields can be filled; check custom questions yourself." };
    case "workday":
      return hasAppPassword
        ? { level: "partial", note: "Workday needs an account. Sign in yourself; the extension fills the form pages." }
        : { level: "needs-password", note: "Workday requires an account. Set an application password in Settings first." };
    case "icims":
    case "taleo":
    case "jobvite":
      return { level: "partial", note: "Multi-step legacy form – expect to fill some pages manually." };
    case "linkedin":
      return { level: "unsupported", note: "LinkedIn Easy Apply is not supported. Use the employer's own apply link if one exists." };
    case "weworkremotely":
      return { level: "unsupported", note: "We Work Remotely only shows the apply link to signed-in job seekers. Open the posting and apply on the employer's site yourself." };
    case "ycombinator":
      return { level: "unsupported", note: "YC jobs are applied to through your own Work at a Startup account. Open the posting and apply there yourself." };
    case "indeed":
      return { level: "unsupported", note: "Indeed Apply is not supported. Use the employer's own apply link if one exists." };
    default:
      return { level: "partial", note: "Unknown form – the extension tries common fields; review everything." };
  }
}

export type BoardAts = "greenhouse" | "lever" | "ashby" | "gem" | "workable" | "smartrecruiters" | "recruitee" | "personio" | "teamtailor" | "bamboohr" | "breezy" | "jazzhr" | "workday";

/** Board slug (and job id when present) from a careers/job URL, for every supported board. */
export function boardFromUrl(url: string): { ats: BoardAts; slug: string; jobId?: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const sub = host.split(".")[0];
    if (/greenhouse\.io$/.test(host) && parts[0]) {
      const idx = parts.indexOf("jobs");
      return { ats: "greenhouse", slug: parts[0], jobId: idx >= 0 ? parts[idx + 1] : u.searchParams.get("gh_jid") ?? undefined };
    }
    if (/lever\.co$/.test(host) && parts[0]) return { ats: "lever", slug: parts[0], jobId: parts[1] };
    if (/ashbyhq\.com$/.test(host) && parts[0]) return { ats: "ashby", slug: parts[0], jobId: parts[1] };
    if (host === "jobs.gem.com" && parts[0]) return { ats: "gem", slug: parts[0], jobId: parts[1] };
    if (host === "apply.workable.com" && parts[0]) return { ats: "workable", slug: parts[0], jobId: parts[1] === "j" ? parts[2] : undefined };
    if (/(^|\.)smartrecruiters\.com$/.test(host) && parts[0] && host !== "api.smartrecruiters.com") return { ats: "smartrecruiters", slug: parts[0], jobId: parts[1]?.split("-")[0] };
    if (/\.recruitee\.com$/.test(host)) return { ats: "recruitee", slug: sub };
    if (/\.jobs\.personio\.(de|com)$/.test(host)) return { ats: "personio", slug: sub, jobId: parts[0] === "job" ? parts[1] : undefined };
    if (/\.teamtailor\.com$/.test(host)) return { ats: "teamtailor", slug: sub };
    if (/\.bamboohr\.com$/.test(host)) return { ats: "bamboohr", slug: sub };
    if (/\.breezy\.hr$/.test(host)) return { ats: "breezy", slug: sub };
    if (/\.applytojob\.com$/.test(host)) return { ats: "jazzhr", slug: sub };
    const wd = host.match(/^([^.]+)\.(wd\d+)\.myworkday(?:jobs|site)\.com$/);
    if (wd) {
      const ps = parts.filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
      const site = ps[0] === "recruiting" ? ps[2] : ps[0];
      const jobIdx = ps.indexOf("job");
      if (site) return { ats: "workday", slug: `${wd[1]}|${wd[2]}|${site}`, jobId: jobIdx >= 0 ? "/" + ps.slice(jobIdx).join("/") : undefined };
    }
  } catch {
    /* not a URL */
  }
  return null;
}
