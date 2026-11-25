/**
 * Country visa overviews. Deliberately short and general: thresholds and rules
 * change often, so every page links to the official government source.
 * Update `lastChecked` when you re-verify the links.
 */
export interface VisaRoute {
  name: string;
  summary: string;
  url: string;
}
export interface CountryVisaInfo {
  code: string;
  name: string;
  lastChecked: string;
  overview: string;
  routes: VisaRoute[];
  sponsorList?: { name: string; url: string };
  tips: string[];
}

const CHECKED = "2026-11-14";

export const VISA_INFO: CountryVisaInfo[] = [
  {
    code: "US",
    name: "United States",
    lastChecked: CHECKED,
    overview: "Most employer-sponsored work in the US uses the H-1B specialty occupation visa, which is subject to an annual cap and lottery for most employers. Some employers (e.g. universities) are cap-exempt.",
    routes: [
      { name: "H-1B specialty occupations", summary: "Employer-sponsored; usually needs a relevant bachelor's degree or equivalent; annual registration and selection for cap-subject employers.", url: "https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations" },
      { name: "O-1 extraordinary ability", summary: "For people with sustained recognition in their field; employer or agent petitions.", url: "https://www.uscis.gov/working-in-the-united-states/temporary-workers/o-1-visa-individuals-with-extraordinary-ability-or-achievement" },
      { name: "L-1 intracompany transferee", summary: "Transfer from a related company abroad after at least a year of employment there.", url: "https://www.uscis.gov/working-in-the-united-states/temporary-workers/l-1a-intracompany-transferee-executive-or-manager" },
    ],
    sponsorList: { name: "USCIS H-1B Employer Data Hub", url: "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub" },
    tips: ["“Remote – US only” jobs almost always require existing US work authorization.", "Many US postings ask whether you will “now or in the future” need sponsorship – answer truthfully."],
  },
  {
    code: "GB",
    name: "United Kingdom",
    lastChecked: CHECKED,
    overview: "The Skilled Worker visa requires a job offer from a Home Office licensed sponsor, a certificate of sponsorship, and a role and salary that meet the current rules.",
    routes: [
      { name: "Skilled Worker visa", summary: "Employer must be a licensed sponsor; the job and salary must meet current eligibility rules.", url: "https://www.gov.uk/skilled-worker-visa" },
      { name: "Global Talent visa", summary: "For leaders or potential leaders in tech, research, arts and more; no job offer needed but endorsement is.", url: "https://www.gov.uk/global-talent" },
      { name: "High Potential Individual visa", summary: "For recent graduates of eligible top universities; no sponsor needed.", url: "https://www.gov.uk/high-potential-individual-visa" },
    ],
    sponsorList: { name: "Register of licensed sponsors: workers", url: "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" },
    tips: ["Being on the sponsor register doesn't mean a specific role is sponsored – ask.", "Check the current salary thresholds on gov.uk before applying."],
  },
  {
    code: "DE",
    name: "Germany",
    lastChecked: CHECKED,
    overview: "Germany offers the EU Blue Card for qualified professionals with a job offer meeting a salary threshold, plus routes for skilled workers and an Opportunity Card for job seekers.",
    routes: [
      { name: "EU Blue Card", summary: "Recognised degree (or IT experience in some cases) plus a qualifying job offer.", url: "https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card" },
      { name: "Opportunity Card (job search)", summary: "Points-based permit to come to Germany and look for work.", url: "https://www.make-it-in-germany.com/en/visa-residence/types/job-search-opportunity-card" },
      { name: "Skilled workers with academic training", summary: "Residence permit for qualified professionals with a job offer.", url: "https://www.make-it-in-germany.com/en/visa-residence/types/work-qualified-professionals" },
    ],
    tips: ["German employers don't “sponsor” the same way as UK/US ones – often the job offer plus your qualifications is enough.", "Have your degree recognition status (anabin) ready."],
  },
  {
    code: "NL",
    name: "Netherlands",
    lastChecked: CHECKED,
    overview: "The highly skilled migrant permit requires an employer that is recognised as a sponsor by the IND and a salary meeting the current criteria.",
    routes: [
      { name: "Highly skilled migrant", summary: "Employer must be an IND recognised sponsor; salary criteria apply.", url: "https://ind.nl/en/residence-permits/work/highly-skilled-migrant" },
      { name: "European Blue Card", summary: "Degree plus a qualifying job offer of at least 12 months (check current rules).", url: "https://ind.nl/en/residence-permits/work/european-blue-card" },
    ],
    sponsorList: { name: "IND public register of recognised sponsors", url: "https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants" },
    tips: ["Only recognised sponsors can use the fast highly-skilled-migrant route.", "Ask about the 30% ruling – it's a tax facility, not a visa."],
  },
  {
    code: "AE",
    name: "United Arab Emirates",
    lastChecked: CHECKED,
    overview: "Most expatriates work in the UAE on an employment visa arranged by the employer. Long-term Golden and Green visas exist for some professionals.",
    routes: [
      { name: "Employment / residence visas", summary: "Usually arranged by the employer; includes Emirates ID.", url: "https://u.ae/en/information-and-services/visa-and-emirates-id" },
      { name: "Golden visa", summary: "Long-term residence for eligible professionals, investors and talents.", url: "https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/golden-visa" },
    ],
    tips: ["Employer-arranged visas are standard; “visa provided” is common in UAE postings.", "Check free-zone vs mainland employer rules."],
  },
  {
    code: "CA",
    name: "Canada",
    lastChecked: CHECKED,
    overview: "Employer-specific work permits often need a positive Labour Market Impact Assessment (LMIA). Express Entry is the main permanent residence route for skilled workers.",
    routes: [
      { name: "Express Entry", summary: "Points-based permanent residence for skilled workers.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html" },
      { name: "Work permits (employer-specific)", summary: "Usually needs an LMIA or an LMIA exemption.", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit/temporary/about.html" },
      { name: "Global Talent Stream", summary: "Faster LMIA processing for some in-demand tech occupations.", url: "https://www.canada.ca/en/employment-social-development/services/foreign-workers/global-talent.html" },
    ],
    sponsorList: { name: "Positive LMIA employers list", url: "https://open.canada.ca/data/en/dataset/90fed587-1364-4f33-a9ee-208181dc0b97" },
    tips: ["A past positive LMIA shows the employer has hired foreign workers before – not that this role qualifies."],
  },
  {
    code: "AU",
    name: "Australia",
    lastChecked: CHECKED,
    overview: "Employer-sponsored temporary work uses the Skills in Demand visa (subclass 482). Points-tested skilled visas don't need a sponsor.",
    routes: [
      { name: "Skills in Demand visa (subclass 482)", summary: "Employer-sponsored temporary skilled visa.", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-482" },
      { name: "Skilled Independent (subclass 189)", summary: "Points-tested permanent visa; invitation required.", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skilled-independent-189" },
    ],
    tips: ["“Full Australian working rights required” means the employer won't sponsor."],
  },
  {
    code: "IE",
    name: "Ireland",
    lastChecked: CHECKED,
    overview: "Ireland issues employment permits; the Critical Skills Employment Permit covers many tech roles and leads to a faster path to residence.",
    routes: [
      { name: "Critical Skills Employment Permit", summary: "For occupations on the critical skills list with a qualifying offer.", url: "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/critical-skills-employment-permit/" },
      { name: "General Employment Permit", summary: "Broader permit; a labour market needs test may apply.", url: "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/general-employment-permit/" },
    ],
    tips: ["Employment permits are applied for by you or the employer – ask who handles it."],
  },
];

export function visaInfo(code: string) {
  return VISA_INFO.find((v) => v.code === code.toUpperCase()) ?? null;
}
