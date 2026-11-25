import { describe, expect, it } from "vitest";
import { fitsTargets, matchingTarget, titleKeywords } from "@/lib/matching/titles";
import { parseFilters, filtersToQuery } from "@/lib/feed-filters";

const ROLES = ["AI Engineer", "Software Engineer", "Generative AI Engineer", "Python Developer", "Python Backend Engineer", "LLM Engineer", "Full Stack Developer", "AI Agent Engineer", "Agentic AI Engineer", "Backend Developer (Node.js / Python)", "Applied AI Engineer", "AI Application Developer"];
const keys = titleKeywords(ROLES);

describe("Target roles", () => {
  it("matches your roles with common spellings", () => {
    for (const t of [
      "Senior AI Engineer",
      "Software Engineer, Backend",
      "Staff Software Development Engineer",
      "GenAI Engineer",
      "Gen-AI Developer",
      "Senior Python Developer",
      "Backend Engineer (Python)",
      "LLM Engineer – Inference",
      "Fullstack Developer",
      "Full-Stack Engineer (React/Node)",
      "AI Agents Engineer",
      "Agentic AI Developer",
      "Back-end Developer, Node.js",
      "Applied AI Engineer",
      "AI Applications Developer",
      "Lead AI App Developer",
    ]) expect(fitsTargets(t, keys), t).toBe(true);
  });

  it("leaves out other roles", () => {
    for (const t of ["Account Executive", "Data Scientist", "Product Manager, AI", "AI Researcher", "Frontend Developer", "Engineering Manager", "Sales Engineer", "Recruiter, AI Talent"]) expect(fitsTargets(t, keys), t).toBe(false);
  });

  it("says which role a job matched", () => {
    expect(matchingTarget("Senior Python Backend Engineer", ROLES)).toBe("Python Developer");
    expect(matchingTarget("Head of Sales", ROLES)).toBeNull();
  });

  it("the filter is on by default and can be switched off in the URL", () => {
    expect(parseFilters({}).targetRoles).toBeUndefined(); // = on when you have target roles
    expect(filtersToQuery({ targetRoles: false })).toBe("targetRoles=0");
    expect(parseFilters({ targetRoles: "0" }).targetRoles).toBe(false);
    expect(parseFilters({ targetRoles: "1" }).targetRoles).toBe(true);
  });
});
