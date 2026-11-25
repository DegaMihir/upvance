import Link from "next/link";
import { Bookmark, ExternalLink, Eye, EyeOff, RefreshCw, SearchX, ThumbsDown, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson, timeAgo, formatMoney, cn } from "@/lib/utils";
import { COUNTRIES, COUNTRY_OPTIONS, countryName } from "@/lib/countries";
import { degreeLevel, describeFilters, filtersToQuery, parseFilters, passes, priorityFrom, rowPriority, sortRows, targetKeys, type FeedFilters } from "@/lib/feed";
import { analysisOf, evaluateJob, loadUserContext } from "@/lib/matching";
import { demoFilter } from "@/lib/demo/visibility";
import { queueOverview } from "@/lib/apply/queue";
import { engineStatus } from "@/lib/apply/engine";
import { ATS_LABEL, type AtsType } from "@/lib/ats";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Alert } from "@/components/ui/misc";
import { BandBadge, EligibilityBadge, RemoteBadge, SponsorshipBadge, StatusBadge } from "@/components/domain/badges";
import { FilterChips } from "@/components/feed/filter-chips";
import { ApplyBar } from "@/components/feed/apply-bar";
import { AssistantChat } from "@/components/feed/assistant-chat";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { refreshMatchesAction } from "@/app/actions/jobs";
import { applyOneAction, deleteWatcherAction, matchStatusAction, stopAllAction, toggleWatcherAction } from "@/app/actions/apply";

export const metadata = { title: "Jobs" };

const ROLES = ["ML / AI engineering", "Software engineering", "Data science / analytics", "Data engineering", "MLOps / Platform", "Product / programme", "Other"];

function Initials({ name }: { name: string }) {
  const hue = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span title={name} className="inline-grid size-8 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: `hsl(${hue} 55% 45%)` }}>
      {name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"}
    </span>
  );
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const userId = await requireUserId();
  const filters: FeedFilters = parseFilters(sp);
  const query = filtersToQuery(filters);
  const limit = Number(sp.limit) || 60;
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const all = await db.match.findMany({ where: { userId, job: { isActive: true, ...demoFilter(false) } }, include: { job: { include: { company: true } } } });
  const hasProfile = (await db.profile.count({ where: { userId } })) > 0;
  const prio = priorityFrom(settings);
  const rows = sortRows(all.filter((m) => passes(m, filters, settings)), filters, prio);
  const companyCounts = new Map<string, { name: string; n: number }>();
  for (const m of all) companyCounts.set(m.job.company.normalizedName, { name: m.job.company.name, n: (companyCounts.get(m.job.company.normalizedName)?.n ?? 0) + 1 });
  const companies = Array.from(companyCounts.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 60).map(([v, c]) => ({ value: v, label: `${c.name} (${c.n})` }));
  const countriesPresent = new Set<string>();
  for (const m of all) for (const c of [...parseJson<string[]>(m.job.remoteCountries, []), ...(analysisOf(m.job).locationCountries ?? [])]) countriesPresent.add(c);
  const tierOf = (code: string) => { const i = prio.order.indexOf(code); if (i < 0) return null; return prio.tier1Count > 0 && prio.tier1Count < prio.order.length && i >= prio.tier1Count ? 2 : 1; };
  const tierLabel = (code: string) => (tierOf(code) ? `Tier ${tierOf(code)} · ` : "");
  const countryOpts = COUNTRY_OPTIONS.filter((c) => countriesPresent.has(c.code) || prio.order.includes(c.code) || filters.countries?.includes(c.code))
    .sort((a, b) => (prio.order.includes(a.code) ? prio.order.indexOf(a.code) : 999) - (prio.order.includes(b.code) ? prio.order.indexOf(b.code) : 999))
    .map((c) => ({ value: c.code, label: `${tierLabel(c.code)}${c.name}` }));

  const selectedId = sp.job ?? rows[0]?.jobId;
  const selected = selectedId ? (all.find((m) => m.jobId === selectedId) ?? null) : null;
  const ctx = await loadUserContext(userId);
  const ev = selected && ctx.candidate ? evaluateJob(selected.job, ctx.candidate, ctx.prefs, ctx.weights) : null;
  const a = selected ? analysisOf(selected.job) : null;
  const [queue, status, watchers, savedSearches, appForSelected] = await Promise.all([
    queueOverview(userId),
    engineStatus(),
    db.savedSearch.findMany({ where: { userId, autoApply: true }, orderBy: { createdAt: "asc" } }),
    db.savedSearch.findMany({ where: { userId, autoApply: false }, orderBy: { createdAt: "asc" } }),
    selected ? db.application.findFirst({ where: { userId, jobId: selected.jobId }, select: { id: true, status: true } }) : null,
  ]);
  const queuedForSelected = selected ? await db.applyJob.findUnique({ where: { userId_jobId: { userId, jobId: selected.jobId } } }) : null;
  const href = (jobId: string) => `/jobs?${query}${query ? "&" : ""}job=${jobId}${sp.limit ? `&limit=${sp.limit}` : ""}`;
  const stopped = status.state === "stopped";

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Real jobs from public job boards, ranked by how well they suit you. Hard eligibility rules (citizenship, location, sponsorship) override the score."
        actions={
          <form action={refreshMatchesAction}>
            <Button variant="outline" type="submit">
              <RefreshCw /> Recalculate
            </Button>
          </form>
        }
      />
      <div className="grid gap-4">
        {!hasProfile && (
          <Alert variant="info" title="Upload your resume to see your matches">
            Jobs are matched to your profile. Go to <a href="/profile" className="underline">Profile &amp; resumes</a>, upload your resume and check the details – your matches appear here right after.
          </Alert>
        )}
        <FilterChips filters={filters} countries={countryOpts} companies={companies} roles={ROLES} hasPriority={prio.order.length > 0} hasTargets={targetKeys(settings?.targetTitles).length > 0} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">{rows.length}</b> of {all.length} jobs · {describeFilters(filters)}
          </p>
          <ApplyBar query={query} defaultPolicy={(settings?.defaultSubmitPolicy as "review" | "auto") ?? "review"} matchCount={rows.filter((r) => r.eligibility !== "Ineligible").length} />
        </div>

        {watchers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Watching for new matches:</span>
            {watchers.map((w) => (
              <span key={w.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1", w.enabled ? "border-emerald-500/40 bg-emerald-500/5" : "opacity-60")}>
                <Link href={`/jobs?${filtersToQuery(parseJson<FeedFilters>(w.filters, {}))}`} className="hover:underline" title="Load these filters (edit them, then use Keep applying again to save)">
                  {w.name.replace(/^Keep applying: /, "")}
                </Link>
                <span className="text-xs text-muted-foreground">
                  · {w.submitPolicy === "auto" ? "auto" : "review"} · every {w.checkIntervalMin}m
                </span>
                <form action={toggleWatcherAction} className="inline">
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="on" value={w.enabled ? "0" : "1"} />
                  <button type="submit" className="rounded p-0.5 hover:bg-accent" aria-label={w.enabled ? "Turn off" : "Turn on"} title={w.enabled ? "Turn off" : "Turn on"}>
                    {w.enabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                </form>
                <form action={deleteWatcherAction} className="inline">
                  <input type="hidden" name="id" value={w.id} />
                  <button type="submit" className="rounded p-0.5 hover:bg-accent" aria-label="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                </form>
              </span>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_320px]">
          {/* List */}
          <div className="grid gap-2 content-start lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto lg:pr-1">
            {rows.length === 0 && (
              <EmptyState icon={<SearchX className="size-8" />} title="No jobs match these filters">
                Loosen a filter, or <Link className="underline" href="/discover">discover more jobs</Link>.
              </EmptyState>
            )}
            {rows.slice(0, limit).map((m) => (
              <Link key={m.id} href={href(m.jobId)} scroll={false}>
                <Card className={cn("p-3 hover:bg-muted/40 transition-colors", m.jobId === selectedId && "ring-2 ring-primary")}>
                  <div className="flex items-start gap-3">
                    <Initials name={m.job.company.name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug line-clamp-2">{m.job.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.job.company.name} · {m.job.location || "Location not stated"} · {timeAgo(m.job.postedAt)}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(() => {
                          const pr = prio.order.length ? rowPriority(m, prio) : null;
                          return pr?.country ? <Badge variant={pr.tier === 1 ? "success" : "info"}>{`Tier ${pr.tier} · ${COUNTRIES[pr.country]?.name ?? pr.country}`}</Badge> : null;
                        })()}
                        <SponsorshipBadge category={m.job.sponsorshipCategory} />
                        <RemoteBadge category={m.job.remoteCategory} countries={parseJson(m.job.remoteCountries, [])} />
                        {m.status === "saved" && <Badge variant="info">Saved</Badge>}
                      </div>
                    </div>
                    <BandBadge band={m.band} score={m.score} />
                  </div>
                </Card>
              </Link>
            ))}
            {rows.length > limit && (
              <Button asChild variant="outline">
                <Link href={`/jobs?${query}${query ? "&" : ""}limit=${limit + 60}`} scroll={false}>
                  Show more ({rows.length - limit} left)
                </Link>
              </Button>
            )}
          </div>

          {/* Detail side panel */}
          <div className="content-start lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto">
            {selected && a ? (
              <Card className="p-5 grid gap-4">
                <div className="flex items-start gap-3">
                  <Initials name={selected.job.company.name} />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold leading-snug">{selected.job.title}</h2>
                    <Link href={`/companies/${selected.job.companyId}`} className="text-sm text-muted-foreground hover:underline">
                      {selected.job.company.name}
                    </Link>
                  </div>
                  <BandBadge band={selected.band} score={selected.score} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ["Location", selected.job.location || "Not stated"],
                    ["Workplace", a.remote.category],
                    ["Level", a.seniority],
                    ["Type", a.employmentType ?? selected.job.employmentType ?? "Not stated"],
                    ["Education", a.degree ? degreeLevel(a).replace(/^./, (c) => c.toUpperCase()) : "Not stated"],
                    ["Experience", a.experienceYears?.min != null ? `${a.experienceYears.min}+ years` : "Not stated"],
                    ["Pay", formatMoney(selected.job.salaryMin, selected.job.salaryMax, selected.job.salaryCurrency) ?? "Not published"],
                    ["Posted", timeAgo(selected.job.postedAt)],
                    ["Countries", (a.remote.countries.length ? a.remote.countries : a.locationCountries).map(countryName).join(", ") || "Unclear"],
                    ["Applies via", ATS_LABEL[selected.job.atsType as AtsType] ?? selected.job.atsType],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <SponsorshipBadge category={selected.job.sponsorshipCategory} />
                  {ev && <EligibilityBadge status={ev.eligibility.status} />}
                  {appForSelected && <StatusBadge status={appForSelected.status} />}
                  {queuedForSelected && <Badge variant="info">Queue: {queuedForSelected.status}</Badge>}
                </div>
                {ev && ev.eligibility.status !== "Eligible" && <p className={cn("text-sm", ev.eligibility.status === "Ineligible" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300")}>{ev.eligibility.reasons.join(" ")}</p>}
                {ev && (
                  <ul className="grid gap-1 text-sm">
                    {ev.whyMatch.slice(0, 3).map((w) => (
                      <li key={w} className="text-emerald-700 dark:text-emerald-300">✓ {w}</li>
                    ))}
                    {ev.whyNot.slice(0, 3).map((w) => (
                      <li key={w} className="text-muted-foreground">✗ {w}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  {!appForSelected && !queuedForSelected && ev?.eligibility.status !== "Ineligible" && (
                    <ActionForm action={applyOneAction}>
                      <input type="hidden" name="jobId" value={selected.jobId} />
                      <SubmitButton variant="brand" size="sm">
                        Apply now
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {selected.job.applyUrl && (
                    <Button asChild size="sm" variant="outline">
                      <a href={selected.job.sourceUrl || selected.job.applyUrl} target="_blank" rel="noopener noreferrer">
                        View original posting <ExternalLink />
                      </a>
                    </Button>
                  )}
                  <form action={matchStatusAction}>
                    <input type="hidden" name="jobId" value={selected.jobId} />
                    <input type="hidden" name="op" value={selected.status === "saved" ? "unsave" : "save"} />
                    <Button size="sm" variant="ghost" type="submit">
                      <Bookmark /> {selected.status === "saved" ? "Saved" : "Save"}
                    </Button>
                  </form>
                  <form action={matchStatusAction}>
                    <input type="hidden" name="jobId" value={selected.jobId} />
                    <input type="hidden" name="op" value={selected.status === "skipped" ? "unsave" : "not-interested"} />
                    <Button size="sm" variant="ghost" type="submit">
                      <ThumbsDown /> {selected.status === "skipped" ? "Undo not interested" : "Not interested"}
                    </Button>
                  </form>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/jobs/${selected.jobId}`}>Full analysis</Link>
                  </Button>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Description</h3>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground max-h-[28rem] overflow-y-auto">{selected.job.description || "No description."}</div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Source: {selected.job.source} {selected.job.duplicateOfId && "· duplicate of another listing"}
                </p>
              </Card>
            ) : (
              <EmptyState title="Select a job">Click a job on the left to see its details.</EmptyState>
            )}
          </div>

          {/* Right panel: assistant */}
          <aside className="grid gap-4 content-start lg:col-span-2 2xl:col-span-1">
            <Card className="p-4 grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Assistant status</div>
                  <div className={cn("font-medium text-sm", status.state === "applying" && "text-primary", stopped && "text-red-600", status.state === "cap" && "text-amber-600")}>
                    {status.state === "applying" ? "Applying… " : ""}
                    {status.message}
                  </div>
                </div>
                <form action={stopAllAction}>
                  <input type="hidden" name="stop" value={stopped ? "0" : "1"} />
                  <Button size="sm" variant={stopped ? "brand" : "destructive"} type="submit">
                    {stopped ? "Start" : "Stop all"}
                  </Button>
                </form>
              </div>
              <div className="text-xs text-muted-foreground">
                Today: {queue.cap.used}/{queue.cap.cap} applications · {queue.counts.review ?? 0} waiting for your review · {queue.counts["needs-you"] ?? 0} need you ·{" "}
                <Link href="/apply-queue" className="text-primary underline">
                  open queue
                </Link>
              </div>
              {queue.recent.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Recently applied</div>
                  <div className="flex flex-wrap gap-1.5">
                    {queue.recent.map((r) => (
                      <Initials key={r.id} name={r.job.company.name} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground mb-1">Up next</div>
                {queue.upNext.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Queue is empty. Use “Apply to all” or “Apply now”.</p>
                ) : (
                  <ol className="grid gap-1 text-sm">
                    {queue.upNext.map((q) => (
                      <li key={q.id} className="flex items-center gap-2">
                        <Initials name={q.job.company.name} />
                        <span className="min-w-0 flex-1 truncate">
                          {q.job.title} <span className="text-muted-foreground">· {q.job.company.name}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{q.status === "queued" ? q.score : q.status}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {(savedSearches.length > 0 || watchers.length > 0) && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Saved searches</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...watchers, ...savedSearches].map((s) => (
                      <Link
                        key={s.id}
                        href={`/jobs?${filtersToQuery({ ...parseJson<FeedFilters>(s.filters, {}), ...(s.filters === "{}" ? { q: parseJson<string[]>(s.includeKeywords, [])[0] } : {}) })}`}
                        className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
                      >
                        {s.name.replace(/^Keep applying: /, "")}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <AssistantChat />
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
