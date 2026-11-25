import { describe, expect, it } from "vitest";
import { parseWwrRss, parseYcSalary, sameTitle, ycPageData, ycPostingToRaw, ycRolesFor, ycVisaSentence } from "@/lib/sources/remote-boards";
import { fitsTargets, titleKeywords } from "@/lib/jobs/job-sites";
import { atsSupport, detectAts } from "@/lib/ats";
import { fairRemotePay, payCheck } from "@/lib/matching/pay";
import { analyzeWithRules } from "@/lib/analysis/rules";
import { parseFilters, filtersToQuery } from "@/lib/feed-filters";

const WWR = `<?xml version="1.0"?><rss><channel><title>We Work Remotely</title>
<item><title>Acme AI: Senior Machine Learning Engineer</title><region>Anywhere in the World</region><type>Full-Time</type>
<description>&lt;p&gt;Build &lt;strong&gt;LLM&lt;/strong&gt; systems. Python, PyTorch.&lt;/p&gt;</description>
<pubDate>Thu, 22 Oct 2026 07:31:14 +0000</pubDate><guid>https://weworkremotely.com/remote-jobs/acme-ai-senior-ml-engineer</guid><link>https://weworkremotely.com/remote-jobs/acme-ai-senior-ml-engineer</link></item>
<item><title>Beta: Contract Data Scientist</title><region>USA Only</region><type>Contract</type><description>Stats</description><pubDate>Wed, 21 Oct 2026 07:31:14 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/beta-data-scientist</link></item>
</channel></rss>`;

describe("We Work Remotely feed", () => {
  it("reads company, title, region, date and text from the RSS feed", () => {
    const jobs = parseWwrRss(WWR);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ source: "weworkremotely", company: "Acme AI", title: "Senior Machine Learning Engineer", location: "Remote (Anywhere in the World)", applyUrl: "https://weworkremotely.com/remote-jobs/acme-ai-senior-ml-engineer", externalId: "/remote-jobs/acme-ai-senior-ml-engineer" });
    expect(jobs[0].description).toContain("Build LLM systems");
    expect(jobs[0].postedAt?.toISOString()).toBe("2026-10-22T07:31:14.000Z");
    expect(jobs[1]).toMatchObject({ company: "Beta", title: "Contract Data Scientist", location: "Remote (USA Only)", employmentType: "contract" });
  });
});

describe("Y Combinator jobs", () => {
  const posting = { id: 111719, title: "ML Engineer", url: "/companies/acme/jobs/abc-ml-engineer", location: "San Francisco, CA, US / Remote (US)", type: "Full-time", salaryRange: "$140K - $190K", minExperience: "3+ years", visa: "Will sponsor", companyName: "Acme", createdAt: "about 2 months", description: "# About\nWe build models." };

  it("reads the job data the page renders from", () => {
    const html = `<div id="app" data-page="${JSON.stringify({ component: "WaasJobListingsPage", props: { jobPostings: [posting] } }).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`;
    expect((ycPageData(html)?.props.jobPostings as unknown[])[0]).toMatchObject({ id: 111719, title: "ML Engineer" });
  });

  it("turns salary and visa fields into data the analysis understands", () => {
    expect(parseYcSalary("$70K - $120K")).toEqual({ min: 70000, max: 120000, currency: "USD" });
    expect(parseYcSalary("£60K - £80K")).toEqual({ min: 60000, max: 80000, currency: "GBP" });
    expect(parseYcSalary("")).toEqual({ min: null, max: null, currency: null });
    const raw = ycPostingToRaw(posting, { website: "https://acme.example" });
    expect(raw).toMatchObject({ source: "ycombinator", externalId: "111719", company: "Acme", salaryMin: 140000, salaryMax: 190000, salaryCurrency: "USD", applyUrl: "https://www.ycombinator.com/companies/acme/jobs/abc-ml-engineer" });
    expect(raw.description).toMatch(/will sponsor visas/);
    // the visa wording is read by the normal job analysis
    expect(analyzeWithRules({ title: raw.title, company: raw.company, description: raw.description, location: raw.location }).sponsorship.category).toMatch(/Confirmed|Likely/);
    const noSponsor = ycPostingToRaw({ ...posting, visa: "US citizen/visa only" });
    expect(analyzeWithRules({ title: noSponsor.title, company: noSponsor.company, description: noSponsor.description, location: noSponsor.location }).sponsorship.category).toBe("No Sponsorship");
    expect(ycVisaSentence("US citizenship/visa not required")).toMatch(/not required/);
  });

  it("picks YC role pages from your target titles", () => {
    expect(ycRolesFor(["ML Engineer", "Data Scientist"])).toEqual(expect.arrayContaining(["software-engineer", "science"]));
    expect(ycRolesFor(["Product Manager"])).toEqual(["product-manager"]);
  });
});

describe("Job sites → employer's own job page", () => {
  it("matches the same job title on the employer board, but not different roles", () => {
    expect(sameTitle("Senior Machine Learning Engineer", "Senior Machine Learning Engineer (Remote)")).toBe(true);
    expect(sameTitle("ML Engineer - US", "ML Engineer")).toBe(true);
    expect(sameTitle("Senior Machine Learning Engineer", "Machine Learning Engineer, Infrastructure")).toBe(false);
    expect(sameTitle("Data Scientist", "Data Engineer")).toBe(false);
  });

  it("only keeps jobs that fit your target roles", () => {
    const keys = titleKeywords(["ML Engineer", "Data Scientist", "LLM Engineer"]);
    expect(fitsTargets("Senior Machine Learning Engineer", keys)).toBe(true);
    expect(fitsTargets("Staff ML Engineer", keys)).toBe(true);
    expect(fitsTargets("Data Scientist II", keys)).toBe(true);
    expect(fitsTargets("LLM Platform Engineer", keys)).toBe(true);
    expect(fitsTargets("Account Executive", keys)).toBe(false);
    expect(fitsTargets("Data Entry Clerk", keys)).toBe(false);
    const ai = titleKeywords(["AI Engineer"]);
    expect(fitsTargets("Software Engineer (AI)", ai)).toBe(true);
    expect(fitsTargets("Applied AI Developer", ai)).toBe(true);
    expect(fitsTargets("Creative Design Team Lead (AI & Performance Marketing)", ai)).toBe(false);
    expect(fitsTargets("Anything", [])).toBe(true);
  });

  it("YC and WWR pages are never auto-applied – only the employer's own posting is", () => {
    expect(detectAts("https://weworkremotely.com/remote-jobs/acme-ml")).toBe("weworkremotely");
    expect(detectAts("https://www.ycombinator.com/companies/acme/jobs/abc")).toBe("ycombinator");
    expect(atsSupport("weworkremotely").level).toBe("unsupported");
    expect(atsSupport("ycombinator").level).toBe("unsupported");
    expect(detectAts("https://jobs.ashbyhq.com/acme/123")).toBe("ashby");
  });
});

describe("Remote pay parity", () => {
  const prefs = { minSalary: 120000, salaryCurrency: "USD" };
  const remote = { remoteCategory: "Worldwide" };

  it("flags remote jobs whose pay is cut to where you live", () => {
    for (const d of [
      "Compensation is based on your location and local market rates.",
      "Salary ranges vary by country.",
      "We offer location-based pay.",
      "Pay is adjusted for cost of living in your region.",
      "You'll be paid in local currency at local market rates.",
      "We use geo pay zones.",
    ]) {
      const c = payCheck({ description: d, ...remote }, null, prefs);
      expect(c.geoAdjusted, d).toBe(true);
      expect(fairRemotePay(c)).toBe(false);
      expect(c.issues[0]).toMatch(/adjusted to where you live/);
    }
  });

  it("does not flag jobs that pay the same everywhere, or on-site jobs with location wording", () => {
    expect(fairRemotePay(payCheck({ description: "We pay the same salary regardless of location: $150,000 – $180,000.", salaryMin: 150000, salaryMax: 180000, salaryCurrency: "USD", ...remote }, null, prefs))).toBe(true);
    expect(payCheck({ description: "We pay the same salary regardless of location.", salaryMax: 180000, salaryCurrency: "USD", ...remote }, null, prefs).good[0]).toMatch(/no location-based cut/);
    const onsite = payCheck({ description: "Salary is based on location.", remoteCategory: "Onsite" }, null, prefs);
    expect(onsite.issues).toEqual([]); // on-site pay for that city is the point
    expect(fairRemotePay(payCheck({ description: "Great team.", ...remote }, null, prefs))).toBe(true); // no pay info is not a problem
  });

  it("flags pay below your minimum (same currency only, yearly)", () => {
    const low = payCheck({ description: "", salaryMin: 60000, salaryMax: 90000, salaryCurrency: "USD", ...remote }, null, prefs);
    expect(low.belowMinimum).toBe(true);
    expect(low.issues[0]).toMatch(/below your minimum of USD 120,000/);
    const monthly = payCheck({ description: "", ...remote }, { salary: { min: 9000, max: 11000, currency: "USD", period: "month" }, remote: { category: "Worldwide" } } as never, prefs);
    expect(monthly.yearly).toBe(132000);
    expect(monthly.belowMinimum).toBe(false);
    const euros = payCheck({ description: "", salaryMax: 70000, salaryCurrency: "EUR", ...remote }, null, prefs);
    expect(euros.otherCurrency).toBe(true);
    expect(euros.belowMinimum).toBe(false);
  });

  it("is a feed filter that survives the URL", () => {
    expect(parseFilters({ fairPay: "1" }).fairPay).toBe(true);
    expect(filtersToQuery({ fairPay: true })).toBe("fairPay=1");
  });
});

describe("YC location format", () => {
  it("reads 'City, ST, US' as the United States", async () => {
    const { findCountries } = await import("@/lib/countries");
    expect(findCountries("Palo Alto, CA, US")).toContain("US");
    expect(findCountries("New York, NY, US / Remote")).toContain("US");
    expect(findCountries("Contact us, we reply fast")).not.toContain("US");
  });
});
