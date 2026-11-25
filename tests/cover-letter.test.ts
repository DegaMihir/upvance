import { describe, expect, it } from "vitest";
import { sampleResume } from "@/lib/demo/data";
import { coverLetterFromTemplate } from "@/lib/writing/cover-letter";
import { extractSkills } from "@/lib/skills";
import { resumeText } from "@/lib/resume/document";

const base = { doc: sampleResume, yearsExperience: 6, currentCountry: "IN", willingToRelocate: true };

describe("cover letters (acceptance: two letters for different jobs share no identical paragraphs)", () => {
  const a = coverLetterFromTemplate({
    ...base,
    jobId: "job-a",
    title: "Senior Machine Learning Engineer",
    company: "Northwind Analytics",
    needsVisaFor: ["GB"],
    analysis: { skills: ["Python", "PyTorch", "AWS", "Kubernetes"], requiredSkills: ["Python", "PyTorch"], responsibilities: ["Design, train and deploy forecasting models", "Own models end to end", "Improve our MLOps tooling"] },
  });
  const b = coverLetterFromTemplate({
    ...base,
    jobId: "job-b",
    title: "LLM Engineer",
    company: "Quanta Ledger",
    needsVisaFor: ["NL"],
    analysis: { skills: ["LLMs", "NLP", "Docker"], requiredSkills: ["LLMs", "NLP"], responsibilities: ["Build LLM-powered document extraction", "Evaluate model quality in production"] },
  });

  it("are personalised to company and role", () => {
    expect(a).toContain("Northwind Analytics");
    expect(a).toContain("Senior Machine Learning Engineer");
    expect(b).toContain("Quanta Ledger");
    expect(b).toContain("LLM Engineer");
  });

  it("share no identical paragraphs", () => {
    const pa = a.split(/\n\n+/).map((p) => p.trim());
    const pb = new Set(b.split(/\n\n+/).map((p) => p.trim()));
    const shared = pa.filter((p) => pb.has(p) && !/^Kind regards/.test(p));
    expect(shared).toEqual([]);
  });

  it("contain no skills the candidate doesn't have", () => {
    const allowed = new Set(extractSkills(resumeText(sampleResume)));
    for (const s of extractSkills(a + b)) expect(allowed.has(s) || ["Forecasting"].includes(s)).toBe(true);
  });

  it("is honest about visa needs", () => {
    expect(a).toMatch(/would need visa sponsorship to work in United Kingdom/);
  });
});
