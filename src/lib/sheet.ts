/** Applications sheet data + downloads (Excel, CSV, PDF, JSON). */
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "./db";
import { parseJson } from "./utils";
import { countryCode, findCountries } from "./countries";
import { analysisOf } from "./matching";
import { COLUMNS, cell, totals, type ColumnKey, type SheetRow } from "./sheet-view";

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export async function sheetRows(userId: string): Promise<SheetRow[]> {
  const apps = await db.application.findMany({
    where: { userId },
    include: {
      job: { include: { company: true } },
      profile: { select: { name: true } },
      tailoredResume: { select: { status: true } },
      emails: { where: { direction: "in", category: { in: ["Interview", "Recruiter", "Assessment", "Offer", "Rejection"] } }, orderBy: { date: "desc" }, take: 1 },
    },
  });
  const matches = new Map((await db.match.findMany({ where: { userId }, select: { jobId: true, score: true } })).map((m) => [m.jobId, m.score]));
  const contacts = await findContacts(userId, apps.map((a) => ({ id: a.id, jobId: a.jobId, company: a.job.company.name })));
  return apps.map((a) => {
    const found = contacts.get(a.id);
    const applied = a.submittedAt;
    const email = a.emails[0];
    const responseDate = a.responseDate ?? (email ? email.date : null);
    const latestResponse = a.latestResponse ?? (email ? `${email.category}: ${email.subject}` : "");
    const status = a.failed ? "Failed" : a.status === "No response" ? "Ghosted/No response" : a.status;
    const an = analysisOf(a.job);
    const countries = an.locationCountries?.length ? an.locationCountries : findCountries(a.job.location);
    return {
      id: a.id,
      company: a.job.company.name,
      role: a.job.title,
      location: a.job.location,
      country: countries[0] ?? countryCode(a.job.location) ?? "",
      jobLink: a.job.sourceUrl || a.job.applyUrl,
      dateApplied: ymd(applied),
      status,
      latestResponse,
      responseDate: ymd(responseDate),
      daysToResponse: applied && responseDate ? Math.max(0, Math.round((responseDate.getTime() - applied.getTime()) / 86_400_000)) : null,
      matchScore: matches.get(a.jobId) ?? null,
      sponsorship: a.job.sponsorshipCategory,
      resumeUsed: `${a.profile.name}${a.tailoredResume ? (a.tailoredResume.status === "use-original" ? " (original)" : " (tailored)") : ""}`,
      source: a.origin === "engine" ? "automatic" : a.origin === "manual-entry" ? "added manually" : a.origin === "extension" ? "extension" : a.origin === "auto" ? "auto mode" : "assisted",
      contactName: a.contactName ?? found?.name ?? "",
      contactEmail: a.contactEmail ?? found?.email ?? "",
      contactUrl: a.contactUrl ?? found?.url ?? "",
      contactFrom: a.contactName || a.contactEmail || a.contactUrl ? "typed in the sheet" : (found?.from ?? ""),
      notes: a.notes,
    };
  });
}

// ---------------------------------------------------------------- recruiter / contact
// Contacts come only from data you already have: recruiters you saved (Outreach page or the
// extension, which you click yourself) and emails people sent you. LinkedIn is never scraped.
const GENERIC_SENDER = /^(no-?reply|do-?not-?reply|notifications?|alerts?|jobs|careers|talent|recruiting|recruitment|hiring|hr|people|team|info|hello|support|mailer-daemon|postmaster)([.+_-]|@)/i;
const LINKEDIN_PROFILE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i;

/** A real person's name? (not "Acme Careers", "Greenhouse", "Talent Team", an email address…) */
export function personName(name: string, company = ""): string | null {
  const n = name.replace(/["']/g, "").replace(/\s+(at|from|@|[-|–]|via)\s+.*$/i, "").trim();
  if (!n || n.includes("@") || /\d/.test(n)) return null;
  if (/\b(team|careers?|jobs|talent|recruiting|recruitment|hiring|hr|people|notifications?|no-?reply|support|greenhouse|lever|ashby|workday|workable|smartrecruiters|linkedin|indeed)\b/i.test(n)) return null;
  if (company && n.toLowerCase() === company.toLowerCase()) return null;
  const words = n.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  return words.every((w) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*$/.test(w)) ? n : null;
}

interface FoundContact {
  name: string;
  email: string;
  url: string;
  from: string;
}

async function findContacts(userId: string, apps: { id: string; jobId: string; company: string }[]): Promise<Map<string, FoundContact>> {
  const out = new Map<string, FoundContact>();
  if (!apps.length) return out;
  const { normalizeCompany } = await import("./text");
  const { ATS_DOMAINS } = await import("./inbox/store");
  const [outreach, recruiters, emails] = await Promise.all([
    db.outreach.findMany({ where: { userId, jobId: { in: apps.map((a) => a.jobId) } }, include: { recruiter: true }, orderBy: { createdAt: "desc" } }),
    db.recruiter.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.email.findMany({ where: { userId, direction: "in", applicationId: { in: apps.map((a) => a.id) } }, orderBy: { date: "desc" }, select: { applicationId: true, fromName: true, fromAddress: true, bodyText: true } }),
  ]);
  const byCompany = new Map<string, (typeof recruiters)[number]>();
  for (const r of recruiters) if (r.company && !byCompany.has(normalizeCompany(r.company))) byCompany.set(normalizeCompany(r.company), r);
  const label = (r: { name: string; title: string }) => (r.title ? `${r.name} (${r.title})` : r.name);

  for (const a of apps) {
    // 1) a recruiter you saved for this exact job, 2) a recruiter you saved at this company
    const saved = outreach.find((o) => o.jobId === a.jobId)?.recruiter ?? byCompany.get(normalizeCompany(a.company));
    // 3) a person who emailed you about this application
    const mails = emails.filter((e) => e.applicationId === a.id);
    const person = mails.find((e) => personName(e.fromName, a.company) && !GENERIC_SENDER.test(e.fromAddress));
    const personFromAts = mails.find((e) => personName(e.fromName, a.company)); // e.g. "Priya Shah" via greenhouse-mail.io
    const linkedin = mails.map((e) => e.bodyText.match(LINKEDIN_PROFILE)?.[0]).find(Boolean) ?? "";
    if (saved) {
      out.set(a.id, { name: label(saved), email: person && personName(person.fromName, a.company) === saved.name ? person.fromAddress : "", url: saved.profileUrl || linkedin, from: "saved recruiter" });
    } else if (person || personFromAts) {
      const e = (person ?? personFromAts)!;
      const direct = !GENERIC_SENDER.test(e.fromAddress) && !ATS_DOMAINS.test(e.fromAddress);
      out.set(a.id, { name: personName(e.fromName, a.company)!, email: direct ? e.fromAddress : "", url: linkedin, from: "email" });
    } else if (linkedin) {
      out.set(a.id, { name: "", email: "", url: linkedin, from: "email" });
    }
  }
  return out;
}

/** Edit one cell from the sheet (status, latest response, response date, notes). */
export async function updateSheetCell(userId: string, applicationId: string, field: ColumnKey, value: string) {
  const app = await db.application.findFirstOrThrow({ where: { id: applicationId, userId } });
  const { logEvent, setOutcome, POST_SUBMIT } = await import("./applications");
  if (field === "status") {
    if (value === "Failed") {
      await db.application.update({ where: { id: app.id }, data: { failed: true, failureReason: "Marked failed in the sheet" } });
    } else {
      const status = value === "Ghosted/No response" ? "No response" : value;
      if (!POST_SUBMIT.includes(app.status as never)) await db.application.update({ where: { id: app.id }, data: { status: "Submitted", submittedAt: app.submittedAt ?? new Date(), failed: false } });
      if (status !== "Submitted" || POST_SUBMIT.includes(app.status as never)) await setOutcome(app.id, userId, status as never, "edited in the Applications sheet");
      await db.application.update({ where: { id: app.id }, data: { failed: false } });
    }
  } else if (field === "latestResponse") {
    await db.application.update({ where: { id: app.id }, data: { latestResponse: value.slice(0, 500) || null, responseEdited: true } });
  } else if (field === "responseDate") {
    const d = value ? new Date(`${value}T12:00:00Z`) : null;
    if (value && isNaN(d!.getTime())) throw new Error("Use a date like 2026-11-20.");
    await db.application.update({ where: { id: app.id }, data: { responseDate: d, responseEdited: true } });
  } else if (field === "notes") {
    await db.application.update({ where: { id: app.id }, data: { notes: value.slice(0, 5000) } });
  } else if (field === "contactName") {
    await db.application.update({ where: { id: app.id }, data: { contactName: value.trim().slice(0, 200) || null } });
  } else if (field === "contactEmail") {
    const v = value.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("That doesn't look like an email address.");
    await db.application.update({ where: { id: app.id }, data: { contactEmail: v || null } });
  } else if (field === "contactUrl") {
    let v = value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
    if (v && !URL.canParse(v)) throw new Error("That doesn't look like a link.");
    await db.application.update({ where: { id: app.id }, data: { contactUrl: v || null } });
  } else throw new Error("That column can't be edited.");
  await logEvent(app.id, "sheet", `Edited ${field} in the Applications sheet.`);
}

/** Add an application you made outside Upvance. */
export async function addManualApplication(userId: string, d: { company: string; role: string; location?: string; link?: string; date?: string; status?: string; notes?: string }) {
  const { upsertCompany } = await import("./jobs/ingest");
  const company = await upsertCompany(d.company.trim());
  const profile = (await db.profile.findFirst({ where: { userId, isDefault: true } })) ?? (await db.profile.findFirstOrThrow({ where: { userId } }));
  const when = d.date ? new Date(`${d.date}T12:00:00Z`) : new Date();
  const job = await db.job.create({
    data: { companyId: company.id, source: "manual-entry", externalId: `${userId}:${Date.now()}`, title: d.role.trim(), location: d.location ?? "", applyUrl: d.link ?? "", sourceUrl: d.link ?? "", postedAt: when, isActive: false },
  });
  const status = d.status === "Ghosted/No response" ? "No response" : d.status && d.status !== "Failed" ? d.status : "Submitted";
  const app = await db.application.create({ data: { userId, jobId: job.id, profileId: profile.id, origin: "manual-entry", status, submittedAt: when, notes: d.notes ?? "", failed: d.status === "Failed" } });
  await db.applicationEvent.create({ data: { applicationId: app.id, type: "created", message: "Added manually in the Applications sheet." } });
  return app;
}

// ---------------------------------------------------------------- exports
const label = (k: ColumnKey) => COLUMNS.find((c) => c.key === k)!.label;

export function toCsv(rows: SheetRow[], cols: ColumnKey[]) {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + [cols.map((k) => esc(label(k))).join(","), ...rows.map((r) => cols.map((k) => esc(cell(r, k))).join(","))].join("\r\n");
}

export function toJson(rows: SheetRow[], cols: ColumnKey[]) {
  return JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((k) => [label(k), r[k] ?? null]))), null, 2);
}

export async function toXlsx(rows: SheetRow[], cols: ColumnKey[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Upvance";
  wb.created = new Date();
  const ws = wb.addWorksheet("Applications", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((k) => ({ header: label(k), key: k, width: COLUMNS.find((c) => c.key === k)!.width }));
  for (const r of rows) {
    const values: Record<string, unknown> = {};
    for (const k of cols) {
      const v = r[k];
      if ((k === "dateApplied" || k === "responseDate") && v) values[k] = new Date(`${v}T00:00:00Z`);
      else if ((k === "jobLink" || k === "contactUrl") && v) values[k] = { text: String(v), hyperlink: String(v) };
      else values[k] = v ?? "";
    }
    ws.addRow(values);
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
  header.alignment = { vertical: "middle" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  cols.forEach((k, i) => {
    const col = ws.getColumn(i + 1);
    if (k === "dateApplied" || k === "responseDate") col.numFmt = "yyyy-mm-dd";
    if (k === "jobLink" || k === "contactUrl") col.font = { color: { argb: "FF2563EB" }, underline: true };
    col.alignment = { wrapText: k === "latestResponse" || k === "notes", vertical: "top" };
  });
  const t = totals(rows);
  const summary = wb.addWorksheet("Totals");
  summary.addRows([
    ["Applied", t.applied],
    ["Responses", t.responses],
    ["Interviews", t.interviews],
    ["Offers", t.offers],
    ["Response rate", `${t.rate}%`],
    ["Exported", new Date().toISOString()],
  ]);
  summary.getColumn(1).font = { bold: true };
  summary.getColumn(1).width = 16;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Printable landscape PDF table. */
export async function toPdf(rows: SheetRow[], cols: ColumnKey[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Applications");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 28, size = 7, lh = 9.5;
  const totalWidth = cols.reduce((n, k) => n + COLUMNS.find((c) => c.key === k)!.width, 0);
  const widths = cols.map((k) => ((W - 2 * M) * COLUMNS.find((c) => c.key === k)!.width) / totalWidth);
  const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const fit = (s: string, w: number, f = font) => {
    let t = safe(s);
    while (t && f.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -2);
    return t.length < safe(s).length ? t.slice(0, -1) + ".." : t;
  };
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const t = totals(rows);
  const headerRow = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - lh + 2, width: W - 2 * M, height: lh + 2, color: rgb(0.43, 0.16, 0.85) });
    cols.forEach((k, i) => {
      page.drawText(fit(label(k), widths[i], bold), { x: x + 2, y: y - lh + 5, size, font: bold, color: rgb(1, 1, 1) });
      x += widths[i];
    });
    y -= lh + 4;
  };
  page.drawText("Applications", { x: M, y: y - 12, size: 14, font: bold });
  page.drawText(safe(`Applied ${t.applied} · Responses ${t.responses} · Interviews ${t.interviews} · Offers ${t.offers} · Response rate ${t.rate}% · Exported ${new Date().toISOString().slice(0, 10)}`), { x: M, y: y - 26, size: 8, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 40;
  headerRow();
  rows.forEach((r, ri) => {
    if (y < M + lh) {
      page = pdf.addPage([W, H]);
      y = H - M;
      headerRow();
    }
    if (ri % 2) page.drawRectangle({ x: M, y: y - lh + 2, width: W - 2 * M, height: lh, color: rgb(0.96, 0.95, 0.99) });
    let x = M;
    cols.forEach((k, i) => {
      page.drawText(fit(cell(r, k), widths[i]), { x: x + 2, y: y - lh + 4, size, font, color: rgb(0.1, 0.1, 0.15) });
      x += widths[i];
    });
    y -= lh;
  });
  return pdf.save();
}

export const parseView = (s: string | null) => parseJson<Record<string, unknown>>(s, {});
