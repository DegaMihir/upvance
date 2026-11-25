"use server";

import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { signOut } from "@/auth";
import type { ActionResult } from "./types";

/** Permanently delete the account and everything linked to it (requires typing DELETE). */
export async function deleteAccountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  if (String(fd.get("confirm") ?? "") !== "DELETE") return { error: "Type DELETE (in capitals) to confirm." };
  await db.user.delete({ where: { id: userId } });
  await rm(path.join(process.cwd(), "data", "uploads", userId), { recursive: true, force: true });
  await signOut({ redirectTo: "/register" });
}
