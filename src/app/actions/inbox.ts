"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { saveImapMailbox, sendEmail, syncMailbox, testMailbox } from "@/lib/inbox/mailbox";
import { applyEmailToApplication } from "@/lib/inbox/store";
import { errorMessage, type ActionResult } from "./types";

export async function connectImapAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email address and the app password." };
  try {
    const m = await saveImapMailbox(userId, {
      email,
      password,
      preset: String(fd.get("preset") ?? ""),
      imapHost: String(fd.get("imapHost") ?? "") || undefined,
      imapPort: Number(fd.get("imapPort")) || undefined,
      smtpHost: String(fd.get("smtpHost") ?? "") || undefined,
      smtpPort: Number(fd.get("smtpPort")) || undefined,
    });
    const msg = await testMailbox(m.id);
    const r = await syncMailbox(m.id, { days: 30 });
    revalidatePath("/inbox");
    return { ok: `${msg} Imported ${r.stored} job-related email(s) from the last 30 days.` };
  } catch (e) {
    return { error: `Couldn't connect: ${errorMessage(e)}. Check the app password and that IMAP is enabled.` };
  }
}

export async function syncNowAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const boxes = await db.mailbox.findMany({ where: { userId } });
  if (!boxes.length) return { error: "Connect a mailbox first." };
  let stored = 0;
  try {
    for (const b of boxes) stored += (await syncMailbox(b.id)).stored;
    revalidatePath("/inbox");
    return { ok: `Synced – ${stored} new job email(s).` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function disconnectMailboxAction(fd: FormData) {
  const userId = await requireUserId();
  await db.mailbox.deleteMany({ where: { id: String(fd.get("id")), userId } });
  revalidatePath("/inbox");
}

export async function markAllReadAction(fd: FormData) {
  const userId = await requireUserId();
  const category = String(fd.get("category") ?? "");
  await db.email.updateMany({ where: { userId, read: false, ...(category && category !== "All" ? { category } : {}) }, data: { read: true } });
  revalidatePath("/inbox");
}

export async function setEmailCategoryAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const category = String(fd.get("category"));
  const e = await db.email.findFirst({ where: { id, userId } });
  if (!e) return;
  await db.email.update({ where: { id }, data: { category, classifiedBy: "you" } });
  if (e.applicationId) await applyEmailToApplication(userId, e.applicationId, id);
  revalidatePath("/inbox");
}

export async function linkEmailAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const applicationId = String(fd.get("applicationId") ?? "");
  const app = applicationId ? await db.application.findFirst({ where: { id: applicationId, userId }, include: { job: { include: { company: true } } } }) : null;
  await db.email.updateMany({ where: { id, userId }, data: { applicationId: app?.id ?? null, companyName: app?.job.company.name ?? null } });
  if (app) await applyEmailToApplication(userId, app.id, id);
  revalidatePath("/inbox");
}

export async function saveDraftAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const to = String(fd.get("to") ?? "").trim();
  const subject = String(fd.get("subject") ?? "").trim();
  const text = String(fd.get("text") ?? "");
  const id = String(fd.get("draftId") ?? "");
  const inReplyTo = String(fd.get("inReplyTo") ?? "") || null;
  const send = fd.get("send") === "1";
  if (!to || !subject) return { error: "Add a recipient and a subject." };
  try {
    const draft = id
      ? await db.email.update({ where: { id }, data: { toAddress: to, subject, bodyText: text, snippet: text.slice(0, 200) } })
      : await db.email.create({ data: { userId, messageId: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`, direction: "out", status: "draft", toAddress: to, subject, bodyText: text, snippet: text.slice(0, 200), category: "Drafts", inReplyTo, read: true } });
    if (send) {
      const box = await db.mailbox.findFirst({ where: { userId, kind: "imap" } });
      if (!box) return { error: "Sending needs a connected IMAP mailbox (with SMTP). Your draft is saved." };
      const info = await sendEmail(box.id, { to, subject, text, inReplyTo: draft.inReplyTo });
      await db.email.update({ where: { id: draft.id }, data: { status: "sent", category: "Sent", date: new Date(), messageId: info.messageId || draft.messageId, mailboxId: box.id } });
      revalidatePath("/inbox");
      return { ok: `Sent to ${to}.` };
    }
    revalidatePath("/inbox");
    return { ok: "Draft saved. It's only sent when you click Send." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteDraftAction(fd: FormData) {
  const userId = await requireUserId();
  await db.email.deleteMany({ where: { id: String(fd.get("id")), userId, status: "draft" } });
  revalidatePath("/inbox");
}
