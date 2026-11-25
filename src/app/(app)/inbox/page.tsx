import Link from "next/link";
import { Inbox as InboxIcon, Mail, PenSquare, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson, timeAgo, cn } from "@/lib/utils";
import { CATEGORIES } from "@/lib/inbox/classify";
import { gmailConfigured } from "@/lib/inbox/mailbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { connectImapAction, deleteDraftAction, disconnectMailboxAction, linkEmailAction, markAllReadAction, saveDraftAction, setEmailCategoryAction, syncNowAction } from "@/app/actions/inbox";

export const metadata = { title: "Inbox" };

const TABS = ["All", "Interview", "Recruiter", "Assessment", "Offer", "Rejection", "Reminder", "Applied", "Verification", "Drafts"];
const TONE: Record<string, BadgeVariant> = { Interview: "success", Offer: "success", Recruiter: "info", Assessment: "info", Rejection: "danger", Applied: "default", Verification: "muted", Reminder: "warning", Other: "muted", Drafts: "outline", Sent: "outline" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; from?: string; id?: string; compose?: string; error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const userId = await requireUserId();
  const tab = TABS.includes(sp.tab ?? "") ? sp.tab! : "All";
  const [boxes, settings, counts] = await Promise.all([
    db.mailbox.findMany({ where: { userId } }),
    db.userSettings.findUnique({ where: { userId } }),
    db.email.groupBy({ by: ["category"], where: { userId, read: false }, _count: true }),
  ]);
  const where = {
    userId,
    ...(tab === "Drafts" ? { status: { in: ["draft", "sent"] } } : { direction: "in", ...(tab !== "All" ? { category: tab } : {}) }),
    ...(sp.from ? { fromAddress: sp.from } : {}),
    ...(sp.q ? { OR: [{ subject: { contains: sp.q } }, { bodyText: { contains: sp.q } }, { fromName: { contains: sp.q } }, { fromAddress: { contains: sp.q } }] } : {}),
  };
  const emails = await db.email.findMany({ where, orderBy: { date: "desc" }, take: 150, include: { application: { include: { job: true } } } });
  const selected = sp.id ? await db.email.findFirst({ where: { id: sp.id, userId }, include: { application: { include: { job: { include: { company: true } } } } } }) : null;
  if (selected && !selected.read) await db.email.update({ where: { id: selected.id }, data: { read: true } });
  const senders = await db.email.groupBy({ by: ["fromAddress"], where: { userId, direction: "in" }, _count: true, orderBy: { _count: { fromAddress: "desc" } }, take: 25 });
  const apps = selected ? await db.application.findMany({ where: { userId }, include: { job: { include: { company: true } } }, orderBy: { updatedAt: "desc" }, take: 80 }) : [];
  const unread = Object.fromEntries(counts.map((c) => [c.category, c._count]));
  const totalUnread = counts.reduce((n, c) => n + c._count, 0);
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q: sp.q, from: sp.from, ...p })) if (v) u.set(k, v);
    return `/inbox?${u}`;
  };
  const draft = sp.compose ? (sp.compose === "new" ? null : await db.email.findFirst({ where: { id: sp.compose, userId } })) : null;
  const replyTo = draft && draft.direction === "in" ? draft : null;

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Job-related emails from your mailbox: interview invites, rejections, confirmations and verification codes. Applications update automatically. Nothing is ever sent unless you click Send."
        actions={
          boxes.length ? (
            <>
              <ActionForm action={syncNowAction}>
                <SubmitButton variant="outline" pendingText="Syncing…">
                  <RefreshCw /> Sync now
                </SubmitButton>
              </ActionForm>
              <Button asChild variant="brand">
                <Link href={qs({ compose: "new", id: undefined })}>
                  <PenSquare /> Compose
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />
      {sp.error && <Alert variant="danger" className="mb-4">{sp.error}</Alert>}
      {sp.connected && <Alert variant="success" className="mb-4">Gmail connected (read-only).</Alert>}

      {boxes.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Connect your mailbox</CardTitle>
              <CardDescription>Easiest: IMAP with an app password (works with Gmail and Outlook). The password is stored encrypted on this computer and only job-related emails are imported.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={connectImapAction} className="grid gap-3">
                <Field label="Provider">
                  <Select name="preset" defaultValue="gmail">
                    <option value="gmail">Gmail</option>
                    <option value="outlook">Outlook / Hotmail / Microsoft 365</option>
                    <option value="">Other (enter servers)</option>
                  </Select>
                </Field>
                <Field label="Email address">
                  <Input name="email" type="email" required autoComplete="email" />
                </Field>
                <Field label="App password" hint="Not your normal password – see the steps on the right.">
                  <PasswordInput name="password" required autoComplete="off" />
                </Field>
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">Other provider: server settings</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input name="imapHost" placeholder="IMAP host" />
                    <Input name="imapPort" placeholder="993" />
                    <Input name="smtpHost" placeholder="SMTP host" />
                    <Input name="smtpPort" placeholder="465" />
                  </div>
                </details>
                <SubmitButton variant="brand" pendingText="Connecting & importing…">
                  Connect
                </SubmitButton>
              </ActionForm>
              <p className="mt-3 text-sm text-muted-foreground">
                Or{" "}
                {gmailConfigured() ? (
                  <a className="text-primary underline" href="/api/inbox/gmail">
                    sign in with Google (read-only)
                  </a>
                ) : (
                  <>sign in with Google (read-only) after adding <code>GOOGLE_CLIENT_ID</code>/<code>GOOGLE_CLIENT_SECRET</code> to .env</>
                )}
                . Google sign-in can read but not send.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How to create a Gmail app password</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 grid gap-1.5 text-sm">
                <li>Open <b>myaccount.google.com</b> and sign in.</li>
                <li>Go to <b>Security</b> and turn on <b>2-Step Verification</b> (required for app passwords).</li>
                <li>Open <b>myaccount.google.com/apppasswords</b>.</li>
                <li>Type a name like <b>Upvance</b> and click <b>Create</b>.</li>
                <li>Copy the 16-letter password Google shows (spaces don&apos;t matter) and paste it here.</li>
                <li>Gmail IMAP is on by default; if not: Gmail → Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP.</li>
              </ol>
              <Alert variant="info" className="mt-3" title="Tip: use a plus-address for applications">
                Applying as <code>yourname+upvance@gmail.com</code> still lands in your inbox, and makes employer emails easy to spot. Set it in Settings → Application email.
              </Alert>
              {settings?.applicationEmail && <p className="mt-2 text-sm">Your application email: <b>{settings.applicationEmail}</b></p>}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {boxes.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                <Mail className="size-3.5" /> {b.email} · {b.kind === "gmail" ? "Gmail (read-only)" : "IMAP"} · {b.status === "error" ? <span className="text-red-600">error: {b.lastError}</span> : `synced ${timeAgo(b.lastSyncAt)}`}
                <form action={disconnectMailboxAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className="text-xs text-muted-foreground hover:text-destructive">
                    disconnect
                  </button>
                </form>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => (
              <Link key={t} href={qs({ tab: t, id: undefined })} role="tab" aria-selected={t === tab} className={cn("rounded-full border px-3 py-1.5 text-sm", t === tab ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent")}>
                {t}
                {t === "All" ? (totalUnread ? ` (${totalUnread})` : "") : unread[t] ? ` (${unread[t]})` : ""}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex flex-1 gap-2 min-w-64" action="/inbox">
              <input type="hidden" name="tab" value={tab} />
              <Input name="q" defaultValue={sp.q} placeholder="Search emails" />
              <Select name="from" defaultValue={sp.from ?? ""} className="max-w-64" aria-label="Filter by email address">
                <option value="">All senders</option>
                {senders.map((s) => (
                  <option key={s.fromAddress} value={s.fromAddress}>
                    {s.fromAddress} ({s._count})
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <form action={markAllReadAction}>
              <input type="hidden" name="category" value={tab} />
              <Button type="submit" variant="ghost">
                Mark all read
              </Button>
            </form>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Card className="divide-y overflow-hidden content-start lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto">
              {emails.length === 0 && <EmptyState icon={<InboxIcon className="size-7" />} title="No emails here" />}
              {emails.map((e) => (
                <Link key={e.id} href={e.status === "draft" ? qs({ compose: e.id, id: undefined }) : qs({ id: e.id, compose: undefined })} className={cn("block p-3 hover:bg-muted/40", sp.id === e.id && "bg-primary/5", !e.read && "font-semibold")}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="truncate flex-1">{e.direction === "out" ? `To: ${e.toAddress}` : e.fromName || e.fromAddress}</span>
                    <span className="text-xs text-muted-foreground font-normal">{timeAgo(e.date)}</span>
                  </div>
                  <div className="truncate text-sm">{e.subject || "(no subject)"}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={TONE[e.status === "draft" ? "Drafts" : e.category] ?? "muted"}>{e.status === "draft" ? "Draft" : e.category}</Badge>
                    {e.application && <span className="truncate text-xs text-muted-foreground font-normal">→ {e.application.job.title}</span>}
                  </div>
                </Link>
              ))}
            </Card>

            <div className="content-start">
              {sp.compose ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{draft && draft.status === "draft" ? "Edit draft" : replyTo ? "Reply" : "New message"}</CardTitle>
                    <CardDescription>Saved as a draft. It&apos;s only sent when you click Send.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ActionForm action={saveDraftAction} className="grid gap-3">
                      {draft?.status === "draft" && <input type="hidden" name="draftId" value={draft.id} />}
                      <input type="hidden" name="inReplyTo" value={replyTo?.messageId ?? draft?.inReplyTo ?? ""} />
                      <Field label="To">
                        <Input name="to" defaultValue={replyTo?.fromAddress ?? draft?.toAddress ?? ""} required />
                      </Field>
                      <Field label="Subject">
                        <Input name="subject" defaultValue={replyTo ? `Re: ${replyTo.subject.replace(/^re:\s*/i, "")}` : draft?.subject ?? ""} required />
                      </Field>
                      <Textarea name="text" rows={10} defaultValue={draft?.status === "draft" ? draft.bodyText : replyTo ? `\n\n---\nOn ${replyTo.date.toLocaleString("en-GB")}, ${replyTo.fromName || replyTo.fromAddress} wrote:\n${replyTo.bodyText.slice(0, 1500).replace(/^/gm, "> ")}` : ""} />
                      <div className="flex gap-2">
                        <SubmitButton variant="outline" name="send" value="0">
                          Save draft
                        </SubmitButton>
                        <SubmitButton variant="brand" name="send" value="1" pendingText="Sending…">
                          Send
                        </SubmitButton>
                      </div>
                    </ActionForm>
                    {draft?.status === "draft" && (
                      <form action={deleteDraftAction} className="mt-2">
                        <input type="hidden" name="id" value={draft.id} />
                        <Button size="sm" variant="ghost" type="submit" className="text-destructive">
                          Delete draft
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              ) : selected ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{selected.subject || "(no subject)"}</CardTitle>
                    <CardDescription>
                      {selected.fromName} &lt;{selected.fromAddress}&gt; · {selected.date.toLocaleString("en-GB")} · to {selected.toAddress}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={TONE[selected.category] ?? "muted"}>{selected.category}</Badge>
                      <span className="text-xs text-muted-foreground">classified by {selected.classifiedBy}</span>
                      <form action={setEmailCategoryAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={selected.id} />
                        <Select name="category" defaultValue={selected.category} className="h-8 w-36">
                          {CATEGORIES.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </Select>
                        <Button size="sm" variant="ghost" type="submit">
                          Change
                        </Button>
                      </form>
                    </div>
                    <form action={linkEmailAction} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="hidden" name="id" value={selected.id} />
                      <span className="text-muted-foreground">Application:</span>
                      <Select name="applicationId" defaultValue={selected.applicationId ?? ""} className="h-8 max-w-sm">
                        <option value="">Not linked</option>
                        {apps.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.job.title} – {a.job.company.name} ({a.status})
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="ghost" type="submit">
                        Link
                      </Button>
                      {selected.application && (
                        <Link className="text-primary underline" href={`/applications/${selected.application.id}`}>
                          open
                        </Link>
                      )}
                    </form>
                    {parseJson<string[]>(selected.codes, []).length > 0 && <Alert variant="info">Verification code(s): {parseJson<string[]>(selected.codes, []).join(", ")} – the apply engine can use these within 10 minutes.</Alert>}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed border-t pt-4">{selected.bodyText}</div>
                    <Button asChild variant="outline" className="justify-self-start">
                      <Link href={qs({ compose: selected.id, id: undefined })}>
                        <PenSquare /> Reply (draft)
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <EmptyState icon={<Mail className="size-7" />} title="Select an email" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
