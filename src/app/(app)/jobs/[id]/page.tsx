import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink, Sparkles, XCircle, AlertTriangle, Info } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson, formatDate, formatMoney, timeAgo } from "@/lib/utils";
import { analysisOf, evaluateJob, loadUserContext } from "@/lib/matching";
import { WEIGHT_LABELS, type WeightKey } from "@/lib/matching/scoring";
import { atsSupport, ATS_LABEL, type AtsType } from "@/lib/ats";
import { countryName } from "@/lib/countries";
import { decryptSecret } from "@/lib/crypto";
import { aiAvailable } from "@/lib/ai";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Progress } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { BandBadge, EligibilityBadge, RemoteBadge, ScoreRing, SponsorshipBadge, StatusBadge } from "@/components/domain/badges";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { analyzeWithAiAction, skipJobAction } from "@/app/actions/jobs";
import { startApplicationAction } from "@/app/actions/applications";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id }, select: { title: true, company: { select: { name: true } } } });
  return { title: job ? `${job.title} – ${job.company.name}` : "Job" };
}

export default async function JobDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ note?: string }> }) {
  const { id } = await params;
  const { note } = await searchParams;
  const userId = await requireUserId();
  const job = await db.job.findUnique({ where: { id }, include: { company: true } });
  if (!job) notFound();
  const [ctx, match, profiles, apps, settings, hasAi] = await Promise.all([
    loadUserContext(userId),
    db.match.findUnique({ where: { userId_jobId: { userId, jobId: id } } }),
    db.profile.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.application.findMany({ where: { userId, jobId: id }, include: { tailoredResume: true } }),
    db.userSettings.findUnique({ where: { userId } }),
    aiAvailable("analysis", userId),
  ]);
  const a = analysisOf(job);
  const ev = ctx.candidate ? evaluateJob(job, ctx.candidate, ctx.prefs, ctx.weights) : null;
  const sponsorship = a.sponsorship as typeof a.sponsorship & { officialLists?: { list: string; country: string; confidence: string; demo: boolean }[] };
  const support = atsSupport(job.atsType, !!decryptSecret(settings?.encryptedAppPassword));
  const app = apps[0];
  const band = ev ? (ev.eligibility.status === "Ineligible" ? "Ineligible" : ev.band) : match?.band ?? "Poor";
  const matched = new Set(ev?.breakdown.matchedSkills.map((s) => s.toLowerCase()) ?? []);

  return (
    <div className="grid gap-6">
      {note && <Alert variant="warning" title="AI note">{note} The rule-based analysis is shown.</Alert>}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {ev && <ScoreRing score={ev.score} band={band} />}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
          <p className="text-muted-foreground">
            <Link href={`/companies/${job.companyId}`} className="hover:underline">
              {job.company.name}
            </Link>{" "}
            · {job.location || "Location not stated"} · posted {timeAgo(job.postedAt)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <BandBadge band={band} score={ev?.score} />
            {ev && <EligibilityBadge status={ev.eligibility.status} />}
            <SponsorshipBadge category={job.sponsorshipCategory} />
            <RemoteBadge category={a.remote.category} countries={a.remote.countries} />
            <Badge variant="outline">{a.source === "ai" ? "Analysed with AI" : "Rule-based analysis"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.applyUrl && (
            <Button asChild variant="outline">
              <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                Original posting <ExternalLink />
              </a>
            </Button>
          )}
          <form action={skipJobAction}>
            <input type="hidden" name="jobId" value={job.id} />
            {match?.status === "skipped" ? (
              <>
                <input type="hidden" name="undo" value="1" />
                <Button variant="ghost" type="submit">Un-skip</Button>
              </>
            ) : (
              <Button variant="ghost" type="submit">Skip</Button>
            )}
          </form>
        </div>
      </div>

      {ev?.eligibility.status === "Ineligible" && (
        <Alert variant="danger" title={`Ineligible – even though the suitability score is ${ev.score}`}>
          <ul className="list-disc pl-4">{ev.eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Alert>
      )}
      {ev?.eligibility.status === "Needs review" && (
        <Alert variant="warning" title="Needs review">
          <ul className="list-disc pl-4">{ev.eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Alert>
      )}
      {match?.status === "skipped" && <Alert variant="info" title="Skipped">{match.skipReason ?? "You skipped this job."}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2 content-start">
          {ev && (
            <Card>
              <CardHeader>
                <CardTitle>Why you match / don&apos;t match</CardTitle>
                <CardDescription>Plain-English summary based on your default profile. The score measures job suitability, not interview probability.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ul className="grid gap-2 text-sm">
                  {ev.whyMatch.length === 0 && <li className="text-muted-foreground">No strong matching signals.</li>}
                  {ev.whyMatch.map((w) => (
                    <li key={w} className="flex gap-2">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" /> {w}
                    </li>
                  ))}
                </ul>
                <ul className="grid gap-2 text-sm">
                  {ev.whyNot.length === 0 && <li className="text-muted-foreground">No gaps found.</li>}
                  {ev.whyNot.map((w) => (
                    <li key={w} className="flex gap-2">
                      <XCircle className="size-4 text-red-500 shrink-0 mt-0.5" /> {w}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {ev && (
            <Card>
              <CardHeader>
                <CardTitle>Score breakdown</CardTitle>
                <CardDescription>Each part is scored 0–100, then weighted. Change weights in Settings.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {(Object.keys(ev.breakdown.components) as WeightKey[]).map((k) => (
                  <div key={k} className="grid grid-cols-[150px_1fr_80px] items-center gap-3 text-sm">
                    <span>{WEIGHT_LABELS[k]}</span>
                    <Progress value={ev.breakdown.components[k]} />
                    <span className="text-right tabular-nums text-muted-foreground">
                      {ev.breakdown.components[k]} × {ev.breakdown.weights[k]}%
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Job breakdown</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row k="Seniority" v={a.seniority} />
                <Row k="Experience" v={a.experienceYears ? `${a.experienceYears.min ?? "?"}${a.experienceYears.max ? `–${a.experienceYears.max}` : "+"} years` : "Not stated"} />
                <Row k="Employment type" v={a.employmentType ?? "Not stated"} />
                <Row k="Salary" v={formatMoney(job.salaryMin ?? a.salary?.min, job.salaryMax ?? a.salary?.max, job.salaryCurrency ?? a.salary?.currency) ?? "Not stated"} />
                <Row k="Degree" v={a.degree ?? "Not stated"} />
                <Row k="Cover letter" v={{ required: "Required", optional: "Accepted (optional)", none: "Not wanted", unknown: "Unknown" }[a.coverLetter]} />
                <Row k="Relocation" v={a.relocation.required ? "Required" : a.relocation.offered ? "Support offered" : "Not mentioned"} />
                <Row k="Job countries" v={(a.remote.countries.length ? a.remote.countries : a.locationCountries).map(countryName).join(", ") || "Unclear"} />
              </dl>
              {a.summary && <p className="text-muted-foreground">{a.summary}</p>}
              <div>
                <h4 className="font-medium mb-2">Skills</h4>
                <div className="flex flex-wrap gap-1.5">
                  {a.requiredSkills.map((s) => (
                    <Badge key={s} variant={matched.has(s.toLowerCase()) ? "success" : "danger"} title={matched.has(s.toLowerCase()) ? "On your profile" : "Missing from your profile"}>
                      {matched.has(s.toLowerCase()) ? "✓" : "✗"} {s}
                    </Badge>
                  ))}
                  {a.niceToHaveSkills.filter((s) => !a.requiredSkills.includes(s)).map((s) => (
                    <Badge key={s} variant="outline">
                      nice: {s}
                    </Badge>
                  ))}
                  {a.requiredSkills.length === 0 && <span className="text-muted-foreground">No recognised skills.</span>}
                </div>
              </div>
              <ListBlock title="Responsibilities" items={a.responsibilities} />
              <ListBlock title="Qualifications" items={a.qualifications} />
              {a.locationRestrictions.length > 0 && <ListBlock title="Location restrictions (quoted)" items={a.locationRestrictions} quote />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Full description</CardTitle>
              <CardDescription>
                Source: {job.source === "remoteok" ? "Remote OK" : job.source}
                {job.sourceUrl && (
                  <>
                    {" · "}
                    <a href={job.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">
                      {job.sourceUrl.slice(0, 80)}
                    </a>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <details>
                <summary className="cursor-pointer text-sm text-primary">Show description</summary>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{job.description || "No description."}</div>
              </details>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 content-start">
          <Card>
            <CardHeader>
              <CardTitle>Apply</CardTitle>
              <CardDescription>Prepares a tailored resume, cover letter and answers for your review. Nothing is sent without you.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {app ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    Application <StatusBadge status={app.status} />
                  </div>
                  <Button asChild variant="brand">
                    <Link href={`/applications/${app.id}`}>Open application</Link>
                  </Button>
                </>
              ) : (
                <ActionForm action={startApplicationAction} className="grid gap-3">
                  <input type="hidden" name="jobId" value={job.id} />
                  <label className="grid gap-1.5 text-sm">
                    Resume profile
                    <Select name="profileId" defaultValue={profiles.find((p) => p.isDefault)?.id}>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="useAI" value="off" className="size-4" /> Don&apos;t use AI (templates only)
                  </label>
                  <SubmitButton variant="brand" pendingText="Preparing documents…" disabled={ev?.eligibility.status === "Ineligible" && false}>
                    <Sparkles /> Prepare application
                  </SubmitButton>
                  {ev?.eligibility.status === "Ineligible" && <p className="text-xs text-red-600">You can still prepare it, but it will stay in “Needs you” until eligibility is resolved.</p>}
                </ActionForm>
              )}
              <div className={`rounded-md border p-3 text-xs ${support.level === "supported" ? "border-emerald-500/30" : support.level === "unsupported" || support.level === "needs-password" ? "border-red-500/30" : "border-amber-500/30"}`}>
                <div className="font-medium mb-1">
                  Application form: {ATS_LABEL[job.atsType as AtsType] ?? job.atsType}
                </div>
                {support.note}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visa sponsorship</CardTitle>
              <CardDescription>Never a guarantee – check with the employer.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex items-center gap-2">
                <SponsorshipBadge category={job.sponsorshipCategory} /> <span className="text-xs text-muted-foreground">confidence: {sponsorship.confidence}</span>
              </div>
              {sponsorship.existingEmployeesOnly && <Alert variant="warning">Sponsorship only for existing employees.</Alert>}
              <Evidence items={sponsorship.evidence} empty="The posting doesn't mention sponsorship." />
              {sponsorship.officialLists?.length ? (
                <div className="text-xs">
                  <div className="font-medium mb-1">Official sponsor lists</div>
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {sponsorship.officialLists.map((l, i) => (
                      <li key={i}>
                        {l.list} ({countryName(l.country)}) – {l.confidence} confidence name match
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Not found on imported sponsor lists. <Link className="underline" href="/sponsors">Manage lists</Link></p>
              )}
              {a.workAuth.citizenshipRequired.length > 0 && <Alert variant="danger">Citizenship required: {a.workAuth.citizenshipRequired.map((c) => (c === "ANY_LOCAL" ? "local" : countryName(c))).join(", ")}{a.workAuth.securityClearance ? " (security clearance)" : ""}</Alert>}
              {a.workAuth.permanentResidencyRequired && <Alert variant="warning">Permanent residency required.</Alert>}
              {a.workAuth.existingAuthRequired.length > 0 && <Alert variant="warning">Existing work authorization required: {a.workAuth.existingAuthRequired.map((c) => (c === "ANY_LOCAL" ? "job country" : c === "EU" ? "EU" : countryName(c))).join(", ")}</Alert>}
              <Evidence items={a.workAuth.evidence} empty="" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Remote & location</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RemoteBadge category={a.remote.category} countries={a.remote.countries} /> <span className="text-xs text-muted-foreground">confidence: {a.remote.confidence}</span>
              </div>
              {a.remote.regions.length > 0 && <p className="text-xs">Regions: {a.remote.regions.join(", ")}</p>}
              <Evidence items={a.remote.evidence} empty="No location wording found." />
              <p className="text-xs text-muted-foreground flex gap-1">
                <Info className="size-3.5 shrink-0 mt-0.5" /> A job is never treated as eligible just because it says “remote”.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 grid gap-3">
              <ActionForm action={analyzeWithAiAction}>
                <input type="hidden" name="jobId" value={job.id} />
                <SubmitButton variant="outline" className="w-full" pendingText="Analysing…" disabled={!hasAi}>
                  <Sparkles /> {a.source === "ai" ? "Re-analyse with AI" : "Analyse with AI"}
                </SubmitButton>
              </ActionForm>
              {!hasAi && (
                <p className="text-xs text-muted-foreground flex gap-1">
                  <AlertTriangle className="size-3.5" /> No AI key configured – rules only.
                </p>
              )}
              <p className="text-xs text-muted-foreground">Added {formatDate(job.createdAt)} · last analysed {formatDate(job.analyzedAt)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function ListBlock({ title, items, quote }: { title: string; items: string[]; quote?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="font-medium mb-1">{title}</h4>
      <ul className={`list-disc pl-5 grid gap-1 text-muted-foreground ${quote ? "italic" : ""}`}>
        {items.map((i, idx) => (
          <li key={idx}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Evidence({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return empty ? <p className="text-xs text-muted-foreground">{empty}</p> : null;
  return (
    <div className="grid gap-1">
      {items.map((e, i) => (
        <blockquote key={i} className="border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
          “{e}”
        </blockquote>
      ))}
    </div>
  );
}
