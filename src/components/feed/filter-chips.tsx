"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { filtersToQuery, type FeedFilters } from "@/lib/feed-filters";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

function Chip({ label, active, children, onClear }: { label: string; active: boolean; children: React.ReactNode; onClear?: () => void }) {
  return (
    <details className="relative group">
      <summary
        className={cn(
          "list-none cursor-pointer select-none inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
          active ? "border-primary bg-primary/10 text-primary dark:bg-primary/20" : "hover:bg-accent",
        )}
      >
        {label}
        {active && onClear ? (
          <span
            role="button"
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.preventDefault();
              onClear();
            }}
            className="rounded-full hover:bg-primary/20"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className="size-3.5 opacity-60" />
        )}
      </summary>
      <div className="absolute z-30 mt-1 w-64 max-h-80 overflow-y-auto rounded-lg border bg-popover p-3 shadow-lg text-sm">{children}</div>
    </details>
  );
}

function Multi({ options, value, onChange }: { options: Opt[]; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const set = new Set(value ?? []);
  return (
    <div className="grid gap-1.5">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-primary)]"
            checked={set.has(o.value)}
            onChange={(e) => {
              const next = new Set(set);
              if (e.target.checked) next.add(o.value);
              else next.delete(o.value);
              onChange(Array.from(next));
            }}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Single({ options, value, onChange }: { options: Opt[]; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="grid gap-1.5">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 cursor-pointer">
          <input type="radio" className="size-4 accent-[var(--color-primary)]" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
      {value && (
        <button type="button" className="text-left text-xs text-primary underline" onClick={() => onChange(undefined)}>
          Clear
        </button>
      )}
    </div>
  );
}

export function FilterChips({ filters, countries, companies, roles, keep, hasPriority, hasTargets }: { filters: FeedFilters; countries: Opt[]; companies: Opt[]; roles: string[]; keep?: Record<string, string>; hasPriority?: boolean; hasTargets?: boolean }) {
  const rolesOn = filters.targetRoles ?? !!hasTargets;
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const [exclude, setExclude] = useState((filters.exclude ?? []).join(", "));
  const go = (patch: Partial<FeedFilters>) => {
    const next = { ...filters, ...patch };
    const extra = new URLSearchParams(keep ?? {}).toString();
    router.push(`/jobs?${filtersToQuery(next)}${extra ? `&${extra}` : ""}`);
  };
  const n = (v: string) => (v ? Number(v) : undefined);
  return (
    <div className="grid gap-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q || undefined });
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or company (e.g. AI Engineer)" className="h-10 w-full rounded-full border bg-card pl-9 pr-3 text-sm" aria-label="Search jobs" />
        </div>
        <select value={filters.sort ?? (hasPriority ? "priority" : "score")} onChange={(e) => go({ sort: e.target.value as "priority" | "score" | "date" })} className="h-10 rounded-full border bg-card px-3 text-sm" aria-label="Sort">
          {hasPriority && <option value="priority">Country priority</option>}
          <option value="score">Best match</option>
          <option value="date">Newest</option>
        </select>
      </form>
      <div className="flex flex-wrap gap-2">
        <Chip label={filters.posted ? `Last ${filters.posted === 1 ? "24 hours" : `${filters.posted} days`}` : "Date posted"} active={!!filters.posted} onClear={() => go({ posted: undefined })}>
          <Single options={[{ value: "1", label: "Past 24 hours" }, { value: "2", label: "Past 48 hours" }, { value: "7", label: "Past week" }, { value: "30", label: "Past month" }]} value={filters.posted ? String(filters.posted) : undefined} onChange={(v) => go({ posted: n(v ?? "") })} />
        </Chip>
        <Chip label={filters.countries?.length ? `Location (${filters.countries.length})` : "Location"} active={!!filters.countries?.length} onClear={() => go({ countries: [] })}>
          <Multi options={countries} value={filters.countries} onChange={(v) => go({ countries: v })} />
        </Chip>
        <Chip label={filters.workplace?.length ? filters.workplace.join(", ") : "Workplace"} active={!!filters.workplace?.length} onClear={() => go({ workplace: [] })}>
          <Multi options={[{ value: "remote", label: "Remote" }, { value: "hybrid", label: "Hybrid" }, { value: "onsite", label: "Onsite" }]} value={filters.workplace} onChange={(v) => go({ workplace: v as FeedFilters["workplace"] })} />
        </Chip>
        <Chip label={filters.companies?.length ? `Companies (${filters.companies.length})` : "Companies"} active={!!filters.companies?.length} onClear={() => go({ companies: [] })}>
          <Multi options={companies} value={filters.companies} onChange={(v) => go({ companies: v })} />
        </Chip>
        <Chip label={filters.degree ? `Degree: ${filters.degree}` : "Degree level"} active={!!filters.degree} onClear={() => go({ degree: undefined })}>
          <p className="text-xs text-muted-foreground mb-2">Hide jobs that require more than the degree you have.</p>
          <Single options={[{ value: "none", label: "No degree" }, { value: "bachelor", label: "Bachelor's" }, { value: "master", label: "Master's" }, { value: "phd", label: "PhD" }]} value={filters.degree} onChange={(v) => go({ degree: v as FeedFilters["degree"] })} />
        </Chip>
        <Chip label={filters.maxExp != null ? `≤ ${filters.maxExp} yrs experience` : "Max experience"} active={filters.maxExp != null} onClear={() => go({ maxExp: undefined })}>
          <Single options={[1, 2, 3, 5, 8, 10].map((y) => ({ value: String(y), label: `Asks for ≤ ${y} years` }))} value={filters.maxExp != null ? String(filters.maxExp) : undefined} onChange={(v) => go({ maxExp: n(v ?? "") })} />
        </Chip>
        {hasTargets && (
          <button type="button" title="Only jobs whose title fits the target roles in Settings" onClick={() => go({ targetRoles: !rolesOn })} className={cn("rounded-full border px-3 py-1.5 text-sm", rolesOn ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
            My target roles
          </button>
        )}
        <button type="button" onClick={() => go({ sponsorship: !filters.sponsorship })} className={cn("rounded-full border px-3 py-1.5 text-sm", filters.sponsorship ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
          Needs visa sponsorship
        </button>
        <button type="button" onClick={() => go({ noClearance: !filters.noClearance })} className={cn("rounded-full border px-3 py-1.5 text-sm", filters.noClearance ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
          No clearance jobs
        </button>
        <button type="button" title="Hide remote jobs whose pay is cut to where you live, and jobs paying below your minimum salary" onClick={() => go({ fairPay: !filters.fairPay })} className={cn("rounded-full border px-3 py-1.5 text-sm", filters.fairPay ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
          Fair remote pay
        </button>
        <Chip label={filters.roles?.length ? `Role (${filters.roles.length})` : "Role"} active={!!filters.roles?.length} onClear={() => go({ roles: [] })}>
          <Multi options={roles.map((r) => ({ value: r, label: r }))} value={filters.roles} onChange={(v) => go({ roles: v })} />
        </Chip>
        <Chip label={filters.level?.length ? `Level (${filters.level.length})` : "Job type"} active={!!filters.level?.length} onClear={() => go({ level: [] })}>
          <Multi options={["Intern", "Junior", "Mid", "Senior", "Lead", "Principal", "Manager", "Director"].map((l) => ({ value: l, label: l }))} value={filters.level} onChange={(v) => go({ level: v })} />
        </Chip>
        <Chip label={filters.employment?.length ? filters.employment.join(", ") : "Employment type"} active={!!filters.employment?.length} onClear={() => go({ employment: [] })}>
          <Multi options={["full-time", "part-time", "contract", "internship", "temporary"].map((v) => ({ value: v, label: v }))} value={filters.employment} onChange={(v) => go({ employment: v })} />
        </Chip>
        <Chip label={filters.pay ? `Pay ≥ ${filters.pay.toLocaleString("en-US")}` : "Pay"} active={!!filters.pay} onClear={() => go({ pay: undefined })}>
          <p className="text-xs text-muted-foreground mb-2">Only jobs that publish pay at or above this (per year, job currency).</p>
          <Single options={[30000, 50000, 75000, 100000, 150000].map((p) => ({ value: String(p), label: `≥ ${p.toLocaleString("en-US")}` }))} value={filters.pay ? String(filters.pay) : undefined} onChange={(v) => go({ pay: n(v ?? "") })} />
        </Chip>
        <Chip label={filters.exclude?.length ? `Exclude (${filters.exclude.length})` : "Exclude"} active={!!filters.exclude?.length} onClear={() => go({ exclude: [] })}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go({ exclude: exclude.split(",").map((s) => s.trim()).filter(Boolean) });
            }}
            className="grid gap-2"
          >
            <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="intern, sales, Acme" className="h-9 rounded-md border bg-card px-2" />
            <button className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground" type="submit">
              Apply
            </button>
          </form>
        </Chip>
        <Chip label={filters.band ? `${filters.band}+ match` : "Match"} active={!!filters.band} onClear={() => go({ band: undefined })}>
          <Single options={["Excellent", "Strong", "Good", "Moderate"].map((b) => ({ value: b, label: b }))} value={filters.band} onChange={(v) => go({ band: v })} />
        </Chip>
        <Chip label={filters.eligibility && filters.eligibility !== "default" ? `Eligibility: ${filters.eligibility}` : "Eligibility"} active={!!filters.eligibility && filters.eligibility !== "default"} onClear={() => go({ eligibility: undefined })}>
          <Single options={[{ value: "eligible", label: "Eligible only" }, { value: "review", label: "Needs review" }, { value: "ineligible", label: "Ineligible" }, { value: "all", label: "Show all" }]} value={filters.eligibility} onChange={(v) => go({ eligibility: v as FeedFilters["eligibility"] })} />
        </Chip>
        <button type="button" onClick={() => go({ saved: !filters.saved })} className={cn("rounded-full border px-3 py-1.5 text-sm", filters.saved ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
          Saved
        </button>
        {filtersToQuery(filters) && (
          <button type="button" onClick={() => router.push("/jobs")} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
