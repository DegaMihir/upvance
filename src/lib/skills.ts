import { escapeRegExp } from "./text";

/**
 * Skill dictionary used by the non-AI fallback (and by the fabrication guard).
 * Each entry: canonical name -> aliases. Extend freely.
 */
export const SKILLS: Record<string, string[]> = {
  Python: ["python"],
  JavaScript: ["javascript", "js", "ecmascript"],
  TypeScript: ["typescript", "ts"],
  Java: ["java"],
  Kotlin: ["kotlin"],
  Go: ["golang", "go lang"],
  Rust: ["rust"],
  "C++": ["c++", "cpp"],
  "C#": ["c#", "csharp", ".net", "dotnet"],
  Ruby: ["ruby", "rails", "ruby on rails"],
  PHP: ["php", "laravel"],
  Scala: ["scala"],
  Swift: ["swift"],
  R: ["r programming", "r language", "rstudio"],
  SQL: ["sql", "postgresql", "postgres", "mysql", "sqlite", "t-sql"],
  NoSQL: ["nosql", "mongodb", "dynamodb", "cassandra"],
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs"],
  "Vue.js": ["vue", "vue.js", "vuejs"],
  Angular: ["angular"],
  "Node.js": ["node.js", "nodejs", "node"],
  Django: ["django"],
  Flask: ["flask"],
  FastAPI: ["fastapi"],
  Spring: ["spring boot", "spring"],
  GraphQL: ["graphql"],
  "REST APIs": ["rest api", "restful", "rest apis", "rest"],
  AWS: ["aws", "amazon web services", "ec2", "s3", "lambda"],
  GCP: ["gcp", "google cloud"],
  Azure: ["azure"],
  Docker: ["docker", "containers"],
  Kubernetes: ["kubernetes", "k8s"],
  Terraform: ["terraform", "infrastructure as code"],
  "CI/CD": ["ci/cd", "continuous integration", "github actions", "jenkins", "gitlab ci"],
  Linux: ["linux", "unix"],
  Git: ["git"],
  "Machine Learning": ["machine learning", "ml"],
  "Deep Learning": ["deep learning", "neural networks"],
  NLP: ["nlp", "natural language processing"],
  "Computer Vision": ["computer vision", "image recognition"],
  LLMs: ["llm", "llms", "large language models", "generative ai", "genai", "prompt engineering", "rag", "retrieval-augmented generation"],
  PyTorch: ["pytorch", "torch"],
  TensorFlow: ["tensorflow", "keras"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  Pandas: ["pandas", "numpy"],
  Spark: ["spark", "pyspark", "databricks"],
  Airflow: ["airflow"],
  dbt: ["dbt"],
  Kafka: ["kafka"],
  "Data Analysis": ["data analysis", "analytics", "data analytics"],
  "Data Engineering": ["data engineering", "etl", "data pipelines"],
  Tableau: ["tableau", "power bi", "looker"],
  Excel: ["excel", "spreadsheets"],
  Statistics: ["statistics", "statistical", "a/b testing", "experimentation"],
  MLOps: ["mlops", "mlflow", "kubeflow", "model deployment"],
  Microservices: ["microservices", "distributed systems"],
  "System Design": ["system design", "architecture"],
  Security: ["security", "owasp", "iam"],
  Testing: ["unit testing", "testing", "jest", "pytest", "test automation", "cypress", "playwright"],
  "HTML/CSS": ["html", "css", "tailwind", "sass"],
  Figma: ["figma"],
  "Product Management": ["product management", "roadmap", "product strategy"],
  Agile: ["agile", "scrum", "kanban"],
  "Project Management": ["project management", "pmp", "stakeholder management"],
  Communication: ["communication skills", "written communication", "verbal communication"],
  Leadership: ["leadership", "mentoring", "people management", "team lead"],
  Salesforce: ["salesforce"],
  SAP: ["sap"],
  "Mobile Development": ["ios", "android", "react native", "flutter", "mobile development"],
  Elasticsearch: ["elasticsearch", "opensearch"],
  Redis: ["redis"],
  "Customer Success": ["customer success", "account management"],
  Marketing: ["seo", "sem", "digital marketing", "content marketing"],
};

// Aliases that are ordinary English words: only matched with their usual capitalisation.
const CASE_SENSITIVE: Record<string, string> = {
  rest: "REST",
  spring: "Spring",
  excel: "Excel",
  sap: "SAP",
  r: "R",
  go: "Go",
  swift: "Swift",
  rust: "Rust",
  ts: "TS",
  ml: "ML",
  security: "Security",
  testing: "Testing",
  architecture: "Architecture",
  analytics: "Analytics",
  leadership: "Leadership",
  containers: "Containers",
};

const PATTERNS: { skill: string; re: RegExp }[] = Object.entries(SKILLS).flatMap(([skill, aliases]) =>
  [skill.toLowerCase(), ...aliases].map((a) => {
    const cs = CASE_SENSITIVE[a];
    const word = cs ?? a.toLowerCase();
    return {
      skill,
      // word-ish boundaries that also work for c++, c#, .net
      re: new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRegExp(word)}(?=$|[^A-Za-z0-9+#&'’])`, cs ? "" : "i"),
    };
  }),
);

/** Return canonical skills mentioned in text. */
export function extractSkills(text: string): string[] {
  const found = new Set<string>();
  const t = " " + text + " ";
  for (const { skill, re } of PATTERNS) {
    if (found.has(skill)) continue;
    if (re.test(t)) found.add(skill);
  }
  // "Go" special case: only trust "Golang" or "Go (" / "Go," in tech lists
  if (/\bgo\b(?=\s*[,/)]|\s+and\s+(rust|python|java))/i.test(text)) found.add("Go");
  return Array.from(found);
}

/** Map any free-text skill to its canonical name (or keep it as typed). */
export function canonicalSkill(s: string): string {
  const lower = s.trim().toLowerCase();
  for (const [skill, aliases] of Object.entries(SKILLS)) {
    if (skill.toLowerCase() === lower || aliases.includes(lower)) return skill;
  }
  return s.trim();
}

export function skillSet(list: string[]): Set<string> {
  return new Set(list.map((s) => canonicalSkill(s).toLowerCase()));
}
