/**
 * Demo data so the app works before any keys are added.
 * All companies, people and jobs here are fictional; URLs use example.com.
 */
import type { ResumeDoc } from "../resume/document";

export const DEMO_EMAIL = "demo@upvance.local";
export const DEMO_PASSWORD = "demo12345";

export const sampleResume: ResumeDoc = {
  name: "Aarav Mehta",
  headline: "Machine Learning Engineer",
  contact: {
    email: "aarav.mehta@example.com",
    phone: "+91 98450 12345",
    location: "Bengaluru, India",
    linkedin: "linkedin.com/in/aarav-mehta-demo",
    website: "github.com/aarav-demo",
  },
  summary:
    "Machine learning engineer with 6 years of experience building NLP and recommendation systems in production. I take models from notebook to monitored service, and I care about clean data pipelines and measurable impact.",
  skills: ["Python", "PyTorch", "TensorFlow", "scikit-learn", "Machine Learning", "Deep Learning", "NLP", "LLMs", "SQL", "Pandas", "Spark", "Airflow", "AWS", "Docker", "Kubernetes", "MLOps", "FastAPI", "Git", "Statistics"],
  experiences: [
    {
      title: "Senior Machine Learning Engineer",
      company: "Saffron Commerce",
      location: "Bengaluru, India",
      start: "2022-03",
      end: "Present",
      bullets: [
        "Built a product search ranking model in PyTorch that increased click-through rate by 12% across 40 million monthly sessions.",
        "Designed an LLM-based support ticket classifier with retrieval-augmented generation, cutting manual triage time by 35%.",
        "Led migration of 14 batch models to a Kubernetes-based serving platform with automated monitoring and rollback.",
        "Mentored 3 junior engineers and ran fortnightly model review sessions.",
      ],
    },
    {
      title: "Machine Learning Engineer",
      company: "Indus Analytics",
      location: "Pune, India",
      start: "2019-07",
      end: "2022-02",
      bullets: [
        "Developed demand forecasting models with scikit-learn and Spark for 1,200 retail stores.",
        "Built Airflow pipelines processing 2 TB of daily transaction data on AWS.",
        "Shipped a FastAPI inference service handling 300 requests per second with p95 latency under 80 ms.",
      ],
    },
    {
      title: "Data Analyst",
      company: "Lotus Fintech",
      location: "Mumbai, India",
      start: "2018-06",
      end: "2019-06",
      bullets: ["Wrote SQL reports and dashboards for the credit risk team.", "Automated weekly portfolio analysis in Python and Pandas."],
    },
  ],
  education: [{ degree: "B.Tech", field: "Computer Science and Engineering", school: "National Institute of Technology Karnataka", start: "2014", end: "2018" }],
  certifications: ["AWS Certified Machine Learning – Specialty"],
  projects: [{ name: "open-ner-lite", description: "Open-source lightweight named entity recognition library for Indian English text.", link: "github.com/aarav-demo/open-ner-lite" }],
};

export const softwareResume: ResumeDoc = {
  ...sampleResume,
  headline: "Backend & ML Software Engineer",
  summary:
    "Software engineer with 6 years of experience shipping Python services and data platforms. Comfortable owning APIs, pipelines and deployment end to end.",
  skills: ["Python", "SQL", "FastAPI", "Docker", "Kubernetes", "AWS", "Airflow", "Spark", "Git", "Machine Learning", "Pandas", "REST APIs"],
};

export interface DemoJob {
  key: string;
  company: string;
  title: string;
  location: string;
  daysAgo: number;
  ats: string;
  employmentType?: string;
  salary?: [number, number, string];
  description: string;
}

const benefits = "\n\nWhat we offer\n• Learning budget\n• Flexible hours\n• Private health insurance";

export const demoJobs: DemoJob[] = [
  {
    key: "northwind-sr-mle",
    company: "Northwind Analytics",
    title: "Senior Machine Learning Engineer",
    location: "London, United Kingdom (Hybrid)",
    daysAgo: 1,
    ats: "greenhouse",
    salary: [85000, 110000, "GBP"],
    description: `Northwind Analytics builds forecasting tools used by 300 retailers across Europe.

What you'll do
• Design, train and deploy machine learning models for demand forecasting and pricing
• Own models end to end: data pipelines, training, serving and monitoring
• Work with product managers to turn business questions into ML problems
• Improve our MLOps tooling on AWS and Kubernetes

What we're looking for
• 5+ years of experience building production machine learning systems
• Strong Python and PyTorch or TensorFlow
• Experience with SQL, Spark or Airflow
• Experience with Docker and Kubernetes
• Clear written communication

This is a hybrid role: 2 days a week in our London office.
We offer Skilled Worker visa sponsorship for this role and support with relocation to the UK.
Feel free to include a cover letter telling us why this role interests you.${benefits}`,
  },
  {
    key: "helio-ai-perception",
    company: "Helio Robotics",
    title: "AI Engineer, Perception",
    location: "Remote – US",
    daysAgo: 2,
    ats: "lever",
    salary: [160000, 200000, "USD"],
    description: `Helio Robotics makes autonomous inspection drones.

Responsibilities
• Build deep learning models for object detection and tracking
• Optimise models for edge deployment
• Collaborate with hardware and robotics teams

Requirements
• 4+ years of experience with deep learning and computer vision
• Python, PyTorch
• Experience with Docker and CI/CD

This is a fully remote position, but you must be based in the United States. We can only hire people living in the US.`,
  },
  {
    key: "kestrel-defense-ml",
    company: "Kestrel Security",
    title: "Senior ML Engineer, Threat Detection",
    location: "Arlington, VA, United States",
    daysAgo: 1,
    ats: "workday",
    salary: [170000, 210000, "USD"],
    description: `Kestrel Security protects critical infrastructure using machine learning.

What you'll do
• Build NLP and LLM-based models that detect threats in large text and log streams
• Deploy and monitor models on AWS with Docker and Kubernetes
• Design training data pipelines with Spark and Airflow
• Mentor engineers and lead model reviews

Requirements
• 5+ years of experience in machine learning engineering
• Python, PyTorch, scikit-learn, SQL, Pandas
• Experience with MLOps, deep learning and statistics
• Experience with FastAPI or similar frameworks

Applicants must be U.S. citizens and hold an active Secret security clearance. Onsite in Arlington, VA.`,
  },
  {
    key: "fernleaf-recs",
    company: "Fernleaf Studios",
    title: "Machine Learning Engineer, Recommendations",
    location: "Remote – Worldwide",
    daysAgo: 3,
    ats: "ashby",
    salary: [90000, 130000, "USD"],
    description: `Fernleaf Studios makes mobile games played by 20 million people. We are a fully distributed company and hire people anywhere in the world.

What you'll do
• Build recommendation and ranking models for in-game content
• Run A/B testing and experimentation with the product team
• Maintain feature pipelines in Python, SQL and Airflow

About you
• 3+ years of experience with machine learning in production
• Python, scikit-learn or PyTorch, SQL
• Statistics and experimentation experience

You can work from anywhere: we pay through an employer-of-record or as a contractor in your country.`,
  },
  {
    key: "quanta-ds",
    company: "Quanta Ledger",
    title: "Data Scientist",
    location: "Amsterdam, Netherlands",
    daysAgo: 4,
    ats: "greenhouse",
    salary: [65000, 85000, "EUR"],
    description: `Quanta Ledger builds accounting automation for small businesses.

Your role
• Analyse transaction data to find patterns and automation opportunities
• Build classification models with Python and scikit-learn
• Present insights to product and leadership

Requirements
• 3+ years as a data scientist
• Python, Pandas, SQL, statistics
• Experience with machine learning

Office-based in Amsterdam, 4 days per week.`,
  },
  {
    key: "lumen-mlplatform",
    company: "Lumen Mobility",
    title: "ML Platform Engineer",
    location: "Berlin, Germany (Hybrid)",
    daysAgo: 2,
    ats: "personio",
    salary: [75000, 95000, "EUR"],
    description: `Lumen Mobility runs electric scooter fleets in 40 European cities.

What you'll do
• Build our ML platform: feature store, training pipelines and model serving
• Run Kubernetes workloads and improve our CI/CD for models
• Support data scientists in shipping models safely

What you bring
• 4+ years of experience in MLOps or platform engineering
• Python, Docker, Kubernetes, Terraform, AWS
• Experience with Airflow or similar orchestration

Hybrid in Berlin. We provide relocation support and EU Blue Card visa sponsorship for international hires.`,
  },
  {
    key: "orbital-backend",
    company: "Orbital Freight",
    title: "Software Engineer, Backend",
    location: "Toronto, Canada",
    daysAgo: 6,
    ats: "lever",
    salary: [110000, 140000, "CAD"],
    description: `Orbital Freight is a digital freight brokerage.

Responsibilities
• Build REST APIs and services in Python and Go
• Design PostgreSQL schemas and data pipelines
• Improve reliability and observability

Requirements
• 3+ years of backend development experience
• Python, SQL, Docker, REST APIs
• Experience with AWS

This role is onsite in Toronto. Visa sponsorship is considered on a case-by-case basis for exceptional candidates.`,
  },
  {
    key: "brightpath-nlp",
    company: "Brightpath Health",
    title: "NLP Engineer",
    location: "Boston, MA, United States",
    daysAgo: 5,
    ats: "greenhouse",
    salary: [150000, 180000, "USD"],
    description: `Brightpath Health uses NLP to summarise clinical notes.

What you'll do
• Train and evaluate NLP and LLM models on clinical text
• Build data pipelines and evaluation tooling

Requirements
• 3+ years of NLP experience
• Python, PyTorch, LLMs
• Experience with AWS

Onsite in Boston. We are unable to sponsor visas now or in the future; candidates must be authorized to work in the US without sponsorship.`,
  },
  {
    key: "nimbus-mlops",
    company: "Nimbus Cloudworks",
    title: "MLOps Engineer",
    location: "Remote (Europe)",
    daysAgo: 3,
    ats: "workable",
    salary: [70000, 90000, "EUR"],
    description: `Nimbus Cloudworks is a cloud cost optimisation platform.

Responsibilities
• Operate model training and serving infrastructure on Kubernetes
• Automate deployments with CI/CD and Terraform

Requirements
• 3+ years of MLOps or DevOps experience
• Kubernetes, Docker, Python, AWS or GCP

This is a remote role open to candidates located in Europe (EU/UK time zones). You must be based in Europe.`,
  },
  {
    key: "arcadia-llm",
    company: "Arcadia Learning",
    title: "Applied Scientist, LLMs",
    location: "Dublin, Ireland",
    daysAgo: 2,
    ats: "ashby",
    salary: [80000, 105000, "EUR"],
    description: `Arcadia Learning builds AI tutors for secondary schools.

What you'll do
• Fine-tune and evaluate large language models for tutoring
• Build retrieval-augmented generation pipelines
• Design evaluation datasets with teachers

What we're looking for
• 3+ years of experience in NLP or machine learning
• Python, PyTorch, LLMs, statistics
• A degree in computer science, maths or a related field

Based in our Dublin office (hybrid, 3 days a week).`,
  },
  {
    key: "copperline-de",
    company: "Copperline Payments",
    title: "Senior Data Engineer",
    location: "London, United Kingdom",
    daysAgo: 7,
    ats: "greenhouse",
    salary: [80000, 100000, "GBP"],
    description: `Copperline Payments processes card payments for online merchants.

Responsibilities
• Build batch and streaming pipelines with Spark, Kafka and Airflow
• Model data in our warehouse with dbt and SQL

Requirements
• 5+ years of data engineering experience
• Python, SQL, Spark, Airflow, Kafka

Onsite in London. Please note: visa sponsorship is only available for existing employees transferring internally.`,
  },
  {
    key: "tidewater-ai",
    company: "Tidewater Energy",
    title: "AI Engineer",
    location: "Dubai, United Arab Emirates",
    daysAgo: 4,
    ats: "unknown",
    description: `Tidewater Energy operates solar plants across the Middle East.

What you'll do
• Build forecasting and anomaly detection models for solar output
• Deploy models with Docker on AWS
• Work with engineers on-site

Requirements
• 3+ years of machine learning experience
• Python, scikit-learn, Pandas, SQL
• Experience with time series

Onsite in Dubai. Visa sponsorship and a relocation package are provided for international hires.`,
  },
  {
    key: "saffron-mle",
    company: "Saffron Systems",
    title: "Machine Learning Engineer",
    location: "Bengaluru, India (Hybrid)",
    daysAgo: 1,
    ats: "lever",
    salary: [3500000, 5000000, "INR"],
    description: `Saffron Systems builds conversational AI for banks.

What you'll do
• Build NLP and LLM features for customer support chatbots
• Deploy models with FastAPI, Docker and Kubernetes
• Monitor models in production

Requirements
• 4+ years of machine learning experience
• Python, PyTorch, NLP, LLMs
• Experience with MLOps

Hybrid role in Bengaluru, India.`,
  },
  {
    key: "northwind-analyst",
    company: "Northwind Analytics",
    title: "Junior Data Analyst",
    location: "London, United Kingdom",
    daysAgo: 9,
    ats: "greenhouse",
    salary: [35000, 42000, "GBP"],
    description: `Join our analytics team.

Responsibilities
• Build dashboards in Tableau
• Answer business questions with SQL and Excel

Requirements
• 1+ years of experience in analytics
• SQL, Tableau, Excel

Onsite in London. We offer Skilled Worker visa sponsorship.`,
  },
  {
    key: "helio-cv",
    company: "Helio Robotics",
    title: "Computer Vision Engineer",
    location: "San Francisco, CA, United States",
    daysAgo: 3,
    ats: "workday",
    salary: [165000, 205000, "USD"],
    description: `Helio Robotics makes autonomous inspection drones.

What you'll do
• Develop computer vision and deep learning models for defect detection
• Optimise inference on embedded GPUs

Requirements
• 4+ years of experience in computer vision or deep learning
• Python, PyTorch, C++
• Docker

Onsite in San Francisco. We sponsor H-1B visas for this role.`,
  },
  {
    key: "granite-mle",
    company: "Granite Bay Insurance",
    title: "Machine Learning Engineer",
    location: "Sydney, Australia",
    daysAgo: 5,
    ats: "unknown",
    salary: [150000, 180000, "AUD"],
    description: `Granite Bay Insurance is modernising claims processing.

Responsibilities
• Build machine learning models for claims triage
• Deploy models on AWS

Requirements
• 3+ years of experience in machine learning
• Python, scikit-learn, SQL, AWS

Hybrid in Sydney. Applicants must have full Australian working rights; we are not able to offer sponsorship.`,
  },
  {
    key: "fernleaf-go",
    company: "Fernleaf Studios",
    title: "Senior Backend Engineer (Go)",
    location: "Remote",
    daysAgo: 8,
    ats: "ashby",
    description: `Fernleaf Studios is hiring a backend engineer for our game services team.

What you'll do
• Build game backend services in Go
• Scale our matchmaking and leaderboard systems

Requirements
• 5+ years of backend experience
• Golang, PostgreSQL, Redis, Kubernetes

This is a remote role.`,
  },
  {
    key: "arcadia-sr-mle",
    company: "Arcadia Learning",
    title: "Senior ML Engineer",
    location: "Remote – US or Canada",
    daysAgo: 6,
    ats: "ashby",
    description: `Arcadia Learning is growing its North American team.

Responsibilities
• Build and ship ML features for our tutoring product
• Own model serving and monitoring

Requirements
• 5+ years of experience in machine learning
• Python, PyTorch, AWS, MLOps

Remote, but you must reside in the United States or Canada.`,
  },
  {
    key: "lumen-pricing",
    company: "Lumen Mobility",
    title: "Data Scientist, Pricing",
    location: "Munich, Germany",
    daysAgo: 10,
    ats: "personio",
    salary: [70000, 88000, "EUR"],
    description: `Lumen Mobility runs electric scooter fleets in 40 European cities.

Your role
• Build dynamic pricing models
• Design experiments and analyse results

Requirements
• 3+ years in data science
• Python, statistics, SQL, A/B testing
• Experience with machine learning

Office-based in Munich. A cover letter is required: please tell us about a pricing or experimentation problem you solved.`,
  },
  {
    key: "quanta-llm",
    company: "Quanta Ledger",
    title: "LLM Engineer",
    location: "Amsterdam, Netherlands (Hybrid)",
    daysAgo: 1,
    ats: "greenhouse",
    salary: [75000, 95000, "EUR"],
    description: `Quanta Ledger is building an AI bookkeeping assistant.

What you'll do
• Build LLM-powered features: document extraction, retrieval-augmented generation and agents
• Evaluate and monitor model quality in production
• Work with backend engineers on FastAPI services

What we're looking for
• 3+ years of experience with machine learning or NLP
• Python, LLMs, NLP, PyTorch
• Experience with Docker and AWS

Hybrid in Amsterdam. We are a recognised sponsor with the IND and will sponsor your highly skilled migrant visa. Please include a cover letter with your application.`,
  },
];

export const demoCompanies: Record<string, { size: string; industry: string; headquarters: string; website: string }> = {
  "Northwind Analytics": { size: "201–500", industry: "Retail analytics", headquarters: "London, UK", website: "https://example.com/northwind" },
  "Helio Robotics": { size: "501–1000", industry: "Robotics", headquarters: "San Francisco, US", website: "https://example.com/helio" },
  "Kestrel Security": { size: "1001–5000", industry: "Cybersecurity", headquarters: "Arlington, US", website: "https://example.com/kestrel" },
  "Fernleaf Studios": { size: "51–200", industry: "Gaming", headquarters: "Distributed", website: "https://example.com/fernleaf" },
  "Quanta Ledger": { size: "201–500", industry: "Fintech / accounting", headquarters: "Amsterdam, NL", website: "https://example.com/quanta" },
  "Lumen Mobility": { size: "501–1000", industry: "Mobility", headquarters: "Berlin, DE", website: "https://example.com/lumen" },
  "Orbital Freight": { size: "201–500", industry: "Logistics", headquarters: "Toronto, CA", website: "https://example.com/orbital" },
  "Brightpath Health": { size: "201–500", industry: "Health tech", headquarters: "Boston, US", website: "https://example.com/brightpath" },
  "Nimbus Cloudworks": { size: "51–200", industry: "Cloud software", headquarters: "Lisbon, PT", website: "https://example.com/nimbus" },
  "Arcadia Learning": { size: "201–500", industry: "Education", headquarters: "Dublin, IE", website: "https://example.com/arcadia" },
  "Copperline Payments": { size: "1001–5000", industry: "Payments", headquarters: "London, UK", website: "https://example.com/copperline" },
  "Tidewater Energy": { size: "1001–5000", industry: "Energy", headquarters: "Dubai, AE", website: "https://example.com/tidewater" },
  "Saffron Systems": { size: "201–500", industry: "Conversational AI", headquarters: "Bengaluru, IN", website: "https://example.com/saffron" },
  "Granite Bay Insurance": { size: "5000+", industry: "Insurance", headquarters: "Sydney, AU", website: "https://example.com/granitebay" },
};

/** Demo sponsor list records (clearly marked as demo; replaced when real lists are imported). */
export const demoSponsors: { list: "UK" | "US" | "NL" | "CA"; name: string; city: string; route: string }[] = [
  { list: "UK", name: "Northwind Analytics Ltd", city: "London", route: "Skilled Worker" },
  { list: "UK", name: "Copperline Payments Limited", city: "London", route: "Skilled Worker" },
  { list: "US", name: "Helio Robotics Inc", city: "San Francisco", route: "H-1B" },
  { list: "US", name: "Kestrel Security Corp", city: "Arlington", route: "H-1B" },
  { list: "NL", name: "Quanta Ledger B.V.", city: "Amsterdam", route: "Highly skilled migrant" },
  { list: "CA", name: "Orbital Freight Inc", city: "Toronto", route: "LMIA – High-wage" },
];

/** Historical applications for the demo dashboard (outcomes over the last ~8 weeks). */
export const demoHistory: { company: string; title: string; location: string; daysAgo: number; status: string; profile: "AI resume" | "Software resume"; origin: "manual" | "auto" }[] = [
  { company: "Pinecrest Bank", title: "ML Engineer", location: "London, United Kingdom", daysAgo: 52, status: "Rejected", profile: "AI resume", origin: "manual" },
  { company: "Pinecrest Bank", title: "Data Scientist", location: "London, United Kingdom", daysAgo: 50, status: "No response", profile: "AI resume", origin: "manual" },
  { company: "Veridian Labs", title: "NLP Engineer", location: "Amsterdam, Netherlands", daysAgo: 45, status: "Interview", profile: "AI resume", origin: "manual" },
  { company: "Atlas Logistics", title: "Backend Engineer", location: "Toronto, Canada", daysAgo: 41, status: "No response", profile: "Software resume", origin: "auto" },
  { company: "Mosaic Retail", title: "Machine Learning Engineer", location: "Berlin, Germany", daysAgo: 37, status: "Assessment", profile: "AI resume", origin: "auto" },
  { company: "Harbor AI", title: "LLM Engineer", location: "Remote – Worldwide", daysAgo: 30, status: "Offer", profile: "AI resume", origin: "manual" },
  { company: "Cobalt Systems", title: "Python Developer", location: "Dublin, Ireland", daysAgo: 26, status: "Rejected", profile: "Software resume", origin: "auto" },
  { company: "Summit Health", title: "Data Engineer", location: "London, United Kingdom", daysAgo: 21, status: "No response", profile: "Software resume", origin: "auto" },
  { company: "Juniper Ads", title: "ML Engineer, Ranking", location: "Amsterdam, Netherlands", daysAgo: 16, status: "Recruiter response", profile: "AI resume", origin: "manual" },
  { company: "Orchid Telecom", title: "MLOps Engineer", location: "Berlin, Germany", daysAgo: 12, status: "Submitted", profile: "AI resume", origin: "auto" },
  { company: "Delta Grid", title: "Software Engineer", location: "Toronto, Canada", daysAgo: 8, status: "Rejected", profile: "Software resume", origin: "manual" },
  { company: "Harbor AI", title: "Senior ML Engineer", location: "Remote – Worldwide", daysAgo: 5, status: "Submitted", profile: "AI resume", origin: "manual" },
];
