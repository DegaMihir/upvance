import { describe, expect, it } from "vitest";
import { analyzeWithRules } from "@/lib/analysis/rules";
import { detectAts } from "@/lib/ats";
import { canonicalizeUrl, normalizeCompany } from "@/lib/text";
import { extractSkills } from "@/lib/skills";

const job = (description: string, location = "", title = "Machine Learning Engineer") =>
  analyzeWithRules({ title, company: "Acme", location, description });

describe("sponsorship detection", () => {
  it("confirmed", () => {
    expect(job("We offer Skilled Worker visa sponsorship for this role.").sponsorship.category).toBe("Confirmed");
    expect(job("Visa sponsorship is available.").sponsorship.category).toBe("Confirmed");
    expect(job("We sponsor H-1B visas for this role.").sponsorship.category).toBe("Confirmed");
  });
  it("no sponsorship", () => {
    expect(job("We are unable to sponsor visas now or in the future.").sponsorship.category).toBe("No Sponsorship");
    expect(job("Candidates must be authorized to work in the US without sponsorship.").sponsorship.category).toBe("No Sponsorship");
  });
  it("existing employees only counts as no sponsorship", () => {
    const a = job("Please note: visa sponsorship is only available for existing employees transferring internally.");
    expect(a.sponsorship.category).toBe("No Sponsorship");
    expect(a.sponsorship.existingEmployeesOnly).toBe(true);
  });
  it("case by case", () => {
    expect(job("Visa sponsorship is considered on a case-by-case basis.").sponsorship.category).toBe("Case-by-Case");
  });
  it("unknown when not mentioned", () => {
    expect(job("Build models in Python.").sponsorship.category).toBe("Unknown");
  });
});

describe("remote & location detection", () => {
  it("Remote – US only is country-only", () => {
    const a = job("This is a fully remote position. You must be based in the United States.", "Remote – US");
    expect(a.remote.category).toBe("Country-only");
    expect(a.remote.countries).toContain("US");
  });
  it("worldwide", () => {
    expect(job("You can work from anywhere in the world.", "Remote – Worldwide").remote.category).toBe("Worldwide");
  });
  it("region", () => {
    const a = job("Open to candidates located in Europe.", "Remote (Europe)");
    expect(a.remote.category).toBe("Region");
    expect(a.remote.regions).toContain("Europe");
  });
  it("plain 'Remote' is unspecified, not eligible by default", () => {
    expect(job("This is a remote role.", "Remote").remote.category).toBe("Remote (unspecified)");
  });
  it("hybrid and onsite", () => {
    expect(job("Hybrid: 2 days a week in the office.", "London, United Kingdom").remote.category).toBe("Hybrid");
    expect(job("Join us in our office.", "Berlin, Germany").remote.category).toBe("Onsite");
  });
  it("relocation required", () => {
    expect(job("You must be willing to relocate to Dubai.", "Dubai, UAE").remote.category).toBe("Relocation required");
  });
});

describe("work authorization", () => {
  it("citizenship + clearance", () => {
    const a = job("Applicants must be U.S. citizens and hold an active Secret security clearance.", "Arlington, VA, United States");
    expect(a.workAuth.citizenshipRequired).toContain("US");
    expect(a.workAuth.securityClearance).toBe(true);
  });
  it("existing right to work", () => {
    const a = job("Applicants must have full Australian working rights.", "Sydney, Australia");
    expect(a.sponsorship.category === "No Sponsorship" || a.workAuth.existingAuthRequired.length > 0).toBe(true);
  });
});

describe("structured extraction", () => {
  const a = job(
    `What you'll do
• Build ranking models in PyTorch
• Deploy services on AWS with Docker

Requirements
• 5+ years of experience in machine learning
• Python and SQL

Salary: $120,000 - $150,000 per year. Full-time.`,
    "Remote – US",
    "Senior ML Engineer",
  );
  it("experience, seniority, salary, type", () => {
    expect(a.experienceYears?.min).toBe(5);
    expect(a.seniority).toBe("Senior");
    expect(a.salary).toMatchObject({ min: 120000, max: 150000, currency: "USD" });
    expect(a.employmentType).toBe("full-time");
  });
  it("skills, responsibilities, qualifications", () => {
    expect(a.skills).toEqual(expect.arrayContaining(["Python", "PyTorch", "AWS", "Docker", "SQL"]));
    expect(a.responsibilities.length).toBeGreaterThanOrEqual(2);
    expect(a.qualifications.length).toBeGreaterThanOrEqual(2);
  });
});

describe("helpers", () => {
  it("detects ATS types", () => {
    expect(detectAts("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/acme/abc")).toBe("lever");
    expect(detectAts("https://jobs.ashbyhq.com/acme/abc")).toBe("ashby");
    expect(detectAts("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x")).toBe("workday");
    expect(detectAts("https://www.linkedin.com/jobs/view/1")).toBe("linkedin");
  });
  it("canonicalizes URLs for duplicate detection", () => {
    expect(canonicalizeUrl("https://www.Example.com/jobs/1/?utm_source=x&gh_src=y#apply")).toBe(canonicalizeUrl("http://example.com/jobs/1"));
  });
  it("normalizes company names", () => {
    expect(normalizeCompany("Northwind Analytics Ltd")).toBe(normalizeCompany("Northwind Analytics"));
    expect(normalizeCompany("Quanta Ledger B.V.")).toBe("quanta ledger");
  });
  it("doesn't treat ordinary words as skills", () => {
    expect(extractSkills("Take a rest and excel at spring cleaning")).not.toEqual(expect.arrayContaining(["REST APIs"]));
    expect(extractSkills("We use Go, Python and REST APIs")).toEqual(expect.arrayContaining(["Go", "Python", "REST APIs"]));
  });
});
