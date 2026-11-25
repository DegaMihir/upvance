"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ClipboardCopy, Columns3, Download, ExternalLink, Plus } from "lucide-react";
import { COLUMNS, DEFAULT_VIEW, SHEET_STATUSES, applyView, normalizeView, toTsv, totals, type ColumnKey, type SheetRow, type SheetView } from "@/lib/sheet-view";
import { updateCellAction, addManualAction } from "@/app/actions/sheet";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEY = "upvance-sheet-view";

function EditableCell({ row, k, onSaved }: { row: SheetRow; k: ColumnKey; onSaved: (v: string) => void }) {
  const [value, setValue] = useState(String(row[k] ?? ""));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    setValue(String(row[k] ?? ""));
  }, [row, k]);
  const save = (v: string) => {
    if (v === String(row[k] ?? "")) return;
    start(async () => {
      const r = await updateCellAction(row.id, k, v);
      if (r.ok) {
        setErr(null);
        onSaved(v);
      } else setErr(r.error ?? "Couldn't save");
    });
  };
  const cls = cn("w-full bg-transparent px-1 py-0.5 rounded focus:bg-card focus:ring-1 focus:ring-ring", pending && "opacity-50", err && "ring-1 ring-destructive");
  if (k === "status")
    return (
      <select aria-label="Status" value={value} onChange={(e) => (setValue(e.target.value), save(e.target.value))} className={cls} title={err ?? undefined}>
        {!SHEET_STATUSES.includes(value) && <option value={value}>{value}</option>}
        {SHEET_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    );
  if (k === "responseDate") return <input type="date" aria-label="Response date" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save(value)} className={cls} title={err ?? undefined} />;
  return <input aria-label={k} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save(value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cls} title={err ?? value} />;
}

export function SheetTable({ rows: initial, countries }: { rows: SheetRow[]; countries: string[] }) {
  const [rows, setRows] = useState(initial);
  const [view, setView] = useState<SheetView>(DEFAULT_VIEW);
  const [showCols, setShowCols] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setRows(initial);
  }, [initial]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setView(normalizeView(JSON.parse(saved)));
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(view));
    } catch {
      /* ignore */
    }
  }, [view]);

  const shown = useMemo(() => applyView(rows, view), [rows, view]);
  const t = totals(shown);
  const set = (patch: Partial<SheetView>) => setView((v) => ({ ...v, ...patch }));
  const sortBy = (key: ColumnKey) => set({ sort: { key, dir: view.sort.key === key && view.sort.dir === "asc" ? "desc" : "asc" } });
  const move = (k: ColumnKey, d: -1 | 1) => {
    const cols = [...view.columns];
    const i = cols.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    set({ columns: cols });
  };
  const toggleCol = (k: ColumnKey) => set({ columns: view.columns.includes(k) ? view.columns.filter((c) => c !== k) : [...view.columns, k] });
  const label = (k: ColumnKey) => COLUMNS.find((c) => c.key === k)!.label;

  return (
    <div className="grid gap-3">
      {/* Totals bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ["Applied", t.applied],
          ["Responses", t.responses],
          ["Interviews", t.interviews],
          ["Offers", t.offers],
          ["Response rate", `${t.rate}%`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-xl font-bold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={view.q ?? ""} onChange={(e) => set({ q: e.target.value })} placeholder="Search" className="h-9 w-48 rounded-md border bg-card px-3 text-sm" aria-label="Search applications" />
        <details className="relative">
          <summary className="list-none cursor-pointer h-9 inline-flex items-center rounded-md border bg-card px-3 text-sm">Status{view.status.length ? ` (${view.status.length})` : ""}</summary>
          <div className="absolute z-20 mt-1 grid gap-1 rounded-lg border bg-popover p-3 shadow-lg text-sm w-56">
            {SHEET_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input type="checkbox" checked={view.status.includes(s)} onChange={(e) => set({ status: e.target.checked ? [...view.status, s] : view.status.filter((x) => x !== s) })} /> {s}
              </label>
            ))}
          </div>
        </details>
        <label className="flex items-center gap-1 text-sm">
          From <input type="date" value={view.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} className="h-9 rounded-md border bg-card px-2" />
        </label>
        <label className="flex items-center gap-1 text-sm">
          To <input type="date" value={view.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} className="h-9 rounded-md border bg-card px-2" />
        </label>
        <input value={view.company ?? ""} onChange={(e) => set({ company: e.target.value || undefined })} placeholder="Company" className="h-9 w-36 rounded-md border bg-card px-3 text-sm" aria-label="Filter by company" />
        <select value={view.country ?? ""} onChange={(e) => set({ country: e.target.value || undefined })} className="h-9 rounded-md border bg-card px-2 text-sm" aria-label="Filter by country">
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setView({ ...DEFAULT_VIEW, columns: view.columns })}>
          Clear filters
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCols((s) => !s)}>
            <Columns3 /> Columns
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((s) => !s)}>
            <Plus /> Add application
          </Button>
        </div>
      </div>

      {showCols && (
        <div className="rounded-lg border bg-card p-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[...view.columns, ...COLUMNS.map((c) => c.key).filter((k) => !view.columns.includes(k))].map((k) => (
            <div key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={view.columns.includes(k)} onChange={() => toggleCol(k)} aria-label={`Show ${label(k)}`} />
              <span className="flex-1">{label(k)}</span>
              {view.columns.includes(k) && (
                <>
                  <button type="button" onClick={() => move(k, -1)} aria-label={`Move ${label(k)} left`} className="rounded p-0.5 hover:bg-accent">
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => move(k, 1)} aria-label={`Move ${label(k)} right`} className="rounded p-0.5 hover:bg-accent">
                    <ChevronRight className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <ActionForm action={addManualAction} className="rounded-lg border bg-card p-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm" resetOnSuccess>
          <input name="company" required placeholder="Company *" className="h-9 rounded-md border bg-background px-2" />
          <input name="role" required placeholder="Role *" className="h-9 rounded-md border bg-background px-2" />
          <input name="location" placeholder="Location" className="h-9 rounded-md border bg-background px-2" />
          <input name="link" type="url" placeholder="Job link" className="h-9 rounded-md border bg-background px-2" />
          <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="h-9 rounded-md border bg-background px-2" aria-label="Date applied" />
          <select name="status" defaultValue="Submitted" className="h-9 rounded-md border bg-background px-2" aria-label="Status">
            {SHEET_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <SubmitButton size="sm" className="sm:col-span-3 lg:col-span-6 justify-self-start">
            Add
          </SubmitButton>
        </ActionForm>
      )}

      {/* Downloads */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Download this view ({shown.length} rows):</span>
        {(["xlsx", "csv", "pdf", "json"] as const).map((f) => (
          <form key={f} method="post" action="/api/sheet/export">
            <input type="hidden" name="format" value={f} />
            <input type="hidden" name="view" value={JSON.stringify(view)} />
            <Button size="sm" variant="outline" type="submit">
              <Download /> {f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase()}
            </Button>
          </form>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(toTsv(shown, view.columns));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <ClipboardCopy /> {copied ? "Copied!" : "Copy for Google Sheets"}
        </Button>
        <span className="text-xs text-muted-foreground">Google Sheets: click “Copy”, open sheets.new and press Ctrl+V – or download Excel and use File → Import.</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-auto max-h-[calc(100dvh-20rem)]">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {view.columns.map((k) => (
                <th key={k} scope="col" className="text-left font-medium text-muted-foreground px-2 py-2 whitespace-nowrap border-b">
                  <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {label(k)}
                    {view.sort.key === k && (view.sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={view.columns.length} className="p-6 text-center text-muted-foreground">
                  No applications match this view.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/30 align-top">
                {view.columns.map((k) => {
                  const col = COLUMNS.find((c) => c.key === k)!;
                  return (
                    <td key={k} className={cn("px-2 py-1.5", k === "role" || k === "latestResponse" || k === "notes" ? "min-w-56" : "whitespace-nowrap")}>
                      {k === "contactUrl" ? (
                        <div className="flex items-center gap-1 min-w-48" title={r.contactFrom ? `Found from: ${r.contactFrom}` : "Paste a LinkedIn or profile link"}>
                          <EditableCell row={r} k={k} onSaved={(v) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, [k]: v } : x)))} />
                          {r.contactUrl && (
                            <a href={r.contactUrl} target="_blank" rel="noopener noreferrer" aria-label="Open profile" className="text-primary shrink-0">
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                      ) : col.editable ? (
                        <div className={k === "contactName" || k === "contactEmail" ? "min-w-40" : undefined} title={(k === "contactName" || k === "contactEmail") && r.contactFrom ? `Found from: ${r.contactFrom}` : undefined}>
                          <EditableCell row={r} k={k} onSaved={(v) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, [k]: v } : x)))} />
                        </div>
                      ) : k === "jobLink" && r.jobLink ? (
                        <a href={r.jobLink} target="_blank" rel="noopener noreferrer" className="text-primary underline max-w-56 inline-block truncate align-bottom">
                          {r.jobLink.replace(/^https?:\/\//, "")}
                        </a>
                      ) : k === "role" ? (
                        <a href={`/applications/${r.id}`} className="hover:underline">
                          {r.role}
                        </a>
                      ) : (
                        String(r[k] ?? "")
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
