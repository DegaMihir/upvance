"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { countryCode } from "@/lib/countries";
import { splitList } from "@/lib/utils";
import { recomputeMatches } from "@/lib/matching";
import { setupStatus } from "@/lib/setup";
import type { ActionResult } from "./types";

const toCodes = (v: string) => [...new Set(splitList(v).map((c) => countryCode(c) ?? c.toUpperCase()))];

/** Save the job preferences from the setup page; finish setup when the profile is complete too. */
export async function saveSetupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const tier1 = toCodes(s("tier1"));
  const tier2 = toCodes(s("tier2")).filter((c) => !tier1.includes(c));
  const roles = [...new Set(splitList(s("roles").replace(/\n/g, ",")))];
  const email = s("applicationEmail");
  const minSalary = s("minSalary") ? Number(s("minSalary").replace(/[^0-9]/g, "")) || null : null;
  const unknown = [...tier1, ...tier2].filter((c) => !/^[A-Z]{2}$/.test(c));

  // Save what's valid first, so nothing you typed is lost if something else needs fixing.
  await db.userSettings.update({
    where: { userId },
    data: {
      ...(tier1.length ? { targetCountries: JSON.stringify([...tier1, ...tier2]), tier1Count: tier2.length ? tier1.length : 0 } : {}),
      ...(roles.length ? { targetTitles: JSON.stringify(roles) } : {}),
      sponsorshipRequired: fd.get("sponsorshipRequired") === "on",
      remotePayParity: fd.get("remotePayParity") === "on",
      minSalary,
      salaryCurrency: s("salaryCurrency").toUpperCase() || "USD",
      ...(email ? { applicationEmail: email } : {}),
    },
  });

  const problems: string[] = [];
  if (!tier1.length) problems.push("add at least one Tier 1 country");
  if (unknown.length) problems.push(`check these countries – they weren't recognised: ${unknown.join(", ")}`);
  if (!roles.length) problems.push("add at least one job role");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("the application email doesn't look right");
  if (problems.length) return { error: `Almost there – ${problems.join("; ")}.` };

  const st = await setupStatus(userId);
  if (!st.profileOk) {
    return { error: `Your preferences are saved. Step 1 isn't finished yet – your profile is missing: ${st.profileMissing.join(", ")}. Open Profile & resumes, fill these in and save, then come back and click Finish setup.` };
  }
  await db.userSettings.update({ where: { userId }, data: { setupCompletedAt: new Date() } });
  await recomputeMatches(userId);
  revalidatePath("/", "layout");
  redirect("/dashboard?setup=done");
}
