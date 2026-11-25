/** Optional daily digest email (sent to yourself through your connected mailbox). */
import { db } from "./db";
import { sendEmail } from "./inbox/mailbox";
import { brand } from "@/config/brand";

export async function buildDigest(userId: string, since = new Date(Date.now() - 86_400_000)) {
  const [submitted, events, emails, needsYou, review, queued] = await Promise.all([
    db.application.findMany({ where: { userId, submittedAt: { gte: since } }, include: { job: { include: { company: true } } } }),
    db.applicationEvent.findMany({ where: { application: { userId }, type: "outcome", createdAt: { gte: since } }, include: { application: { include: { job: { include: { company: true } } } } } }),
    db.email.findMany({ where: { userId, direction: "in", date: { gte: since } } }),
    db.application.count({ where: { userId, status: "Needs you" } }),
    db.applyJob.count({ where: { userId, status: "review" } }),
    db.applyJob.count({ where: { userId, status: "queued" } }),
  ]);
  const by = new Map<string, number>();
  for (const e of emails) by.set(e.category, (by.get(e.category) ?? 0) + 1);
  const lines = [
    `${brand.name} – your day (${new Date().toDateString()})`,
    "",
    `Applications submitted: ${submitted.length}`,
    ...submitted.slice(0, 15).map((a) => `  • ${a.job.title} – ${a.job.company.name}`),
    "",
    `Status updates: ${events.length}`,
    ...events.slice(0, 15).map((e) => `  • ${e.application.job.company.name}: ${e.message}`),
    "",
    `Job emails: ${emails.length}${by.size ? ` (${Array.from(by.entries()).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}`,
    `Waiting for your review: ${review} · Needs you: ${needsYou} · Still queued: ${queued}`,
    "",
    "Open Upvance: http://localhost:" + (process.env.PORT || 3100),
  ];
  return { subject: `${brand.name} digest: ${submitted.length} applied, ${events.length} updates`, text: lines.join("\n") };
}

export async function sendDigests(now = new Date()) {
  const users = await db.userSettings.findMany({ where: { digestEnabled: true } });
  let sent = 0;
  for (const s of users) {
    if (s.lastDigestAt && now.getTime() - s.lastDigestAt.getTime() < 20 * 3_600_000) continue;
    const box = await db.mailbox.findFirst({ where: { userId: s.userId, kind: "imap" } });
    if (!box) continue;
    const d = await buildDigest(s.userId);
    await sendEmail(box.id, { to: s.digestEmailTo || box.email, subject: d.subject, text: d.text });
    await db.userSettings.update({ where: { id: s.id }, data: { lastDigestAt: now } });
    sent++;
  }
  return sent;
}
