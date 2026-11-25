import { db } from "../db";
import { normalizeCompany } from "../text";
import type { Confidence, JobAnalysis, SponsorshipCategory } from "../analysis/types";

export const SPONSOR_LISTS = {
  UK: { country: "GB", name: "UK Register of licensed sponsors (workers)", sourceUrl: "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" },
  US: { country: "US", name: "USCIS H-1B Employer Data Hub", sourceUrl: "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub" },
  NL: { country: "NL", name: "IND public register of recognised sponsors", sourceUrl: "https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants" },
  CA: { country: "CA", name: "Canada positive LMIA employers list", sourceUrl: "https://open.canada.ca/data/en/dataset/90fed587-1364-4f33-a9ee-208181dc0b97" },
} as const;
export type SponsorListId = keyof typeof SPONSOR_LISTS;

export interface SponsorHit {
  listId: SponsorListId;
  country: string;
  name: string;
  route: string;
  city: string;
  confidence: Confidence;
  lastUpdated: Date | null;
  sourceUrl: string;
  isDemo: boolean;
}

export async function sponsorHitsForCompany(companyName: string): Promise<SponsorHit[]> {
  const n = normalizeCompany(companyName);
  if (!n) return [];
  const exact = await db.sponsorRecord.findMany({ where: { normalizedName: n }, take: 20 });
  const fuzzy = exact.length
    ? []
    : n.length >= 4
      ? await db.sponsorRecord.findMany({ where: { normalizedName: { startsWith: n + " " } }, take: 10 })
      : [];
  const lists = await db.sponsorList.findMany();
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const hits: SponsorHit[] = [];
  for (const [records, confidence] of [
    [exact, "high"],
    [fuzzy, "medium"],
  ] as const) {
    for (const r of records) {
      const key = `${r.listId}|${r.normalizedName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = SPONSOR_LISTS[r.listId as SponsorListId];
      if (!meta) continue;
      const list = listMap.get(r.listId);
      hits.push({
        listId: r.listId as SponsorListId,
        country: meta.country,
        name: r.name,
        route: r.route,
        city: r.city,
        confidence,
        lastUpdated: list?.lastUpdated ?? null,
        sourceUrl: list?.sourceUrl ?? meta.sourceUrl,
        isDemo: list?.status === "demo",
      });
    }
  }
  return hits;
}

/**
 * Combine posting wording with official sponsor lists:
 * - explicit "no sponsorship" in the posting always wins
 * - explicit confirmed / case-by-case wording is kept
 * - "Unknown" becomes "Likely" when the employer is a licensed sponsor in the job's country
 */
export function combineSponsorship(
  fromText: JobAnalysis["sponsorship"],
  hits: SponsorHit[],
  jobCountries: string[],
): JobAnalysis["sponsorship"] & { officialLists?: { list: string; country: string; confidence: Confidence; demo: boolean }[] } {
  const relevant = hits.filter((h) => !jobCountries.length || jobCountries.includes(h.country));
  const officialLists = hits.map((h) => ({ list: SPONSOR_LISTS[h.listId].name, country: h.country, confidence: h.confidence, demo: h.isDemo }));
  if (fromText.category !== "Unknown" && fromText.category !== "Likely") return { ...fromText, officialLists };
  if (relevant.length) {
    const best = relevant.find((h) => h.confidence === "high") ?? relevant[0];
    const category: SponsorshipCategory = "Likely";
    return {
      category,
      existingEmployeesOnly: false,
      evidence: [
        ...fromText.evidence,
        `${best.name} appears on the ${SPONSOR_LISTS[best.listId].name}${best.route ? ` (${best.route})` : ""}${best.isDemo ? " [demo data]" : ""}. Being a licensed sponsor doesn't guarantee this role is sponsored.`,
      ],
      confidence: best.confidence === "high" ? "medium" : "low",
      officialLists,
    };
  }
  return { ...fromText, officialLists };
}
