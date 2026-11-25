import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { deleteOutreachAction, followUpAction, newOutreachAction, saveOutreachAction } from "@/app/actions/outreach";

export const metadata = { title: "Recruiter outreach" };

export default async function OutreachPage() {
  const userId = await requireUserId();
  const [items, jobs] = await Promise.all([
    db.outreach.findMany({ where: { userId }, include: { recruiter: true, job: { include: { company: true } }, tailoredResume: true }, orderBy: { createdAt: "desc" } }),
    db.job.findMany({ where: { isActive: true, matches: { some: { userId, eligibility: { not: "Ineligible" } } } }, include: { company: true }, orderBy: { postedAt: "desc" }, take: 100 }),
  ]);
  const now = new Date();
  const sent = items.filter((i) => i.status !== "Draft");
  const responded = items.filter((i) => i.status === "Responded").length;
  return (
    <>
      <PageHeader
        title="Recruiter outreach"
        description="Upvance drafts short, personal messages. You review, edit and send them yourself – the app never logs into LinkedIn or sends anything on its own."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>New message</CardTitle>
            <CardDescription>Paste the name, title and company you can see on their profile (or use the extension&apos;s “Capture recruiter”).</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={newOutreachAction} className="grid gap-3">
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Title">
                <Input name="title" placeholder="e.g. Technical Recruiter" />
              </Field>
              <Field label="Company">
                <Input name="company" />
              </Field>
              <Field label="Profile URL (optional)">
                <Input name="profileUrl" type="url" />
              </Field>
              <Field label="Job (optional)" hint="Selects the matching tailored resume">
                <Select name="jobId" defaultValue="">
                  <option value="">No specific job</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} – {j.company.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role (if no job selected)">
                <Input name="role" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="useAI" value="off" className="size-4" /> Template only (no AI)
              </label>
              <SubmitButton variant="brand" pendingText="Drafting…">
                Draft message
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 grid gap-4 content-start">
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Sent</div>
              <div className="text-2xl font-bold">{sent.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Responses</div>
              <div className="text-2xl font-bold">{responded}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Response rate</div>
              <div className="text-2xl font-bold">{sent.length ? Math.round((responded / sent.length) * 100) : 0}%</div>
            </Card>
          </div>
          {items.length === 0 && (
            <EmptyState icon={<MessagesSquare className="size-8" />} title="No outreach yet">
              Draft your first message on the left.
            </EmptyState>
          )}
          {items.map((o) => {
            const dueFollowUp = o.status === "Sent" && o.followUpAt && o.followUpAt <= now && o.followUps === 0;
            return (
              <Card key={o.id}>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {o.recruiter.name} <span className="font-normal text-muted-foreground">· {o.recruiter.title || "—"} at {o.recruiter.company || o.job?.company.name || "—"}</span>
                    </CardTitle>
                    <CardDescription>
                      {o.job ? (
                        <Link className="underline" href={`/jobs/${o.job.id}`}>
                          {o.job.title}
                        </Link>
                      ) : (
                        o.role || "General"
                      )}{" "}
                      · created {formatDate(o.createdAt)}
                      {o.sentAt && ` · sent ${formatDate(o.sentAt)}`}
                      {o.followUpAt && o.status === "Sent" && ` · follow up from ${formatDate(o.followUpAt)}`}
                      {o.followUps > 0 && ` · followed up`}
                      {" · resume: "}
                      {o.tailoredResume ? `tailored (${o.tailoredResume.status})` : "default profile"}
                    </CardDescription>
                  </div>
                  <Badge variant={o.status === "Responded" ? "success" : o.status === "Sent" ? "info" : o.status === "No response" ? "muted" : "warning"}>{o.status}</Badge>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {dueFollowUp && <Alert variant="info">No reply yet – a polite follow-up is now appropriate.</Alert>}
                  <ActionForm action={saveOutreachAction} className="grid gap-2">
                    <input type="hidden" name="id" value={o.id} />
                    <Textarea name="message" rows={6} defaultValue={o.message} disabled={o.status !== "Draft"} />
                    {o.response && <p className="text-sm">Response: {o.response}</p>}
                    <div className="flex flex-wrap gap-2 items-center">
                      <CopyButton text={o.message} />
                      {o.status === "Draft" && (
                        <>
                          <SubmitButton size="sm" variant="outline" name="decision" value="save">
                            Save edits
                          </SubmitButton>
                          <SubmitButton size="sm" variant="brand" name="decision" value="sent">
                            I sent it
                          </SubmitButton>
                        </>
                      )}
                      {o.status === "Sent" && (
                        <>
                          <Input name="response" placeholder="Their reply (optional)" className="h-8 max-w-xs" />
                          <SubmitButton size="sm" variant="outline" name="decision" value="responded">
                            They replied
                          </SubmitButton>
                          <SubmitButton size="sm" variant="ghost" name="decision" value="no-response">
                            No response
                          </SubmitButton>
                        </>
                      )}
                    </div>
                  </ActionForm>
                  {o.status === "Sent" && o.followUps === 0 && (
                    <ActionForm action={followUpAction} className="flex flex-wrap gap-2 items-center">
                      <input type="hidden" name="id" value={o.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Draft follow-up
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {dueFollowUp && (
                    <ActionForm action={saveOutreachAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <SubmitButton size="sm" variant="ghost" name="decision" value="followup-sent">
                        I sent the follow-up
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {o.status === "Draft" && (
                    <form action={deleteOutreachAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button size="sm" variant="ghost" className="text-destructive" type="submit">
                        Delete draft
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
