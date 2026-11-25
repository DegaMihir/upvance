import { describe, expect, it } from "vitest";
import { sampleResume } from "@/lib/demo/data";
import { resumeToPdf, resumeToDocx } from "@/lib/resume/export";
import { parseResumeText, pdfToText } from "@/lib/resume/parse";
import { applyAiTailoring, diffDocs, tailorWithRules } from "@/lib/resume/tailor";
import { resumeText, missingProfileFields } from "@/lib/resume/document";
import { extractSkills } from "@/lib/skills";
import type { Profile } from "@prisma/client";

describe("resume parsing (acceptance: a sample PDF produces an editable profile)", () => {
  it("extracts contact info, work history, education and skills from the sample PDF", async () => {
    const pdf = await resumeToPdf(sampleResume);
    const text = await pdfToText(pdf);
    const p = parseResumeText(text);
    expect(p.fullName).toBe("Aarav Mehta");
    expect(p.email).toBe("aarav.mehta@example.com");
    expect(p.phone.replace(/\D/g, "")).toBe("919845012345");
    expect(p.linkedin).toContain("linkedin.com/in/aarav-mehta-demo");
    expect(p.currentCountry).toBe("IN");
    expect(p.skills).toEqual(expect.arrayContaining(["Python", "PyTorch", "AWS", "Kubernetes"]));
    expect(p.experiences.length).toBe(3);
    expect(p.experiences[0]).toMatchObject({ title: "Senior Machine Learning Engineer", company: "Saffron Commerce", start: "2022-03", end: "Present" });
    expect(p.experiences[0].bullets.length).toBe(4);
    expect(p.experiences[1]).toMatchObject({ company: "Indus Analytics", start: "2019-07", end: "2022-02" });
    expect(p.education[0].school).toMatch(/National Institute of Technology/);
    expect(p.education[0].end).toBe("2018");
  });

  it("rejects non-PDF files", async () => {
    await expect(pdfToText(new TextEncoder().encode("hello world"))).rejects.toThrow(/isn't a PDF/);
  });

  it("highlights missing required fields", () => {
    const blank = { fullName: "Jo", email: "", phone: "", currentCountry: "", citizenship: "", skills: "[]", experiences: "[]" } as unknown as Profile;
    expect(missingProfileFields(blank)).toEqual(["Email", "Phone", "Current country", "Citizenship", "Skills", "Work history"]);
  });
});

const job = {
  title: "LLM Engineer",
  skills: ["Python", "LLMs", "NLP", "Docker", "Kafka"],
  requiredSkills: ["Python", "LLMs", "NLP", "Docker", "Kafka"],
  responsibilities: ["Build retrieval-augmented generation features", "Monitor model quality"],
};

describe("truthful tailoring (acceptance: diff shows every change; no new facts)", () => {
  it("rules tailoring only reorders – never adds skills or facts", () => {
    const r = tailorWithRules(sampleResume, job, "aggressive");
    expect(new Set(r.doc.skills)).toEqual(new Set(sampleResume.skills));
    expect(r.doc.skills.slice(0, 3)).toEqual(expect.arrayContaining(["Python", "LLMs"]));
    expect(r.doc.skills).not.toContain("Kafka");
    const allOriginalBullets = sampleResume.experiences.flatMap((e) => e.bullets).sort();
    expect(r.doc.experiences.flatMap((e) => e.bullets).sort()).toEqual(allOriginalBullets);
    // Every change is listed
    const recomputed = diffDocs(sampleResume, r.doc);
    expect(r.changes).toEqual(recomputed);
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it("the guard reverts AI edits that invent numbers, skills, employers or degrees", () => {
    const { doc, guard } = applyAiTailoring(sampleResume, {
      summary: "Machine learning engineer with 10 years of experience and a PhD from Stanford, expert in Kafka.",
      skills: ["LLMs", "Python", "Kafka", "Rust"],
      experiences: [
        {
          index: 0,
          bullets: [
            { from: 1, text: "Designed an LLM-based support ticket classifier using retrieval-augmented generation, cutting manual triage time by 35%." }, // allowed rewording
            { from: 0, text: "Built a ranking model in PyTorch that increased click-through rate by 45% at Google." }, // invented number + employer
            { from: 2, text: "Led migration of 14 batch models to Kubernetes using Kafka streaming." }, // invented skill
          ],
        },
      ],
    });
    // summary rejected
    expect(doc.summary).toBe(sampleResume.summary);
    // invented skills removed, real skills all kept
    expect(doc.skills).not.toContain("Kafka");
    expect(doc.skills).not.toContain("Rust");
    expect(new Set(doc.skills)).toEqual(new Set(sampleResume.skills));
    // allowed rewrite kept, invented bullets reverted
    expect(doc.experiences[0].bullets[0]).toMatch(/^Designed an LLM-based support ticket classifier using/);
    expect(doc.experiences[0].bullets).toContain(sampleResume.experiences[0].bullets[0]);
    expect(doc.experiences[0].bullets).toContain(sampleResume.experiences[0].bullets[2]);
    expect(doc.experiences[0].bullets).toContain(sampleResume.experiences[0].bullets[3]); // dropped bullet is kept
    expect(guard.length).toBeGreaterThanOrEqual(5);

    // No new facts anywhere: every skill/number in the result exists in the original
    const original = resumeText(sampleResume);
    const result = resumeText(doc);
    const nums = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?%?/g) ?? []);
    for (const n of nums(result)) expect(nums(original).has(n)).toBe(true);
    for (const s of extractSkills(result)) expect(extractSkills(original)).toContain(s);
    // and the diff lists the rewritten bullet
    expect(diffDocs(sampleResume, doc).some((c) => c.kind === "rewritten")).toBe(true);
  });

  it("exports PDF and DOCX", async () => {
    const pdf = await resumeToPdf(sampleResume);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const docx = await resumeToDocx(sampleResume);
    expect(docx.subarray(0, 2).toString()).toBe("PK"); // zip container
  });
});
