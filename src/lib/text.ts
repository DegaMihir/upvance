import crypto from "node:crypto";

const COMPANY_SUFFIXES =
  /\b(incorporated|inc|llc|ltd|limited|plc|gmbh|ag|bv|nv|sa|sas|srl|pvt|private|pte|corp|corporation|co|company|holdings|group)\b\.?/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(sr|snr)\b\.?/g, "senior")
    .replace(/\b(jr)\b\.?/g, "junior")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Remove tracking params, fragments and trailing slashes so the same job under different URLs can be spotted. */
export function canonicalizeUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.trim());
    u.hash = "";
    const drop = [/^utm_/i, /^gh_src$/i, /^source$/i, /^ref$/i, /^lever-/i, /^src$/i, /^trk/i, /^refId$/i, /^trackingId$/i];
    for (const key of Array.from(u.searchParams.keys())) {
      if (drop.some((r) => r.test(key))) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    u.protocol = "https:";
    let s = u.toString();
    s = s.replace(/\/(apply|application)\/?(\?|$)/i, "$2");
    return s.replace(/\/(\?|$)/, "$1");
  } catch {
    return url.trim();
  }
}

export function jobFingerprint(company: string, title: string, location: string) {
  const loc = location.toLowerCase().replace(/[^a-z]/g, "");
  return crypto
    .createHash("sha1")
    .update(`${normalizeCompany(company)}|${normalizeTitle(title)}|${loc}`)
    .digest("hex")
    .slice(0, 20);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    decodeEntities(html) // some APIs double-encode HTML
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export function hashKey(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
