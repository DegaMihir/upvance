"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { countryCode } from "@/lib/countries";
import { clamp, splitList } from "@/lib/utils";
import { MAX_SAVED_SEARCHES, runSavedSearch } from "@/lib/auto/pipeline";
import { logActivity } from "@/lib/activity";
import { errorMessage, type ActionResult } from "./types";

function fields(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const list = (k: string) => JSON.stringify(splitList(s(k)));
  return {
    name: s("name") || "Untitled search",
    includeKeywords: list("includeKeywords"),
    excludeKeywords: list("excludeKeywords"),
    locations: JSON.stringify(splitList(s("locations")).map((c) => countryCode(c) ?? c.toUpperCase())),
    remotePreference: s("remotePreference") || "any",
    jobTypes: JSON.stringify(fd.getAll("jobTypes").map(String)),
    companyInclude: list("companyInclude"),
    companyExclude: list("companyExclude"),
    experienceLevel: s("experienceLevel") || "any",
    sponsorshipNeeded: fd.get("sponsorshipNeeded") === "on",
    minBand: ["Excellent", "Strong", "Good", "Stretch"].includes(s("minBand")) ? s("minBand") : "Good",
    profileId: s("profileId") || null,
    runsPerDay: clamp(Number(s("runsPerDay")) || 1, 1, 4),
    reviewRequired: fd.get("reviewRequired") === "on",
    enabled: fd.get("enabled") === "on",
  };
}

export async function saveSearchAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id") ?? "");
  try {
    const data = fields(fd);
    if (data.profileId && !(await db.profile.findFirst({ where: { id: data.profileId, userId } }))) return { error: "Unknown profile." };
    if (id) {
      const existing = await db.savedSearch.findFirst({ where: { id, userId } });
      if (!existing) return { error: "Search not found." };
      await db.savedSearch.update({ where: { id }, data });
    } else {
      if ((await db.savedSearch.count({ where: { userId } })) >= MAX_SAVED_SEARCHES) return { error: `You can have up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.` };
      await db.savedSearch.create({ data: { ...data, userId } });
    }
    revalidatePath("/searches");
    return { ok: id ? "Saved search updated." : "Saved search created." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteSearchAction(fd: FormData) {
  const userId = await requireUserId();
  await db.savedSearch.deleteMany({ where: { id: String(fd.get("id")), userId } });
  revalidatePath("/searches");
}

export async function toggleAutoModeAction(fd: FormData) {
  const userId = await requireUserId();
  const on = fd.get("on") === "1";
  await db.userSettings.update({ where: { userId }, data: { autoModeEnabled: on } });
  await logActivity(userId, on ? "Auto mode turned ON" : "Auto mode turned OFF – future runs stopped", "", false);
  revalidatePath("/searches");
  revalidatePath("/dashboard");
}

export async function runSearchNowAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const id = String(fd.get("id"));
  const search = await db.savedSearch.findFirst({ where: { id, userId } });
  if (!search) return { error: "Search not found." };
  try {
    const r = await runSavedSearch(id, { trigger: "manual" });
    revalidatePath("/searches");
    revalidatePath("/applications");
    return {
      ok: `Run finished: ${r.discovered} discovered, ${r.filtered} passed filters, ${r.scored} eligible, ${r.queued} prepared.`,
      warn: r.stoppedReason ?? undefined,
    };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
