"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { draftOutreach, followUpDraft, markFollowUpSent, markOutreachSent, recordOutreachResponse, upsertRecruiter } from "@/lib/outreach";
import { errorMessage, type ActionResult } from "./types";

export async function newOutreachAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Enter the recruiter's name." };
  try {
    const recruiter = await upsertRecruiter(userId, {
      name,
      title: String(fd.get("title") ?? ""),
      company: String(fd.get("company") ?? ""),
      profileUrl: String(fd.get("profileUrl") ?? ""),
    });
    const r = await draftOutreach(userId, { recruiterId: recruiter.id, jobId: String(fd.get("jobId") ?? "") || null, role: String(fd.get("role") ?? ""), useAI: fd.get("useAI") !== "off" });
    revalidatePath("/outreach");
    return { ok: `Draft ready (${r.generator}). Review it below, copy it and send it yourself.`, warn: r.note };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveOutreachAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision") ?? "save");
  try {
    if (fd.has("message")) await db.outreach.updateMany({ where: { id, userId, status: "Draft" }, data: { message: String(fd.get("message")).slice(0, 3000) } });
    if (decision === "sent") await markOutreachSent(userId, id);
    if (decision === "responded") await recordOutreachResponse(userId, id, String(fd.get("response") ?? ""), "Responded");
    if (decision === "no-response") await recordOutreachResponse(userId, id, "", "No response");
    if (decision === "followup-sent") await markFollowUpSent(userId, id);
    revalidatePath("/outreach");
    return { ok: decision === "sent" ? "Marked as sent by you. We'll suggest a follow-up later if there's no reply." : "Saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function followUpAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const text = await followUpDraft(userId, String(fd.get("id")));
    return { ok: text };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteOutreachAction(fd: FormData) {
  const userId = await requireUserId();
  await db.outreach.deleteMany({ where: { id: String(fd.get("id")), userId, status: "Draft" } });
  revalidatePath("/outreach");
}
