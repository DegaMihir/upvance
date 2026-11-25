"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  DuplicateError,
  acknowledgeCheck,
  confirmSubmitted,
  createApplication,
  markFailed,
  prepareApplication,
  saveAnswers,
  setCoverLetter,
  setOutcome,
  setResumeStatus,
  logEvent,
  type AppStatus,
} from "@/lib/applications";
import type { ResumeDoc } from "@/lib/resume/document";
import { errorMessage, type ActionResult } from "./types";

function refresh(id?: string) {
  revalidatePath("/applications");
  if (id) revalidatePath(`/applications/${id}`);
  revalidatePath("/dashboard");
}

export async function startApplicationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const jobId = String(fd.get("jobId"));
  const profileId = String(fd.get("profileId") ?? "") || null;
  let appId: string;
  try {
    const app = await createApplication(userId, jobId, { profileId, origin: "manual" });
    appId = app.id;
    await prepareApplication(app.id, userId, { useAI: fd.get("useAI") !== "off" });
  } catch (e) {
    if (e instanceof DuplicateError) return { error: `Blocked: ${e.message}` };
    return { error: errorMessage(e) };
  }
  refresh();
  redirect(`/applications/${appId}`);
}

export async function prepareAgainAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  try {
    const r = await prepareApplication(id, userId, { useAI: fd.get("useAI") !== "off" });
    refresh(id);
    return { ok: `Documents regenerated. Status: ${r.status}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function resumeDecisionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision")) as "approved" | "use-original" | "draft";
  try {
    let edited: ResumeDoc | undefined;
    if (fd.get("doc")) edited = JSON.parse(String(fd.get("doc"))) as ResumeDoc;
    const r = await setResumeStatus(id, userId, decision, edited);
    refresh(id);
    return { ok: decision === "approved" ? `Resume approved. Status: ${r.status}.` : decision === "use-original" ? `Using your original resume. Status: ${r.status}.` : "Edits saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function coverLetterAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision")) as "draft" | "approved" | "not-needed";
  const text = fd.has("text") ? String(fd.get("text")) : null;
  try {
    const r = await setCoverLetter(id, userId, text, decision);
    refresh(id);
    return { ok: decision === "approved" ? `Cover letter approved. Status: ${r.status}.` : decision === "not-needed" ? "Cover letter removed." : "Saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function addCoverLetterAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  await db.application.updateMany({ where: { id, userId }, data: { coverLetterNeeded: true } });
  await prepareApplication(id, userId, { useAI: true });
  refresh(id);
}

export async function saveAnswersAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const updates = Array.from(fd.entries())
    .filter(([k]) => k.startsWith("answer:"))
    .map(([k, v]) => ({ id: k.slice(7), answer: String(v).trim() }));
  try {
    const r = await saveAnswers(id, userId, updates);
    refresh(id);
    return { ok: `Answers saved. Status: ${r.status}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function acknowledgeAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  await acknowledgeCheck(id, userId, String(fd.get("checkId")));
  refresh(id);
}

export async function confirmSubmittedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm you submitted the application on the employer's site." };
  try {
    await confirmSubmitted(id, userId, { confirmed: true, via: "app" });
    refresh(id);
    return { ok: "Recorded as submitted. Good luck!" };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function markFailedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  try {
    await markFailed(id, userId, String(fd.get("reason") || "Submission failed"));
    refresh(id);
    return { ok: "Marked as failed. It won't count against your daily cap." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function setOutcomeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  try {
    await setOutcome(id, userId, String(fd.get("status")) as AppStatus, String(fd.get("note") ?? "") || undefined);
    refresh(id);
    return { ok: "Status updated." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveNotesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  await db.application.updateMany({ where: { id, userId }, data: { notes: String(fd.get("notes") ?? "").slice(0, 5000) } });
  await logEvent(id, "note", "Notes updated.");
  refresh(id);
  return { ok: "Notes saved." };
}

export async function withdrawAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const app = await db.application.findFirst({ where: { id, userId } });
  if (app && ["Saved", "Preparing", "Needs you", "Ready"].includes(app.status)) {
    await db.application.delete({ where: { id } });
    await db.match.updateMany({ where: { userId, jobId: app.jobId }, data: { status: "new" } });
  }
  refresh();
  redirect("/applications");
}
