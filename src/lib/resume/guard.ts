/**
 * Fabrication guard: deterministic checks that a rewritten text adds no new
 * facts. Anything that fails is reverted to the original wording.
 */
import { extractSkills, skillSet } from "../skills";

const COMMON_CAPS = new Set(
  "I A An The And Or But For In On At To With By Of As From Led Built Designed Developed Created Managed Improved Reduced Increased Delivered Drove Owned Implemented Launched Worked Collaborated Partnered Mentored Automated Migrated Optimized Optimised Scaled Wrote Shipped Maintained Supported Analyzed Analysed Researched Presented Coordinated Established Spearheaded Streamlined Experienced Skilled Proven Results Strong Senior Junior Engineer Developer Analyst Scientist Manager Lead Data Software Product Team Teams Customer Customers Client Clients Users API APIs UI UX Q1 Q2 Q3 Q4 This That These My Our Their Using Across Over Within Through Including End Cross Full Key Core Hands Self Fast New High Large Real Time Open Source".split(
    " ",
  ),
);

const SOFT_SKILLS = new Set(["Leadership", "Communication", "Agile", "Project Management", "Data Analysis", "System Design", "Testing", "Security"]);

function numbers(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?\s*%?|\$\s?\d+[kKmM]?|\d+[kKmMxX]\b/g) ?? []).map((n) => n.replace(/\s/g, "").replace(",", "."));
}

function capitalizedTerms(s: string): string[] {
  const out: string[] = [];
  const parts = s.split(/(?<=[.!?:;•])\s+|\n/);
  for (const part of parts) {
    const words = part.match(/\b[A-Z][A-Za-z0-9+#.&-]*[A-Za-z0-9+#]|\b[A-Z]{2,}\b/g) ?? [];
    words.forEach((w, idx) => {
      if (idx === 0 && part.trim().startsWith(w)) return; // sentence start
      if (!COMMON_CAPS.has(w)) out.push(w);
    });
  }
  return out;
}

export interface GuardIssue {
  where: string;
  reason: string;
  attempted: string;
}

/**
 * Check `candidate` text against the allowed `source` facts.
 * - numbers must already exist in the source
 * - skills/tools must be on the candidate's profile or in the source text
 * - capitalised names (companies, products, certifications) must appear in the full resume
 */
export function checkText(candidate: string, source: string, fullResume: string, profileSkills: string[]): string | null {
  const srcNums = new Set(numbers(source));
  const allNums = new Set(numbers(fullResume));
  for (const n of numbers(candidate)) {
    if (!srcNums.has(n) && !allNums.has(n)) return `adds the number “${n}” which isn't in your profile`;
  }
  const allowedSkills = skillSet(profileSkills);
  const sourceSkills = new Set(extractSkills(fullResume).map((s) => s.toLowerCase()));
  for (const s of extractSkills(candidate)) {
    if (SOFT_SKILLS.has(s)) continue; // soft-skill words aren't verifiable tools/technologies
    if (!allowedSkills.has(s.toLowerCase()) && !sourceSkills.has(s.toLowerCase())) return `adds the skill “${s}” which isn't in your profile`;
  }
  const resumeLower = fullResume.toLowerCase();
  for (const w of capitalizedTerms(candidate)) {
    if (!resumeLower.includes(w.toLowerCase())) return `adds “${w}”, which doesn't appear in your profile`;
  }
  return null;
}

export function guardSkills(proposed: string[], original: string[]): { skills: string[]; issues: GuardIssue[] } {
  const orig = new Map(original.map((s) => [s.toLowerCase(), s]));
  const issues: GuardIssue[] = [];
  const out: string[] = [];
  for (const s of proposed) {
    const hit = orig.get(s.toLowerCase());
    if (hit) {
      if (!out.includes(hit)) out.push(hit);
    } else issues.push({ where: "Skills", reason: "skill not on your profile – removed", attempted: s });
  }
  for (const s of original) if (!out.includes(s)) out.push(s); // never drop real skills silently
  return { skills: out, issues };
}
