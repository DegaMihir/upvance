/**
 * Official sponsor list importers. Each downloads the public file from the
 * government source, parses it and replaces the stored records.
 * If an automatic download fails (sites change their layout), the user can
 * download the file manually and import it from the Sponsors page.
 */
import { db } from "../db";
import { csvObjects } from "../csv";
import { normalizeCompany, stripHtml } from "../text";
import { SPONSOR_LISTS, type SponsorListId } from "./lookup";

export interface SponsorRow {
  name: string;
  city?: string;
  route?: string;
  extra?: string;
}

const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UpvanceLocal/1.0 (personal job-search assistant)" };

async function get(url: string, accept = "*/*") {
  const res = await fetch(url, { headers: { ...UA, accept }, signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res;
}

function pick(obj: Record<string, string>, re: RegExp) {
  const k = Object.keys(obj).find((h) => re.test(h));
  return k ? obj[k] : "";
}

// ---- Parsers (also used for manual file imports) ----
export function parseUkCsv(text: string): SponsorRow[] {
  return csvObjects(text, /organisation name/i)
    .map((o) => ({ name: pick(o, /organisation name/i), city: pick(o, /town|city/i), route: pick(o, /^route/i), extra: pick(o, /type.*rating/i) }))
    .filter((r) => r.name);
}

export function parseUsCsv(text: string): SponsorRow[] {
  const objs = csvObjects(text, /employer/i);
  const byName = new Map<string, SponsorRow & { approvals: number }>();
  for (const o of objs) {
    const name = pick(o, /employer.*name|^employer( \(petitioner\))?( name)?$/i) || pick(o, /employer/i);
    if (!name) continue;
    const approvals = ["initial approval", "continuing approval", "new employment approval", "continuation approval"]
      .map((h) => Number(pick(o, new RegExp(h, "i")).replace(/[^0-9]/g, "")) || 0)
      .reduce((a, b) => a + b, 0);
    const key = normalizeCompany(name);
    const prev = byName.get(key);
    const year = pick(o, /fiscal year/i);
    if (prev) prev.approvals += approvals;
    else byName.set(key, { name, city: pick(o, /city/i), route: "H-1B", extra: year ? `FY${year}` : "", approvals });
  }
  return Array.from(byName.values()).map(({ approvals, ...r }) => ({ ...r, extra: `${r.extra}${approvals ? ` · ${approvals} approvals` : ""}`.trim() }));
}

export function parseNlHtml(html: string): SponsorRow[] {
  const rows: SponsorRow[] = [];
  const re = /<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = stripHtml(m[1]).trim();
    const kvk = stripHtml(m[2]).trim();
    if (!name || /organisation|organisatie|name/i.test(name) && /kvk|chamber/i.test(kvk)) continue;
    rows.push({ name, route: "Highly skilled migrant (recognised sponsor)", extra: kvk ? `KvK ${kvk}` : "" });
  }
  return rows;
}

export function parseNlCsv(text: string): SponsorRow[] {
  return csvObjects(text, /organisation|organisatie|name/i)
    .map((o) => ({ name: pick(o, /organisation|organisatie|name/i), route: "Recognised sponsor", extra: pick(o, /kvk/i) }))
    .filter((r) => r.name);
}

export function parseCaCsv(text: string): SponsorRow[] {
  return csvObjects(text, /employer/i)
    .map((o) => ({
      name: pick(o, /^employer$|employer name|employeur/i) || pick(o, /employer/i),
      city: pick(o, /address|adresse/i).split(",").slice(-2, -1)[0]?.trim() ?? "",
      route: `LMIA – ${pick(o, /program stream|stream/i) || "positive"}`,
      extra: [pick(o, /province|territory/i), pick(o, /occupation|profession/i)].filter(Boolean).join(" · ").slice(0, 160),
    }))
    .filter((r) => r.name && !/^employer/i.test(r.name));
}

export function parseByList(listId: SponsorListId, text: string): SponsorRow[] {
  if (listId === "UK") return parseUkCsv(text);
  if (listId === "US") return parseUsCsv(text);
  if (listId === "NL") return /<table/i.test(text) ? parseNlHtml(text) : parseNlCsv(text);
  return parseCaCsv(text);
}

// ---- Downloaders ----
async function downloadUk(): Promise<{ rows: SponsorRow[]; url: string }> {
  const meta = await (await get("https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers", "application/json")).json();
  const docs: { url?: string; content_type?: string }[] = [
    ...(meta?.details?.attachments ?? []),
    ...((meta?.details?.documents ?? []) as string[]).flatMap((h) => [...h.matchAll(/href="([^"]+\.csv)"/g)].map((m) => ({ url: m[1] }))),
  ];
  const csv = docs.find((d) => d.url && /\.csv($|\?)/i.test(d.url));
  if (!csv?.url) throw new Error("Couldn't find the CSV link on gov.uk");
  const url = csv.url.startsWith("http") ? csv.url : `https://www.gov.uk${csv.url}`;
  return { rows: parseUkCsv(await (await get(url, "text/csv")).text()), url };
}

async function downloadNl(): Promise<{ rows: SponsorRow[]; url: string }> {
  const url = SPONSOR_LISTS.NL.sourceUrl;
  const rows = parseNlHtml(await (await get(url, "text/html")).text());
  if (rows.length < 50) throw new Error("The IND page layout changed – please import the register manually.");
  return { rows, url };
}

async function downloadCa(): Promise<{ rows: SponsorRow[]; url: string }> {
  const pkg = await (await get("https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97", "application/json")).json();
  const resources: { url: string; format: string; name: string; language?: string[]; created?: string; last_modified?: string }[] = pkg?.result?.resources ?? [];
  const csvs = resources
    .filter((r) => /csv/i.test(r.format) && (!r.language || r.language.includes("en")))
    .sort((a, b) => String(b.last_modified ?? b.created).localeCompare(String(a.last_modified ?? a.created)));
  if (!csvs.length) throw new Error("No CSV resources found in the open.canada.ca dataset");
  const url = csvs[0].url;
  const buf = Buffer.from(await (await get(url, "text/csv")).arrayBuffer());
  const text = buf.toString("utf8").includes("�") ? buf.toString("latin1") : buf.toString("utf8");
  return { rows: parseCaCsv(text), url };
}

async function downloadUs(): Promise<{ rows: SponsorRow[]; url: string }> {
  const year = new Date().getFullYear();
  const errors: string[] = [];
  for (const fy of [year - 1, year - 2, year - 3]) {
    const url = `https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-${fy}.csv`;
    try {
      const rows = parseUsCsv(await (await get(url, "text/csv")).text());
      if (rows.length) return { rows, url };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`USCIS download failed (${errors[0] ?? "unknown"}). USCIS often blocks automated downloads – download the CSV from the Data Hub in your browser and import it.`);
}

const DOWNLOADERS: Record<SponsorListId, () => Promise<{ rows: SponsorRow[]; url: string }>> = {
  UK: downloadUk,
  US: downloadUs,
  NL: downloadNl,
  CA: downloadCa,
};

export async function storeSponsorRows(listId: SponsorListId, rows: SponsorRow[], sourceUrl: string, status: "ok" | "demo" = "ok", message?: string) {
  const meta = SPONSOR_LISTS[listId];
  await db.sponsorRecord.deleteMany({ where: { listId } });
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.sponsorRecord.createMany({
      data: rows.slice(i, i + BATCH).map((r) => ({
        listId,
        name: r.name.slice(0, 200),
        normalizedName: normalizeCompany(r.name),
        city: (r.city ?? "").slice(0, 100),
        route: (r.route ?? "").slice(0, 150),
        extra: (r.extra ?? "").slice(0, 200),
      })),
    });
  }
  await db.sponsorList.upsert({
    where: { id: listId },
    create: { id: listId, name: meta.name, sourceUrl, lastUpdated: new Date(), recordCount: rows.length, status, message },
    update: { sourceUrl, lastUpdated: new Date(), recordCount: rows.length, status, message: message ?? null },
  });
  return rows.length;
}

export async function refreshSponsorList(listId: SponsorListId): Promise<{ ok: boolean; count?: number; message: string }> {
  const meta = SPONSOR_LISTS[listId];
  try {
    const { rows, url } = await DOWNLOADERS[listId]();
    if (!rows.length) throw new Error("The downloaded file contained no rows");
    const count = await storeSponsorRows(listId, rows, url);
    return { ok: true, count, message: `Imported ${count.toLocaleString("en-US")} employers.` };
  } catch (e) {
    const message = (e as Error).message;
    await db.sponsorList.upsert({
      where: { id: listId },
      create: { id: listId, name: meta.name, sourceUrl: meta.sourceUrl, status: "error", message },
      update: { status: "error", message },
    });
    return { ok: false, message };
  }
}
