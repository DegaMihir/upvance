"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { applySuggestion, refreshSuggestions } from "@/lib/insights";
import { recomputeMatches } from "@/lib/matching";
import { logActivity } from "@/lib/activity";
import { errorMessage, type ActionResult } from "./types";

export async function refreshSuggestionsAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const n = await refreshSuggestions(userId);
  revalidatePath("/insights");
  return { ok: n ? `${n} new suggestion(s).` : "No new suggestions – keep applying and recording outcomes." };
}

export async function applySuggestionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const s = await applySuggestion(userId, String(fd.get("id")));
    await logActivity(userId, `Applied suggestion: ${s.title}`, s.detail, false);
    if (s.kind === "weights") await recomputeMatches(userId);
    revalidatePath("/insights");
    return { ok: s.kind === "search" ? "Done. A new saved search was created (paused) – review it on the Auto mode page." : "Applied." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function dismissSuggestionAction(fd: FormData) {
  const userId = await requireUserId();
  await db.suggestion.updateMany({ where: { id: String(fd.get("id")), userId }, data: { status: "dismissed" } });
  revalidatePath("/insights");
}
