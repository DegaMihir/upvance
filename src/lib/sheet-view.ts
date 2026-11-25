/** Applications sheet: columns, filtering, sorting, totals (shared by the page and the exports). */

export interface SheetRow {
  id: string;
  company: string;
  role: string;
  location: string;
  country: string;
  jobLink: string;
  dateApplied: string; // YYYY-MM-DD
  status: string;
  latestResponse: string;
  responseDate: string; // YYYY-MM-DD
  daysToResponse: number | null;
  matchScore: number | null;
  sponsorship: string;
  resumeUsed: string;
  source: string;
  contactName: string; // recruiter / hiring contact
  contactEmail: string;
  contactUrl: string; // LinkedIn or other profile link
  contactFrom: string; // where the contact came from (not a column)
  notes: string;
}

export type ColumnKey = Exclude<keyof SheetRow, "id" | "country" | "contactFrom">;
export const COLUMNS: { key: ColumnKey; label: string; width: number; editable?: boolean }[] = [
  { key: "company", label: "Company", width: 22 },
  { key: "role", label: "Role / job title", width: 32 },
  { key: "location", label: "Location", width: 24 },
  { key: "jobLink", label: "Job link", width: 36 },
  { key: "dateApplied", label: "Date applied", width: 13 },
  { key: "status", label: "Status", width: 18, editable: true },
  { key: "latestResponse", label: "Latest response", width: 40, editable: true },
  { key: "responseDate", label: "Response date", width: 14, editable: true },
  { key: "daysToResponse", label: "Days to response", width: 10 },
  { key: "matchScore", label: "Match score", width: 9 },
  { key: "sponsorship", label: "Sponsorship status", width: 16 },
  { key: "resumeUsed", label: "Resume used", width: 22 },
  { key: "source", label: "Source", width: 12 },
  { key: "contactName", label: "Recruiter / contact", width: 22, editable: true },
  { key: "contactEmail", label: "Contact email", width: 26, editable: true },
  { key: "contactUrl", label: "LinkedIn / profile", width: 30, editable: true },
  { key: "notes", label: "Notes", width: 30, editable: true },
];
export const SHEET_STATUSES = ["Submitted", "Recruiter response", "Assessment", "Interview", "Offer", "Rejected", "Ghosted/No response", "Failed"];
export const RESPONDED = ["Recruiter response", "Assessment", "Interview", "Offer", "Rejected"];

export interface SheetView {
  columns: ColumnKey[]; // visible, in order
  known?: ColumnKey[]; // every column that existed when the view was saved (new columns get shown)
  sort: { key: ColumnKey; dir: "asc" | "desc" };
  status: string[];
  from?: string;
  to?: string;
  company?: string;
  country?: string;
  q?: string;
}

export const DEFAULT_VIEW: SheetView = { columns: COLUMNS.map((c) => c.key), sort: { key: "dateApplied", dir: "desc" }, status: [] };

export function normalizeView(v: Partial<SheetView> | null | undefined): SheetView {
  const valid = new Set(COLUMNS.map((c) => c.key));
  const cols = (v?.columns ?? DEFAULT_VIEW.columns).filter((c) => valid.has(c));
  // Columns added in a later version than the saved view are shown by default.
  const known = new Set(v?.known ?? (v?.columns ? ["company", "role", "location", "jobLink", "dateApplied", "status", "latestResponse", "responseDate", "daysToResponse", "matchScore", "sponsorship", "resumeUsed", "source", "notes"] : COLUMNS.map((c) => c.key)));
  for (const c of COLUMNS) {
    if (known.has(c.key) || cols.includes(c.key)) continue;
    const at = cols.indexOf("notes"); // new columns go just before Notes
    cols.splice(at >= 0 ? at : cols.length, 0, c.key);
  }
  return {
    columns: cols.length ? cols : DEFAULT_VIEW.columns,
    known: COLUMNS.map((c) => c.key),
    sort: v?.sort && valid.has(v.sort.key) ? v.sort : DEFAULT_VIEW.sort,
    status: v?.status ?? [],
    from: v?.from || undefined,
    to: v?.to || undefined,
    company: v?.company || undefined,
    country: v?.country || undefined,
    q: v?.q || undefined,
  };
}

export function applyView(rows: SheetRow[], view: SheetView): SheetRow[] {
  const q = view.q?.toLowerCase();
  const out = rows.filter((r) => {
    if (view.status.length && !view.status.includes(r.status)) return false;
    if (view.from && (!r.dateApplied || r.dateApplied < view.from)) return false;
    if (view.to && (!r.dateApplied || r.dateApplied > view.to)) return false;
    if (view.company && !r.company.toLowerCase().includes(view.company.toLowerCase())) return false;
    if (view.country && r.country !== view.country) return false;
    if (q && !Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))) return false;
    return true;
  });
  const { key, dir } = view.sort;
  const sign = dir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null || x === "") return 1;
    if (y == null || y === "") return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
  });
}

export function totals(rows: SheetRow[]) {
  const applied = rows.filter((r) => r.status !== "Failed").length;
  const responses = rows.filter((r) => RESPONDED.includes(r.status)).length;
  return {
    applied,
    responses,
    interviews: rows.filter((r) => r.status === "Interview" || r.status === "Offer").length,
    offers: rows.filter((r) => r.status === "Offer").length,
    rate: applied ? Math.round((responses / applied) * 100) : 0,
  };
}

export function cell(r: SheetRow, k: ColumnKey): string {
  const v = r[k];
  return v == null ? "" : String(v);
}

/** Tab-separated text – paste straight into Google Sheets or Excel. */
export function toTsv(rows: SheetRow[], cols: ColumnKey[]) {
  const label = (k: ColumnKey) => COLUMNS.find((c) => c.key === k)!.label;
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  return [cols.map(label).join("\t"), ...rows.map((r) => cols.map((k) => clean(cell(r, k))).join("\t"))].join("\n");
}
