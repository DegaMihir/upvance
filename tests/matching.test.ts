import { describe, expect, it } from "vitest";
import { analyzeWithRules } from "@/lib/analysis/rules";
import { eligibilityFor } from "@/lib/matching/eligibility";
import { bandFor, scoreJob, normalizeWeights, DEFAULT_WEIGHTS } from "@/lib/matching/scoring";
import type { Candidate } from "@/lib/matching/candidate";

const indiaCandidate: Candidate = {
  skills: ["Python", "PyTorch", "AWS", "Docker", "Kubernetes", "SQL", "Machine Learning", "NLP", "LLMs", "MLOps", "Spark", "Airflow", "Pandas", "scikit-learn", "Deep Learning", "Statistics", "FastAPI"],
  yearsExperience: 6,
  citizenship: ["IN"],
  currentCountry: "IN",
  workAuthorizations: ["IN"],
  needsSponsorship: true,
  willingToRelocate: true,
  relocationCountries: [],
  experienceText: "Built NLP and LLM models in PyTorch, deployed with Docker and Kubernetes on AWS, monitored models, data pipelines with Spark and Airflow, mentored engineers",
  titles: ["Machine Learning Engineer"],
  hasDegree: true,
  salaryExpectation: null,
  salaryCurrency: "USD",
};

function evaluate(description: string, location: string, title = "Senior ML Engineer") {
  const a = analyzeWithRules({ title, company: "Acme", location, description });
  const el = eligibilityFor(indiaCandidate, a, a.sponsorship.category);
  const s = scoreJob({ candidate: indiaCandidate, analysis: a, sponsorship: a.sponsorship.category, eligibility: el, postedAt: new Date() });
  return { a, el, s };
}

describe("eligibility (acceptance criteria)", () => {
  it("“Remote – US only” is ineligible for an India-based candidate", () => {
    const { el } = evaluate("Fully remote. You must be based in the United States. Python, PyTorch.", "Remote – US only");
    expect(el.status).toBe("Ineligible");
    expect(el.reasons.join(" ")).toMatch(/United States/);
  });

  it("unknown sponsorship is flagged “Needs review”", () => {
    const { el, a } = evaluate("Build ML models in Python. Office-based.", "Dublin, Ireland");
    expect(a.sponsorship.category).toBe("Unknown");
    expect(el.status).toBe("Needs review");
    expect(el.reasons.join(" ")).toMatch(/unknown/i);
  });

  it("a ~95-point job requiring citizenship the user lacks is “Ineligible” with the reason", () => {
    const description = `What you'll do
• Build NLP and LLM models in PyTorch
• Deploy models on AWS with Docker and Kubernetes
• Build data pipelines with Spark and Airflow
• Monitor models and mentor engineers

Requirements
• 5+ years of experience in machine learning
• Python, PyTorch, SQL, Pandas, scikit-learn, MLOps, Deep Learning, Statistics, FastAPI
We offer visa sponsorship.
Applicants must be U.S. citizens. Onsite in Austin.`;
    const { el, s } = evaluate(description, "Austin, TX, United States");
    expect(s.score).toBeGreaterThanOrEqual(85); // would be Excellent on suitability alone
    expect(el.status).toBe("Ineligible");
    expect(el.reasons[0]).toMatch(/United States citizenship/);
  });

  it("worldwide remote is eligible", () => {
    const { el } = evaluate("Work from anywhere in the world. Python.", "Remote – Worldwide");
    expect(el.status).toBe("Eligible");
  });

  it("confirmed sponsorship onsite abroad is eligible for a candidate open to relocation", () => {
    const { el, s } = evaluate("We offer Skilled Worker visa sponsorship. Python, PyTorch.", "London, United Kingdom");
    expect(el.status).toBe("Eligible");
    expect(s.breakdown.components.sponsorship).toBe(100);
  });

  it("no sponsorship abroad is ineligible", () => {
    const { el } = evaluate("We are unable to sponsor visas.", "Boston, MA, United States");
    expect(el.status).toBe("Ineligible");
  });
});

describe("scoring", () => {
  it("bands follow the spec", () => {
    expect(bandFor(100)).toBe("Excellent");
    expect(bandFor(85)).toBe("Excellent");
    expect(bandFor(84)).toBe("Strong");
    expect(bandFor(75)).toBe("Strong");
    expect(bandFor(74)).toBe("Good");
    expect(bandFor(65)).toBe("Good");
    expect(bandFor(64)).toBe("Moderate");
    expect(bandFor(50)).toBe("Moderate");
    expect(bandFor(49)).toBe("Poor");
  });
  it("default weights match the spec and sum to 100", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ skills: 30, experience: 20, responsibilities: 15, sponsorship: 15, location: 10, seniority: 5, freshness: 5 });
    expect(Object.values(normalizeWeights({})).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
  it("custom weights change the score", () => {
    const a = analyzeWithRules({ title: "Data Engineer", company: "X", location: "London, United Kingdom", description: "We offer visa sponsorship. Tableau, Excel, SQL. 1+ years of experience." });
    const el = eligibilityFor(indiaCandidate, a, a.sponsorship.category);
    const base = scoreJob({ candidate: indiaCandidate, analysis: a, sponsorship: a.sponsorship.category, eligibility: el, postedAt: new Date() });
    const skillsOnly = scoreJob({ candidate: indiaCandidate, analysis: a, sponsorship: a.sponsorship.category, eligibility: el, postedAt: new Date(), weights: { skills: 100, experience: 0, responsibilities: 0, sponsorship: 0, location: 0, seniority: 0, freshness: 0 } });
    expect(skillsOnly.score).toBe(base.breakdown.components.skills);
    expect(skillsOnly.score).not.toBe(base.score);
  });
  it("explains matches and gaps in plain English", () => {
    const { s } = evaluate("Requirements: 8+ years of experience. Python, Rust, Kafka. We offer visa sponsorship.", "London, United Kingdom");
    expect(s.whyMatch.join(" ")).toMatch(/Python/);
    expect(s.whyNot.join(" ")).toMatch(/Rust|Kafka/);
    expect(s.whyNot.join(" ")).toMatch(/8\+ years/);
  });
});

describe("role fit", () => {
  it("scales down jobs in an unrelated role that need none of your skills", () => {
    const desc = "We offer visa sponsorship. Review contracts and advise on intellectual property. 3+ years of experience.";
    const ip = evaluate(desc, "London, United Kingdom", "Intellectual Property Counsel");
    const ml = evaluate(desc + " Python, PyTorch, AWS.", "London, United Kingdom", "Machine Learning Engineer");
    expect(ip.s.score).toBeLessThan(65);
    expect(ip.s.whyNot.join(" ")).toMatch(/role title is quite different/);
    expect(ml.s.score).toBeGreaterThan(ip.s.score + 15);
  });
});
