/**
 * Recruiter outreach – human in the loop. Upvance drafts; YOU send.
 * The app never logs into LinkedIn or sends messages itself.
 */
import { db } from "./db";
import { runAI } from "./ai";
import { OUTREACH_SYSTEM, outreachPrompt } from "./ai/prompts";
import { hashKey } from "./text";
import { skillSet } from "./skills";
import { checkText } from "./resume/guard";
import { resumeFromProfile, resumeText, type ResumeDoc } from "./resume/document";
import { getDefaultProfile, analysisOf } from "./matching";
import { parseJson } from "./utils";

export class OutreachBlockedError extends Error {}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

export function outreachTemplate(d: { recruiter: { name: string; title: string; company: string }; role: string; doc: ResumeDoc; matched: string[]; seed: string }) {
  const latest = d.doc.experiences[0];
  const years = d.doc.summary.match(/(\d+)\+? years/)?.[1];
  const variant = parseInt(hashKey(d.seed).slice(0, 6), 16) % 3;
  const greet = ["Hi", "Hello", "Hi"][variant];
  const roleLine = d.role
    ? `I'm interested in the ${d.role} role at ${d.recruiter.company}`
    : `I'm exploring opportunities at ${d.recruiter.company}`;
  const intro = latest
    ? `I'm currently ${/^[aeiou]/i.test(latest.title) ? "an" : "a"} ${latest.title} at ${latest.company}${years ? ` with ${years} years of experience` : ""}`
    : `I'm ${d.doc.headline || "a professional"}`;
  const skills = d.matched.length ? `, working mainly with ${d.matched.slice(0, 3).join(", ")}` : "";
  const ask = d.role
    ? ["If you're the right person for this role, I'd be grateful to know whether my background could be a fit – or who I should speak to.", "Would you be open to a quick look at my profile, or could you point me to the right contact for this role?", "If it makes sense, I'd really appreciate a referral or a pointer to the hiring manager."][variant]
    : "If there's a team that might be a good fit, I'd be grateful for a pointer to the right person.";
  return `${greet} ${firstName(d.recruiter.name)},\n\n${roleLine}. ${intro}${skills}. ${ask}\n\nThank you for your time!\n${d.doc.name}`;
}

export async function draftOutreach(
  userId: string,
  input: { recruiterId: string; jobId?: string | null; role?: string; useAI?: boolean },
): Promise<{ outreachId: string; message: string; generator: "ai" | "template"; note?: string; resumeLabel: string }> {
  const recruiter = await db.recruiter.findFirstOrThrow({ where: { id: input.recruiterId, userId } });
  const jobKey = input.jobId || "none";
  const existing = await db.outreach.findUnique({ where: { recruiterId_jobKey: { recruiterId: recruiter.id, jobKey } } });
  if (existing && existing.status !== "Draft") {
    throw new OutreachBlockedError(
      `You already messaged ${recruiter.name} about ${input.jobId ? "this job" : "general opportunities"} (${existing.status.toLowerCase()} ${existing.sentAt?.toDateString() ?? ""}). Use a follow-up instead of a second first message.`,
    );
  }
  const job = input.jobId ? await db.job.findFirst({ where: { id: input.jobId }, include: { company: true } }) : null;
  // Pick the tailored resume for this job (approved first), else the default profile
  const tailored = job
    ? (await db.tailoredResume.findFirst({ where: { userId, jobId: job.id, status: "approved" } })) ?? (await db.tailoredResume.findFirst({ where: { userId, jobId: job.id } }))
    : null;
  const profile = await getDefaultProfile(userId);
  if (!profile) throw new Error("Create a profile first.");
  const doc = tailored ? parseJson<ResumeDoc>(tailored.tailored, resumeFromProfile(profile)) : resumeFromProfile(profile);
  const resumeLabel = tailored ? `Tailored resume for ${job?.title} (${tailored.status})` : `${profile.name} (original)`;
  const role = input.role || job?.title || "";
  const jobSkills = job ? analysisOf(job).requiredSkills : [];
  const matched = jobSkills.length ? doc.skills.filter((s) => skillSet(jobSkills).has(s.toLowerCase())) : doc.skills.slice(0, 3);
  const rec = { name: recruiter.name, title: recruiter.title, company: recruiter.company || job?.company.name || "" };

  let message = outreachTemplate({ recruiter: rec, role, doc, matched, seed: `${recruiter.id}|${jobKey}` });
  let generator: "ai" | "template" = "template";
  let note: string | undefined;
  if (input.useAI !== false) {
    const res = await runAI<string>({
      role: "writing",
      task: "outreach",
      userId,
      input: {
        system: OUTREACH_SYSTEM,
        prompt: outreachPrompt({ recruiter: rec, role, candidate: { name: doc.name, headline: doc.headline, summary: doc.summary, experiences: doc.experiences.slice(0, 2), projects: doc.projects, skills: doc.skills }, matched }),
        maxTokens: 400,
        temperature: 0.7,
      },
    });
    if (res.ok) {
      const full = `${resumeText(doc)}\n${rec.name}\n${rec.company}\n${rec.title}\n${role}`;
      const problem = checkText(res.data, full, full, doc.skills);
      if (problem) note = `AI draft rejected: it ${problem}. Using the template.`;
      else {
        message = res.data.trim();
        generator = "ai";
      }
    } else note = res.reason;
  }

  const settings = await db.userSettings.findUnique({ where: { userId } });
  const data = { jobId: job?.id ?? null, role, message, tailoredResumeId: tailored?.id ?? null, status: "Draft" };
  const saved = existing
    ? await db.outreach.update({ where: { id: existing.id }, data })
    : await db.outreach.create({ data: { userId, recruiterId: recruiter.id, jobKey, ...data } });
  void settings;
  return { outreachId: saved.id, message, generator, note, resumeLabel };
}

export async function markOutreachSent(userId: string, id: string) {
  const o = await db.outreach.findFirstOrThrow({ where: { id, userId } });
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const days = settings?.outreachFollowUpDays ?? 7;
  return db.outreach.update({ where: { id: o.id }, data: { status: "Sent", sentAt: new Date(), followUpAt: new Date(Date.now() + days * 86_400_000) } });
}

export async function recordOutreachResponse(userId: string, id: string, response: string, status: "Responded" | "No response") {
  await db.outreach.findFirstOrThrow({ where: { id, userId } });
  return db.outreach.update({ where: { id }, data: { status, response: response || null, responseAt: status === "Responded" ? new Date() : null, followUpAt: null } });
}

/** A polite follow-up – only offered after the follow-up date, and only if there was no response. */
export async function followUpDraft(userId: string, id: string) {
  const o = await db.outreach.findFirstOrThrow({ where: { id, userId }, include: { recruiter: true } });
  if (o.status !== "Sent") throw new OutreachBlockedError("Follow-ups are only for sent messages without a response.");
  if (!o.followUpAt || o.followUpAt > new Date()) throw new OutreachBlockedError(`Too early to follow up – wait until ${o.followUpAt?.toDateString()}.`);
  if (o.followUps >= 1) throw new OutreachBlockedError("You've already followed up once. It's best not to send more.");
  const profile = await getDefaultProfile(userId);
  return `Hi ${firstName(o.recruiter.name)}, just following up on my note about ${o.role ? `the ${o.role} role` : "opportunities"} at ${o.recruiter.company}. I'd still love to hear if my background could be a fit – no worries if the timing isn't right. Thanks again!\n${profile?.fullName ?? ""}`.trim();
}

export async function markFollowUpSent(userId: string, id: string) {
  const o = await db.outreach.findFirstOrThrow({ where: { id, userId } });
  return db.outreach.update({ where: { id }, data: { followUps: { increment: 1 }, followUpAt: null, sentAt: o.sentAt } });
}

export async function upsertRecruiter(userId: string, r: { name: string; title?: string; company?: string; profileUrl?: string }) {
  const existing = r.profileUrl
    ? await db.recruiter.findFirst({ where: { userId, profileUrl: r.profileUrl } })
    : await db.recruiter.findFirst({ where: { userId, name: r.name, company: r.company ?? "" } });
  if (existing) return db.recruiter.update({ where: { id: existing.id }, data: { title: r.title || existing.title, company: r.company || existing.company } });
  return db.recruiter.create({ data: { userId, name: r.name.trim(), title: r.title?.trim() ?? "", company: r.company?.trim() ?? "", profileUrl: r.profileUrl ?? "" } });
}
