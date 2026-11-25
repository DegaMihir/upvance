/**
 * Mailbox connections: IMAP + app password (Gmail, Outlook, others), optional
 * Gmail OAuth (read-only), SMTP for sending drafts you approve. Credentials
 * are stored encrypted; nothing is sent unless you click Send.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { db } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { parseJson } from "../utils";
import { ingestEmail, isJobRelated, type IncomingEmail } from "./store";

export const PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; help: string }> = {
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465, help: "Use a Google app password (Google Account → Security → 2-Step Verification → App passwords)." },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp-mail.outlook.com", smtpPort: 587, help: "Use an app password from account.microsoft.com → Security → Advanced security options." },
};

export async function saveImapMailbox(userId: string, input: { email: string; password: string; preset?: string; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }) {
  const p = PRESETS[input.preset ?? ""] ?? null;
  const data = {
    kind: "imap",
    email: input.email.trim(),
    username: input.email.trim(),
    imapHost: input.imapHost || p?.imapHost || "",
    imapPort: input.imapPort || p?.imapPort || 993,
    imapSecure: true,
    smtpHost: input.smtpHost || p?.smtpHost || "",
    smtpPort: input.smtpPort || p?.smtpPort || 465,
    smtpSecure: (input.smtpPort || p?.smtpPort || 465) === 465,
    encryptedPassword: encryptSecret(input.password.replace(/\s+/g, "")),
    status: "new",
    lastError: null,
  };
  const existing = await db.mailbox.findFirst({ where: { userId, email: data.email } });
  return existing ? db.mailbox.update({ where: { id: existing.id }, data }) : db.mailbox.create({ data: { userId, ...data } });
}

function imapClient(m: { imapHost: string; imapPort: number; imapSecure: boolean; username: string; encryptedPassword: string | null }) {
  const pass = decryptSecret(m.encryptedPassword);
  if (!pass) throw new Error("Mailbox password missing or can't be decrypted – reconnect the mailbox.");
  return new ImapFlow({ host: m.imapHost, port: m.imapPort, secure: m.imapSecure, auth: { user: m.username, pass }, logger: false, socketTimeout: 60_000 });
}

export async function testMailbox(id: string) {
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  if (m.kind === "gmail") return gmailProfile(m.id);
  const client = imapClient(m);
  await client.connect();
  const status = await client.status("INBOX", { messages: true });
  await client.logout();
  await db.mailbox.update({ where: { id }, data: { status: "ok", lastError: null } });
  return `Connected – ${status ? (status.messages ?? 0) : 0} messages in your inbox.`;
}

/** Fetch new job-related emails since the last sync (first sync: last 30 days). */
export async function syncMailbox(id: string, opts: { days?: number; max?: number } = {}) {
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  if (m.kind === "gmail") return syncGmail(id, opts);
  const client = imapClient(m);
  let stored = 0;
  let seen = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mb = client.mailbox as { uidValidity?: bigint };
      const validity = String(mb.uidValidity ?? "");
      const startUid = m.uidValidity === validity && m.lastUid ? m.lastUid + 1 : null;
      const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
      const uids = ((await client.search(startUid ? { uid: `${startUid}:*` } : { since }, { uid: true })) || []) as number[];
      let maxUid = m.lastUid ?? 0;
      // envelopes first; download bodies only for job-related messages
      for await (const msg of client.fetch(uids.slice(-(opts.max ?? 500)), { uid: true, envelope: true }, { uid: true })) {
        seen++;
        maxUid = Math.max(maxUid, msg.uid);
        const env = msg.envelope;
        if (!env) continue;
        const from = env.from?.[0];
        const to = (env.to ?? []).map((t) => t.address).join(", ");
        const quick = { fromAddress: from?.address ?? "", fromName: from?.name ?? "", toAddress: to, subject: env.subject ?? "", bodyText: "" };
        if (!(await isJobRelated(m.userId, quick))) continue;
        const full = await client.fetchOne(String(msg.uid), { source: true }, { uid: true });
        if (!full || !full.source) continue;
        const parsed = await simpleParser(full.source);
        const email: IncomingEmail = {
          messageId: parsed.messageId ?? `${m.id}:${msg.uid}`,
          uid: msg.uid,
          fromAddress: quick.fromAddress,
          fromName: quick.fromName,
          toAddress: to,
          subject: parsed.subject ?? quick.subject,
          bodyText: parsed.text ?? (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : ""),
          date: parsed.date ?? (env.date ? new Date(env.date) : new Date()),
          inReplyTo: parsed.inReplyTo ?? undefined,
        };
        const r = await ingestEmail(m.userId, email, { mailboxId: m.id });
        if (r.created) stored++;
      }
      await db.mailbox.update({ where: { id }, data: { lastUid: maxUid || m.lastUid, uidValidity: validity, lastSyncAt: new Date(), status: "ok", lastError: null } });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    await db.mailbox.update({ where: { id }, data: { status: "error", lastError: (e as Error).message.slice(0, 300) } });
    throw e;
  }
  return { seen, stored };
}

// ---------------------------------------------------------------- Gmail OAuth (read-only scope)
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function gmailConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
export function gmailAuthUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function gmailExchange(userId: string, code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!tok.access_token) throw new Error(`Google sign-in failed: ${tok.error ?? res.status}`);
  const profile = (await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tok.access_token}` } })).json()) as { emailAddress?: string };
  const tokens = encryptSecret(JSON.stringify({ ...tok, expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000 }));
  const email = profile.emailAddress ?? "gmail";
  const existing = await db.mailbox.findFirst({ where: { userId, email, kind: "gmail" } });
  return existing ? db.mailbox.update({ where: { id: existing.id }, data: { encryptedTokens: tokens, status: "ok" } }) : db.mailbox.create({ data: { userId, kind: "gmail", email, encryptedTokens: tokens, status: "ok" } });
}
async function gmailToken(id: string) {
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  const t = parseJson<{ access_token: string; refresh_token?: string; expires_at: number }>(decryptSecret(m.encryptedTokens), null as never);
  if (!t) throw new Error("Gmail tokens missing – reconnect.");
  if (t.expires_at > Date.now() + 60_000) return t.access_token;
  if (!t.refresh_token) throw new Error("Gmail session expired – reconnect.");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: t.refresh_token, grant_type: "refresh_token" }) });
  const n = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!n.access_token) throw new Error("Couldn't refresh Gmail access – reconnect.");
  await db.mailbox.update({ where: { id }, data: { encryptedTokens: encryptSecret(JSON.stringify({ ...t, access_token: n.access_token, expires_at: Date.now() + (n.expires_in ?? 3600) * 1000 })) } });
  return n.access_token;
}
async function gmailProfile(id: string) {
  const token = await gmailToken(id);
  const p = (await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${token}` } })).json()) as { emailAddress?: string; messagesTotal?: number };
  return `Connected to ${p.emailAddress} – ${p.messagesTotal ?? 0} messages.`;
}
async function syncGmail(id: string, opts: { days?: number; max?: number }) {
  const m = await db.mailbox.findUniqueOrThrow({ where: { id } });
  const token = await gmailToken(id);
  const after = Math.floor((m.lastSyncAt?.getTime() ?? Date.now() - (opts.days ?? 30) * 86_400_000) / 1000);
  const list = (await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`after:${after}`)}&maxResults=${opts.max ?? 200}`, { headers: { authorization: `Bearer ${token}` } })).json()) as { messages?: { id: string }[] };
  let stored = 0;
  for (const { id: gid } of list.messages ?? []) {
    const msg = (await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gid}?format=full`, { headers: { authorization: `Bearer ${token}` } })).json()) as GmailMessage;
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const fromRaw = h("from");
    const fromAddress = fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw;
    const email: IncomingEmail = { messageId: h("message-id") || gid, fromAddress, fromName: fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim(), toAddress: h("to"), subject: h("subject"), bodyText: gmailText(msg.payload), date: new Date(Number(msg.internalDate)) };
    if (!(await isJobRelated(m.userId, email))) continue;
    if ((await ingestEmail(m.userId, email, { mailboxId: m.id })).created) stored++;
  }
  await db.mailbox.update({ where: { id }, data: { lastSyncAt: new Date(), status: "ok", lastError: null } });
  return { seen: list.messages?.length ?? 0, stored };
}
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
type GmailMessage = { internalDate: string; payload?: GmailPart };
function gmailText(p?: GmailPart): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const c of p.parts ?? []) {
    const t = gmailText(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ");
  return "";
}

// ---------------------------------------------------------------- SMTP (send only when you click Send)
export async function sendEmail(mailboxId: string, msg: { to: string; subject: string; text: string; inReplyTo?: string | null }) {
  const m = await db.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  if (m.kind !== "imap" || !m.smtpHost) throw new Error("Sending needs an IMAP/SMTP mailbox with an app password.");
  const transport = nodemailer.createTransport({ host: m.smtpHost, port: m.smtpPort, secure: m.smtpSecure, auth: { user: m.username, pass: decryptSecret(m.encryptedPassword)! } });
  return transport.sendMail({ from: m.email, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}) });
}

export async function syncAllMailboxes(log: (s: string) => void = () => {}) {
  let total = 0;
  for (const m of await db.mailbox.findMany({ where: { status: { not: "disabled" } } })) {
    try {
      const r = await syncMailbox(m.id);
      total += r.stored;
      if (r.stored) log(`Inbox ${m.email}: ${r.stored} new job email(s).`);
    } catch (e) {
      log(`Inbox ${m.email} sync failed: ${(e as Error).message}`);
    }
  }
  return total;
}
