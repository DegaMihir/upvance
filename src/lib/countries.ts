/** Countries and regions used for location/remote eligibility. ISO-ish codes. */
export const COUNTRIES: Record<string, { name: string; aliases: string[]; region: string[] }> = {
  US: { name: "United States", aliases: ["united states", "usa", "u.s.", "u.s.a", "us", "america", "us-based", "us based"], region: ["North America", "Americas"] },
  CA: { name: "Canada", aliases: ["canada", "canadian", "toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary", "waterloo"], region: ["North America", "Americas"] },
  MX: { name: "Mexico", aliases: ["mexico"], region: ["LATAM", "Americas"] },
  BR: { name: "Brazil", aliases: ["brazil", "brasil"], region: ["LATAM", "Americas"] },
  AR: { name: "Argentina", aliases: ["argentina"], region: ["LATAM", "Americas"] },
  GB: { name: "United Kingdom", aliases: ["united kingdom", "uk", "u.k.", "england", "london", "scotland", "wales", "great britain", "britain"], region: ["Europe", "EMEA"] },
  IE: { name: "Ireland", aliases: ["ireland", "dublin"], region: ["Europe", "EU", "EMEA"] },
  DE: { name: "Germany", aliases: ["germany", "deutschland", "berlin", "munich", "münchen", "hamburg", "frankfurt"], region: ["Europe", "EU", "EMEA"] },
  NL: { name: "Netherlands", aliases: ["netherlands", "the netherlands", "holland", "amsterdam", "rotterdam", "utrecht", "eindhoven"], region: ["Europe", "EU", "EMEA"] },
  FR: { name: "France", aliases: ["france", "paris"], region: ["Europe", "EU", "EMEA"] },
  ES: { name: "Spain", aliases: ["spain", "madrid", "barcelona"], region: ["Europe", "EU", "EMEA"] },
  PT: { name: "Portugal", aliases: ["portugal", "lisbon"], region: ["Europe", "EU", "EMEA"] },
  IT: { name: "Italy", aliases: ["italy", "milan", "rome"], region: ["Europe", "EU", "EMEA"] },
  PL: { name: "Poland", aliases: ["poland", "warsaw", "krakow"], region: ["Europe", "EU", "EMEA"] },
  SE: { name: "Sweden", aliases: ["sweden", "stockholm", "gothenburg", "malmö", "malmo"], region: ["Europe", "EU", "EMEA", "Nordics"] },
  CH: { name: "Switzerland", aliases: ["switzerland", "zurich", "zürich", "geneva"], region: ["Europe", "EMEA"] },
  AE: { name: "United Arab Emirates", aliases: ["united arab emirates", "uae", "dubai", "abu dhabi"], region: ["Middle East", "EMEA"] },
  SA: { name: "Saudi Arabia", aliases: ["saudi arabia", "riyadh"], region: ["Middle East", "EMEA"] },
  IN: { name: "India", aliases: ["india", "bangalore", "bengaluru", "mumbai", "delhi", "hyderabad", "pune", "chennai", "gurgaon", "gurugram", "noida"], region: ["APAC", "Asia"] },
  SG: { name: "Singapore", aliases: ["singapore"], region: ["APAC", "Asia"] },
  JP: { name: "Japan", aliases: ["japan", "tokyo"], region: ["APAC", "Asia"] },
  AU: { name: "Australia", aliases: ["australia", "sydney", "melbourne", "brisbane", "perth", "canberra", "adelaide"], region: ["APAC"] },
  NZ: { name: "New Zealand", aliases: ["new zealand", "auckland", "wellington", "christchurch"], region: ["APAC"] },
  PK: { name: "Pakistan", aliases: ["pakistan", "karachi", "lahore"], region: ["APAC", "Asia"] },
  NG: { name: "Nigeria", aliases: ["nigeria", "lagos"], region: ["Africa", "EMEA"] },
  ZA: { name: "South Africa", aliases: ["south africa", "cape town", "johannesburg"], region: ["Africa", "EMEA"] },
  PH: { name: "Philippines", aliases: ["philippines", "manila"], region: ["APAC", "Asia"] },
  LU: { name: "Luxembourg", aliases: ["luxembourg"], region: ["Europe", "EU", "EMEA"] },
  DK: { name: "Denmark", aliases: ["denmark", "copenhagen", "aarhus"], region: ["Europe", "EU", "EMEA", "Nordics"] },
  NO: { name: "Norway", aliases: ["norway", "oslo", "bergen"], region: ["Europe", "EMEA", "Nordics"] },
  QA: { name: "Qatar", aliases: ["qatar", "doha"], region: ["Middle East", "EMEA"] },
  BH: { name: "Bahrain", aliases: ["bahrain", "manama"], region: ["Middle East", "EMEA"] },
  KW: { name: "Kuwait", aliases: ["kuwait"], region: ["Middle East", "EMEA"] },
  HK: { name: "Hong Kong", aliases: ["hong kong", "hongkong"], region: ["APAC", "Asia"] },
};
export const REGIONS: Record<string, string[]> = {
  Europe: ["europe", "european", "emea", "eu"],
  EU: ["eu", "european union"],
  EMEA: ["emea"],
  "North America": ["north america"],
  Americas: ["americas"],
  LATAM: ["latam", "latin america", "south america"],
  APAC: ["apac", "asia pacific", "asia-pacific"],
  Asia: ["asia"],
  "Middle East": ["middle east", "mena", "gcc"],
  Africa: ["africa"],
  Nordics: ["nordics", "nordic", "scandinavia", "scandinavian"],
};

export const COUNTRY_OPTIONS = Object.entries(COUNTRIES).map(([code, c]) => ({ code, name: c.name }));

/** Resolve a free-text country (name, code or alias) to a code. */
export function countryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (COUNTRIES[upper]) return upper;
  if (upper === "UK") return "GB";
  for (const [code, c] of Object.entries(COUNTRIES)) {
    if (c.name.toLowerCase() === s || c.aliases.includes(s)) return code;
  }
  return null;
}

export function countryName(code: string) {
  return COUNTRIES[code]?.name ?? code;
}

/** Find country codes mentioned in a text. Short aliases (us, uk, uae) need word boundaries. */
export function findCountries(text: string): string[] {
  const t = " " + text.toLowerCase() + " ";
  const found = new Set<string>();
  for (const [code, c] of Object.entries(COUNTRIES)) {
    for (const a of c.aliases) {
      const short = a.length <= 3;
      const re = short
        ? new RegExp(`(^|[^a-z])${a.replace(/\./g, "\\.")}(?=[^a-z]|$)`)
        : new RegExp(`\\b${a.replace(/\./g, "\\.")}\\b`);
      if (short && a === "us") {
        // avoid "contact us", "join us", "about us", "with us"
        if (/\b(remote|based|only|within the|in the|across the)\s*[-–(]?\s*us\b|\bus[- ](only|based|citizens?|time ?zones?|residents?)\b|\(us\)|(?<!\b(?:contact|join|email|call|tell|help|with|about|reach|for|let|give|send|follow|visit|ask|write|to|from|and|of|lets)\s)\bus,|\/us\b|,\s*us\s*(?:$|[\/;|)·])/i.test(text)) found.add(code);
        continue;
      }
      if (re.test(t)) {
        found.add(code);
        break;
      }
    }
  }
  return Array.from(found);
}

export function findRegions(text: string): string[] {
  const t = text.toLowerCase();
  return Object.entries(REGIONS)
    .filter(([, aliases]) => aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t)))
    .map(([r]) => r);
}

export function countryInRegion(code: string, region: string) {
  return COUNTRIES[code]?.region.includes(region) ?? false;
}
