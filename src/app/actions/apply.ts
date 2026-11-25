"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseFilters, type FeedFilters } from "@/lib/feed";
import { applyToAll, previewApplyAll, saveWatcher, setWatcher } from "@/lib/apply/queue";
import { approveReview, retryApplyJob, skipApplyJob, stopAll } from "@/lib/apply/engine";
import { errorMessage, type ActionResult } from "./types";

function filtersFrom(fd: FormData): FeedFilters {
  return parseFilters(Object.fromEntries(new URLSearchParams(String(fd.get("filters") ?? ""))));
}

export async function previewApplyAllAction(query: string, policy: "review" | "auto") {
  const userId = await requireUserId();
  const p = await previewApplyAll(userId, parseFilters(Object.fromEntries(new URLSearchParams(query))), { policy });
  return { matched: p.matched, count: p.candidates.length, needsReview: p.needsReview, estimatedMinutes: p.estimatedMinutes, skipped: p.skipped, cap: p.cap, daysNeeded: p.daysNeeded, description: p.description, top: p.candidates.slice(0, 5) };
}

export async function applyToAllAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const policy = fd.get("policy") === "auto" ? "auto" : "review";
    const r = await applyToAll(userId, filtersFrom(fd), { policy });
    revalidatePath("/jobs");
    revalidatePath("/apply-queue");
    return { ok: `${r.queued} job(s) queued. The apply engine works through them one at a time, best match first${r.queued > r.cap.remaining ? ` – ${r.queued - r.cap.remaining} will wait for the next day(s) because of your daily cap` : ""}.`, warn: policy === "review" ? "Review before submit is ON: each filled form waits for your Approve in the Apply queue." : undefined };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function keepApplyingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const filters = filtersFrom(fd);
    const s = await saveWatcher(userId, filters, {
      name: String(fd.get("name") ?? "") || undefined,
      policy: fd.get("policy") === "auto" ? "auto" : "review",
      intervalMin: Number(fd.get("interval")) || 60,
      minBand: filters.band ?? "Good",
    });
    revalidatePath("/jobs");
    return { ok: `Watching “${s.name}”. New matching jobs will be queued automatically (checked every ${s.checkIntervalMin} min).` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function toggleWatcherAction(fd: FormData) {
  const userId = await requireUserId();
  await setWatcher(userId, String(fd.get("id")), fd.get("on") === "1");
  revalidatePath("/jobs");
}

export async function deleteWatcherAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  await setWatcher(userId, id, false);
  await db.savedSearch.deleteMany({ where: { id, userId } });
  revalidatePath("/jobs");
}

export async function stopAllAction(fd: FormData) {
  await requireUserId();
  await stopAll(fd.get("stop") === "1");
  revalidatePath("/jobs");
  revalidatePath("/apply-queue");
}

export async function queueItemAction(fd: FormData) {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const op = String(fd.get("op"));
  if (op === "approve") await approveReview(userId, id);
  if (op === "skip") await skipApplyJob(userId, id);
  if (op === "retry") await retryApplyJob(userId, id);
  revalidatePath("/apply-queue");
  revalidatePath("/jobs");
}

export async function matchStatusAction(fd: FormData) {
  const userId = await requireUserId();
  const jobId = String(fd.get("jobId"));
  const op = String(fd.get("op"));
  const data = op === "save" ? { status: "saved", skipReason: null } : op === "not-interested" ? { status: "skipped", skipReason: "Not interested" } : { status: "new", skipReason: null };
  await db.match.updateMany({ where: { userId, jobId }, data });
  revalidatePath("/jobs");
}

export async function applyOneAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const jobId = String(fd.get("jobId"));
  try {
    const p = await previewApplyAll(userId, { eligibility: "all", skipped: true }, { rows: (await db.match.findMany({ where: { userId, jobId }, include: { job: { include: { company: true } } } })) });
    if (!p.candidates.length) return { error: p.skipped[0]?.reason ?? "This job can't be queued." };
    const settings = await db.userSettings.findUnique({ where: { userId } });
    const { enqueue } = await import("@/lib/apply/queue");
    await enqueue(userId, p.candidates, { policy: (settings?.defaultSubmitPolicy as "review" | "auto") ?? "review", source: "manual" });
    revalidatePath("/jobs");
    return { ok: "Added to the apply queue – the engine will fill it and (by default) wait for your review." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
