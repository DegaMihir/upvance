import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Download, ExternalLink, Puzzle, ShieldAlert, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { formatDate, parseJson } from "@/lib/utils";
import { resumeFromProfile, type ResumeDoc } from "@/lib/resume/document";
import type { Change } from "@/lib/resume/tailor";
import type { GuardIssue } from "@/lib/resume/guard";
import type { ScreeningAnswer } from "@/lib/writing/screening";
import type { ValidationState } from "@/lib/applications";
import { POST_SUBMIT } from "@/lib/applications";
import { atsSupport } from "@/lib/ats";
import { decryptSecret } from "@/lib/crypto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/form";
import { StatusBadge } from "@/components/domain/badges";
import { ResumeDiff } from "@/components/domain/resume-diff";
import { ResumeEditor } from "@/components/domain/resume-editor";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  acknowledgeAction,
  addCoverLetterAction,
  confirmSubmittedAction,
  coverLetterAction,
  markFailedAction,
  prepareAgainAction,
  resumeDecisionAction,
  saveAnswersAction,
  saveNotesAction,
  setOutcomeAction,
  withdrawAction,
} from "@/app/actions/applications";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await db.application.findUnique({ where: { id }, select: { job: { select: { title: true, company: { select: { name: true } } } } } });
  return { title: app ? `Application: ${app.job.title} – ${app.job.company.name}` : "Application" };
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const app = await db.application.findFirst({
    where: { id, userId },
    include: { job: { include: { company: true } }, profile: true, tailoredResume: true, events: { orderBy: { createdAt: "desc" } } },
  });
  if (!app) notFound();
  const settings = await db.userSettings.findUnique({ where: { userId } });
  // Tolerate older or seeded rows whose saved validation is not the { checks, acknowledged } shape.
  const savedValidation = parseJson<Partial<ValidationState> | null>(app.validation, null);
  const v: ValidationState = {
    checks: Array.isArray(savedValidation?.checks) ? savedValidation.checks : [],
    acknowledged: Array.isArray(savedValidation?.acknowledged) ? savedValidation.acknowledged : [],
  };
  const answers = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []);
  const tr = app.tailoredResume;
  const original = tr ? parseJson<ResumeDoc>(tr.original, resumeFromProfile(app.profile)) : resumeFromProfile(app.profile);
  const tailored = tr ? parseJson<ResumeDoc>(tr.tailored, original) : original;
  const changes = tr ? parseJson<Change[]>(tr.changes, []) : [];
  const guard = tr ? parseJson<GuardIssue[]>(tr.guardLog, []) : [];
  const submitted = POST_SUBMIT.includes(app.status as never);
  const preSubmit = !submitted;
  const support = atsSupport(app.job.atsType, !!decryptSecret(settings?.encryptedAppPassword));
  const resumeVersion = tr?.status === "use-original" ? "original" : "tailored";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={app.job.title}
        description={
          <>
            <Link href={`/jobs/${app.jobId}`} className="hover:underline">
              {app.job.company.name} · {app.job.location || "location not stated"}
            </Link>{" "}
            · profile “{app.profile.name}” · {app.origin} · created {formatDate(app.createdAt)}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={app.status} />
            {app.failed && <Badge variant="danger">Failed</Badge>}
          </div>
        }
      />

      {app.status === "Needs you" && (
        <Alert variant="warning" title="Needs you">
          This application is paused until the items below are fixed or confirmed.
        </Alert>
      )}
      {app.status === "Ready" && (
        <Alert variant="success" title="Ready for assisted apply">
          Everything checks out. Open the employer form, let the extension fill it (or copy the answers), review, and click Submit yourself.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 grid gap-6 content-start">
          {/* Validation */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Pre-submission checks</CardTitle>
                <CardDescription>Missing or uncertain items pause the application under “Needs you”.</CardDescription>
              </div>
              {preSubmit && (
                <ActionForm action={prepareAgainAction}>
                  <input type="hidden" name="id" value={app.id} />
                  <SubmitButton size="sm" variant="outline" pendingText="Preparing…">
                    Regenerate documents
                  </SubmitButton>
                </ActionForm>
              )}
            </CardHeader>
            <CardContent className="grid gap-2">
              {v.checks.length === 0 && <p className="text-sm text-muted-foreground">Not validated yet.</p>}
              {v.checks.map((c) => {
                const acked = v.acknowledged.includes(c.id);
                const Icon = c.ok || acked ? CheckCircle2 : c.level === "warn" ? Circle : XCircle;
                return (
                  <div key={c.id} className="flex items-start gap-3 rounded-md border p-2.5 text-sm">
                    <Icon className={`size-4 mt-0.5 shrink-0 ${c.ok || acked ? "text-emerald-600" : c.level === "warn" ? "text-amber-500" : "text-red-500"}`} />
                    <div className="flex-1">
                      <div className="font-medium">
                        {c.label} {acked && <span className="text-xs text-muted-foreground">(you confirmed)</span>}
                      </div>
                      <div className="text-muted-foreground">{c.detail}</div>
                    </div>
                    {!c.ok && c.acknowledgeable && !acked && preSubmit && (
                      <form action={acknowledgeAction}>
                        <input type="hidden" name="id" value={app.id} />
                        <input type="hidden" name="checkId" value={c.id} />
                        <Button size="sm" variant="outline" type="submit">
                          I&apos;ve checked this
                        </Button>
                      </form>
                    )}
                    {!c.ok && c.id === "candidate" && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/profile/${app.profileId}`}>Fix profile</Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Resume */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Resume</CardTitle>
                <CardDescription>
                  Mode: {tr?.mode ?? settings?.resumeMode} · generated by {tr?.generator ?? "—"} · status: <b>{tr?.status ?? "not prepared"}</b> · {changes.length} change(s)
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/resume/${app.id}?format=pdf&version=${resumeVersion}`}>
                    <Download /> PDF
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/resume/${app.id}?format=docx&version=${resumeVersion}`}>
                    <Download /> DOCX
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {guard.length > 0 && (
                <Alert variant="warning" title={`${guard.length} AI edit(s) reverted by the truthfulness guard`}>
                  <ul className="list-disc pl-4">
                    {guard.slice(0, 6).map((g, i) => (
                      <li key={i}>
                        {g.where}: {g.reason}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {tr && <ResumeDiff original={original} tailored={tailored} />}
              {changes.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-primary">List of every change ({changes.length})</summary>
                  <ul className="mt-2 grid gap-1 text-xs">
                    {changes.map((c, i) => (
                      <li key={i} className="rounded border p-2">
                        <b>{c.section}</b> – {c.kind}
                        <div className="text-red-600 dark:text-red-400">− {c.before}</div>
                        <div className="text-emerald-700 dark:text-emerald-400">+ {c.after}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {tr && preSubmit && (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={resumeDecisionAction}>
                    <input type="hidden" name="id" value={app.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <SubmitButton variant="brand" size="sm" disabled={tr.status === "approved"}>
                      {tr.status === "approved" ? "Approved ✓" : "Approve tailored resume"}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={resumeDecisionAction}>
                    <input type="hidden" name="id" value={app.id} />
                    <input type="hidden" name="decision" value="use-original" />
                    <SubmitButton variant="outline" size="sm" disabled={tr.status === "use-original"}>
                      Use original instead
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
              {tr && preSubmit && (
                <details>
                  <summary className="cursor-pointer text-sm text-primary">Edit the tailored version</summary>
                  <div className="mt-3">
                    <ResumeEditor appId={app.id} doc={tailored} />
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          {/* Cover letter */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Cover letter</CardTitle>
                <CardDescription>
                  Employer policy: {app.job.coverLetterPolicy} · status: <b>{app.coverLetterStatus}</b>
                </CardDescription>
              </div>
              {app.coverLetter && (
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/cover-letter/${app.id}`}>
                    <Download /> PDF
                  </a>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {app.coverLetterNeeded && app.coverLetter ? (
                <ActionForm action={coverLetterAction} className="grid gap-3">
                  <input type="hidden" name="id" value={app.id} />
                  <Textarea name="text" rows={14} defaultValue={app.coverLetter} disabled={!preSubmit} />
                  {preSubmit && (
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="decision" value="approved" variant="brand" size="sm">
                        Save & approve
                      </SubmitButton>
                      <SubmitButton name="decision" value="draft" variant="outline" size="sm">
                        Save draft
                      </SubmitButton>
                      <SubmitButton name="decision" value="not-needed" variant="ghost" size="sm">
                        Don&apos;t send a cover letter
                      </SubmitButton>
                    </div>
                  )}
                </ActionForm>
              ) : (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  No cover letter (the employer doesn&apos;t ask for one).
                  {preSubmit && (
                    <form action={addCoverLetterAction}>
                      <input type="hidden" name="id" value={app.id} />
                      <Button size="sm" variant="outline" type="submit">
                        Write one anyway
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Screening answers */}
          <Card>
            <CardHeader>
              <CardTitle>Screening answers</CardTitle>
              <CardDescription>Filled only from your profile. Empty answers need you – Upvance never guesses.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveAnswersAction} className="grid gap-3">
                <input type="hidden" name="id" value={app.id} />
                {answers.map((a) => (
                  <label key={a.id} className="grid gap-1 text-sm">
                    <span className="flex items-center gap-2">
                      {a.question}
                      {a.required && <span className="text-xs text-muted-foreground">(required)</span>}
                      <Badge variant={a.source === "needs-user" && !a.answer ? "warning" : "muted"}>{a.source === "needs-user" && !a.answer ? "needs you" : a.source}</Badge>
                    </span>
                    {a.category === "motivation" ? (
                      <Textarea name={`answer:${a.id}`} rows={3} defaultValue={a.answer} disabled={!preSubmit} />
                    ) : (
                      <Input name={`answer:${a.id}`} defaultValue={a.answer} disabled={!preSubmit} aria-invalid={a.required && !a.answer ? true : undefined} />
                    )}
                  </label>
                ))}
                {preSubmit && <SubmitButton variant="outline">Save answers</SubmitButton>}
              </ActionForm>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 content-start">
          {/* Assisted apply */}
          <Card className={app.status === "Ready" ? "border-primary/50" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="size-4" /> Assisted apply
              </CardTitle>
              <CardDescription>{support.note}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <ol className="list-decimal pl-5 grid gap-1 text-muted-foreground">
                <li>Open the employer&apos;s form.</li>
                <li>Click the Upvance extension → “Fill this form”. It fills fields and attaches your documents.</li>
                {settings?.reviewBeforeSubmit !== false && <li>Review every field on the form.</li>}
                <li>Click Submit on the employer&apos;s site yourself.</li>
                <li>Come back and confirm below.</li>
              </ol>
              <Button asChild variant={app.status === "Ready" ? "brand" : "outline"} disabled={!app.job.applyUrl}>
                <a href={app.job.applyUrl} target="_blank" rel="noopener noreferrer">
                  Open employer form <ExternalLink />
                </a>
              </Button>
              {app.status === "Ready" && (
                <ActionForm action={confirmSubmittedAction} className="grid gap-2 rounded-lg border p-3">
                  <input type="hidden" name="id" value={app.id} />
                  <label className="flex gap-2">
                    <input type="checkbox" name="confirm" className="mt-1 size-4" />
                    <span>I submitted this application on the employer&apos;s site.</span>
                  </label>
                  <SubmitButton variant="brand" size="sm">
                    Confirm submission
                  </SubmitButton>
                </ActionForm>
              )}
              {app.status !== "Ready" && preSubmit && <p className="text-xs text-muted-foreground">You can confirm submission once all checks pass (status “Ready”).</p>}
              {preSubmit && (
                <ActionForm action={markFailedAction} className="flex gap-2">
                  <input type="hidden" name="id" value={app.id} />
                  <Input name="reason" placeholder="What went wrong?" className="h-8" />
                  <SubmitButton size="sm" variant="ghost">
                    Mark failed
                  </SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          {submitted && (
            <Card>
              <CardHeader>
                <CardTitle>Outcome</CardTitle>
                <CardDescription>Recording an interview pauses new applications to this company for {settings?.interviewPauseDays ?? 60} days.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm action={setOutcomeAction} className="grid gap-2">
                  <input type="hidden" name="id" value={app.id} />
                  <Select name="status" defaultValue={app.status}>
                    {POST_SUBMIT.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  <Input name="note" placeholder="Note (optional)" />
                  <SubmitButton size="sm">Update status</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveNotesAction} className="grid gap-2">
                <input type="hidden" name="id" value={app.id} />
                <Textarea name="notes" rows={3} defaultValue={app.notes} />
                <SubmitButton size="sm" variant="outline">
                  Save notes
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm border-l pl-4">
                {app.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                    <div>{e.message}</div>
                    <div className="text-xs text-muted-foreground">{e.createdAt.toLocaleString("en-GB")}</div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {preSubmit && (
            <form action={withdrawAction}>
              <input type="hidden" name="id" value={app.id} />
              <Button variant="ghost" className="text-destructive w-full" type="submit">
                <ShieldAlert /> Discard this application
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
