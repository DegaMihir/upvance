import Link from "next/link";
import { CheckCircle2, Clock, ExternalLink, PauseCircle, Send, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson, timeAgo } from "@/lib/utils";
import { capInfo } from "@/lib/apply/queue";
import { engineStatus } from "@/lib/apply/engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queueItemAction, stopAllAction } from "@/app/actions/apply";

export const metadata = { title: "Apply queue" };

const GROUPS: { key: string; title: string; statuses: string[]; hint: string }[] = [
  { key: "review", title: "Waiting for your review", statuses: ["review"], hint: "Filled but NOT submitted. Check the screenshot and values, then Approve – the engine submits it next." },
  { key: "needs", title: "Needs you", statuses: ["needs-you", "paused"], hint: "Questions your profile can't answer, CAPTCHAs, accounts or uncertain eligibility." },
  { key: "next", title: "Up next", statuses: ["queued", "running", "approved"], hint: "Processed one at a time, highest match first, within your daily cap." },
  { key: "waiting", title: "Waiting for confirmation", statuses: ["awaiting-confirmation"], hint: "Submit was clicked but no confirmation page appeared – the inbox marks it confirmed when the email arrives." },
  { key: "done", title: "Submitted", statuses: ["submitted"], hint: "Confirmed by a confirmation page or email." },
  { key: "closed", title: "Failed / skipped / stopped", statuses: ["failed", "skipped", "stopped"], hint: "Failed applications don't count against your daily cap." },
];

function Ops({ id, status }: { id: string; status: string }) {
  const op = (name: string, label: string, variant: "brand" | "outline" | "ghost" = "outline") => (
    <form action={queueItemAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={name} />
      <Button size="sm" variant={variant} type="submit">
        {label}
      </Button>
    </form>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {status === "review" && op("approve", "Approve & submit", "brand")}
      {["failed", "paused", "needs-you", "skipped", "stopped", "review"].includes(status) && op("retry", status === "review" ? "Re-fill" : "Retry")}
      {!["submitted", "skipped"].includes(status) && op("skip", "Skip", "ghost")}
    </div>
  );
}

export default async function ApplyQueuePage() {
  const userId = await requireUserId();
  const [jobs, cap, status, settings] = await Promise.all([
    db.applyJob.findMany({ where: { userId }, include: { job: { include: { company: true } }, application: { select: { id: true, status: true } } }, orderBy: [{ updatedAt: "desc" }], take: 300 }),
    capInfo(userId),
    engineStatus(),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const stopped = status.state === "stopped";
  return (
    <>
      <PageHeader
        title="Apply queue"
        description="Applications the apply engine is working on. It runs on your computer in a Chromium window you can watch, one job at a time, at a human pace."
        actions={
          <form action={stopAllAction}>
            <input type="hidden" name="stop" value={stopped ? "0" : "1"} />
            <Button variant={stopped ? "brand" : "destructive"} type="submit">
              {stopped ? "Start the engine" : "Stop all"}
            </Button>
          </form>
        }
      />
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Engine</div>
          <div className="font-semibold">{status.message}</div>
          <div className="text-xs text-muted-foreground">updated {timeAgo(status.at)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Today</div>
          <div className="font-semibold">
            {cap.used} / {cap.cap} applications
          </div>
          <div className="text-xs text-muted-foreground">Change the daily cap in Settings (1–150).</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Mode</div>
          <div className="font-semibold">{settings?.engineHeadless ? "Headless (hidden window)" : "Watch mode (visible window)"}</div>
          <div className="text-xs text-muted-foreground">Default submit policy: {settings?.defaultSubmitPolicy === "auto" ? "auto submit" : "review before submit"}</div>
        </Card>
      </div>
      {!settings?.applicationEmail && (
        <Alert variant="warning" className="mb-4" title="Set your application email">
          Settings → “Automatic applying &amp; inbox” → Application email (a plus-address like name+upvance@gmail.com makes employer emails easy to find).
        </Alert>
      )}
      {jobs.length === 0 && (
        <EmptyState title="The queue is empty">
          Go to <Link href="/jobs" className="underline">Jobs</Link>, set your filters and click “Apply to all”, or “Apply now” on a single job.
        </EmptyState>
      )}
      <div className="grid gap-6">
        {GROUPS.map((g) => {
          const items = jobs.filter((j) => g.statuses.includes(j.status));
          if (!items.length) return null;
          return (
            <Card key={g.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {g.key === "review" ? <Send className="size-4" /> : g.key === "needs" ? <PauseCircle className="size-4" /> : g.key === "done" ? <CheckCircle2 className="size-4" /> : g.key === "closed" ? <XCircle className="size-4" /> : <Clock className="size-4" />}
                  {g.title} <Badge variant="muted">{items.length}</Badge>
                </CardTitle>
                <CardDescription>{g.hint}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {items.map((j) => {
                  const filled = parseJson<{ label: string; value: string; source: string }[]>(j.filledValues, []);
                  const log = parseJson<{ at: string; msg: string }[]>(j.log, []);
                  return (
                    <div key={j.id} className="rounded-lg border p-3 grid gap-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{j.job.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {j.job.company.name} · match {j.score} · {j.policy === "auto" ? "auto submit" : "review before submit"} · {j.source}
                            {j.application && (
                              <>
                                {" · "}
                                <Link className="underline" href={`/applications/${j.application.id}`}>
                                  application ({j.application.status})
                                </Link>
                              </>
                            )}
                            {" · "}
                            <a className="underline inline-flex items-center gap-0.5" href={j.job.applyUrl} target="_blank" rel="noopener noreferrer">
                              form <ExternalLink className="size-3" />
                            </a>
                          </div>
                          {j.reason && <p className="mt-1 text-sm">{j.reason}</p>}
                        </div>
                        <Ops id={j.id} status={j.status} />
                      </div>
                      {(j.status === "review" || j.status === "needs-you") && j.screenshotPath && (
                        <div className="grid gap-3 lg:grid-cols-2">
                          <a href={`/api/apply/screenshot/${j.id}`} target="_blank" rel="noopener noreferrer" className="block max-h-[28rem] overflow-y-auto rounded border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/apply/screenshot/${j.id}`} alt={`Filled application form for ${j.job.title}`} className="w-full" />
                          </a>
                          <Table>
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Filled with</th>
                                <th>From</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filled.map((f, i) => (
                                <tr key={i}>
                                  <td className="max-w-56 truncate" title={f.label}>
                                    {f.label}
                                  </td>
                                  <td className="max-w-64 truncate" title={f.value}>
                                    {f.value}
                                  </td>
                                  <td className="text-xs text-muted-foreground">{f.source}</td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      )}
                      {j.confirmationPath && j.status === "submitted" && (
                        <a href={`/api/apply/screenshot/${j.id}?kind=confirmation`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                          Confirmation screenshot
                        </a>
                      )}
                      {log.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-xs text-primary">Step log ({log.length})</summary>
                          <ol className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                            {log.map((l, i) => (
                              <li key={i}>
                                {new Date(l.at).toLocaleTimeString("en-GB")} – {l.msg}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
