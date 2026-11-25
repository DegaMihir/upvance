import { describe, expect, it } from "vitest";
import { countryPriority, splitTiers, OTHER_RANK } from "@/lib/matching/priority";
import { findCountries } from "@/lib/countries";
import { sortRows, type FeedRow } from "@/lib/feed";

const ORDER = ["US", "CA", "AU", "SG", "GB", "CH", "IE", "DE", "NL", "LU", "AE", "SA", "QA", "DK", "NO", "SE", "NZ", "HK", "BH", "KW"];
const T1 = 9;
const job = (category: string, countries: string[], remoteCountries: string[] = [], regions: string[] = []) => ({
  job: { remoteCategory: category },
  a: { locationCountries: countries, remote: { category, countries: remoteCountries, regions, evidence: [], confidence: "high" } } as never,
});

describe("Country priority", () => {
  it("ranks jobs by your country order and tier", () => {
    const us = job("Onsite", ["US"]);
    expect(countryPriority(us.job, us.a, ORDER, T1)).toEqual({ rank: 0, tier: 1, country: "US" });
    const ch = job("Hybrid", ["CH"]);
    expect(countryPriority(ch.job, ch.a, ORDER, T1)).toMatchObject({ rank: 5, tier: 1, country: "CH" });
    const kw = job("Onsite", ["KW"]);
    expect(countryPriority(kw.job, kw.a, ORDER, T1)).toMatchObject({ rank: 19, tier: 2, country: "KW" });
    const fr = job("Onsite", ["FR"]);
    expect(countryPriority(fr.job, fr.a, ORDER, T1)).toMatchObject({ rank: OTHER_RANK, tier: null });
  });

  it("remote jobs count as their best allowed country; worldwide remote comes right after Tier 1", () => {
    const usCa = job("Country-only", ["US"], ["CA", "US"]);
    expect(countryPriority(usCa.job, usCa.a, ORDER, T1).country).toBe("US");
    const europe = job("Region", [], [], ["Europe"]);
    expect(countryPriority(europe.job, europe.a, ORDER, T1)).toMatchObject({ country: "GB", tier: 1 }); // best European country in your list
    const nordics = job("Region", [], [], ["Nordics"]);
    expect(countryPriority(nordics.job, nordics.a, ORDER, T1)).toMatchObject({ country: "DK", tier: 2 });
    const ww = job("Worldwide", []);
    const r = countryPriority(ww.job, ww.a, ORDER, T1).rank;
    expect(r).toBeGreaterThan(8); // after the last Tier 1 country
    expect(r).toBeLessThan(9); // before the first Tier 2 country
  });

  it("splits the saved list into tiers", () => {
    expect(splitTiers(ORDER, T1).tier1).toEqual(["US", "CA", "AU", "SG", "GB", "CH", "IE", "DE", "NL"]);
    expect(splitTiers(ORDER, T1).tier2[0]).toBe("LU");
    expect(splitTiers(["US", "CA"], 0)).toEqual({ tier1: ["US", "CA"], tier2: [] });
  });

  it("recognises the newly added countries and cities", () => {
    for (const [text, code] of [["Doha, Qatar", "QA"], ["Copenhagen", "DK"], ["Oslo, Norway", "NO"], ["Luxembourg", "LU"], ["Manama", "BH"], ["Kuwait City", "KW"], ["Hong Kong SAR", "HK"], ["Toronto, ON", "CA"], ["Perth, WA", "AU"], ["Zurich", "CH"]] as const) {
      expect(findCountries(text), text).toContain(code);
    }
  });

  it("sorts the feed: your first country first (best match first inside it), ineligible last", () => {
    const row = (id: string, country: string, score: number, eligibility = "Eligible") =>
      ({ jobId: id, score, eligibility, job: { id, remoteCategory: "Onsite", postedAt: null, analysis: JSON.stringify({ version: 99, locationCountries: [country], remote: { category: "Onsite", countries: [], regions: [] } }), title: "x", location: "", description: "", company: { name: "Co", normalizedName: "co" } } }) as unknown as FeedRow;
    const rows = [row("de", "DE", 95), row("us-low", "US", 55), row("ca", "CA", 90), row("us-high", "US", 80), row("fr", "FR", 99), row("us-inel", "US", 99, "Ineligible")];
    const prio = { order: ORDER, tier1Count: T1 };
    expect(sortRows([...rows], {}, prio).map((r) => r.jobId)).toEqual(["us-high", "us-low", "ca", "de", "fr", "us-inel"]);
    expect(sortRows([...rows], { sort: "score" }, prio).map((r) => r.jobId)).toEqual(["fr", "de", "ca", "us-high", "us-low", "us-inel"]);
  });
});
