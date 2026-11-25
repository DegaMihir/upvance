"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { addManualApplication, updateSheetCell } from "@/lib/sheet";
import type { ColumnKey } from "@/lib/sheet-view";
import { errorMessage, type ActionResult } from "./types";

export async function updateCellAction(applicationId: string, field: ColumnKey, value: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  try {
    await updateSheetCell(userId, applicationId, field, value);
    revalidatePath("/sheet");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function addManualAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const company = String(fd.get("company") ?? "").trim();
  const role = String(fd.get("role") ?? "").trim();
  if (!company || !role) return { error: "Company and role are required." };
  try {
    await addManualApplication(userId, {
      company,
      role,
      location: String(fd.get("location") ?? ""),
      link: String(fd.get("link") ?? ""),
      date: String(fd.get("date") ?? ""),
      status: String(fd.get("status") ?? "Submitted"),
      notes: String(fd.get("notes") ?? ""),
    });
    revalidatePath("/sheet");
    return { ok: `Added ${role} at ${company}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
