"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { countryCode } from "@/lib/countries";
import { clamp, parseJson, splitList } from "@/lib/utils";
import { recomputeMatches } from "@/lib/matching";
import { DEFAULT_WEIGHTS, type WeightKey } from "@/lib/matching/scoring";
import { PROVIDERS } from "@/lib/ai/providers";
import { refreshSponsorList, parseByList, storeSponsorRows } from "@/lib/sponsors/importers";
import { SPONSOR_LISTS, type SponsorListId } from "@/lib/sponsors/lookup";
import { analyzeJob } from "@/lib/analysis";
import { logActivity } from "@/lib/activity";
import { errorMessage, type ActionResult } from "./types";

/** Tier 1 then Tier 2, in the order typed; duplicates removed (first one wins). */
function tiers(tier1: string, tier2: string) {
  const toCodes = (v: string) => splitList(v).map((c) => countryCode(c) ?? c.toUpperCase());
  const t1 = [...new Set(toCodes(tier1))];
  const t2 = [...new Set(toCodes(tier2))].filter((c) => !t1.includes(c));
  return { targetCountries: JSON.stringify([...t1, ...t2]), tier1Count: t2.length ? t1.length : 0 };
}

export async function saveSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const n = (k: string, def: number) => (Number.isFinite(Number(s(k))) && s(k) !== "" ? Number(s(k)) : def);
  try {
    const before = await db.userSettings.findUniqueOrThrow({ where: { userId } });
    const autoOn = fd.get("autoModeEnabled") === "on";
    await db.userSettings.update({
      where: { userId },
      data: {
        ...tiers(s("targetCountries"), s("targetCountriesTier2")),
        targetTitles: JSON.stringify(splitList(s("targetTitles"))),
        targetSkills: JSON.stringify(splitList(s("targetSkills"))),
        minExperience: clamp(n("minExperience", 0), 0, 50),
        maxExperience: clamp(n("maxExperience", 30), 0, 50),
        minSalary: s("minSalary") ? Number(s("minSalary").replace(/[^0-9]/g, "")) || null : null,
        salaryCurrency: s("salaryCurrency") || "USD",
        remotePayParity: fd.get("remotePayParity") === "on",
        sponsorshipRequired: fd.get("sponsorshipRequired") === "on",
        strictSponsorship: fd.get("strictSponsorship") === "on",
        remotePreference: s("remotePreference") || "any",
        relocationOk: fd.get("relocationOk") === "on",
        employmentTypes: JSON.stringify(fd.getAll("employmentTypes").map(String)),
        excludedCompanies: JSON.stringify(splitList(s("excludedCompanies"))),
        dailyCap: clamp(Math.round(n("dailyCap", 10)), 1, 150),
        minMatchBand: s("minMatchBand") || "Good",
        resumeMode: ["off", "honest", "aggressive"].includes(s("resumeMode")) ? s("resumeMode") : "honest",
        resumeApproval: fd.get("resumeApproval") === "on",
        coverLetterApproval: fd.get("coverLetterApproval") === "on",
        reviewBeforeSubmit: fd.get("reviewBeforeSubmit") === "on",
        perCompanyLimit: clamp(Math.round(n("perCompanyLimit", 3)), 1, 50),
        blockSameCompanyPending: fd.get("blockSameCompanyPending") === "on",
        interviewPauseDays: clamp(Math.round(n("interviewPauseDays", 60)), 7, 180),
        autoModeEnabled: autoOn,
        extensionPrepareOnOpen: fd.get("extensionPrepareOnOpen") === "on",
        outreachFollowUpDays: clamp(Math.round(n("outreachFollowUpDays", 7)), 2, 60),
      },
    });
    if (before.autoModeEnabled !== autoOn) await logActivity(userId, autoOn ? "Auto mode turned ON" : "Auto mode turned OFF – future runs stopped", "", false);
    await recomputeMatches(userId);
    revalidatePath("/settings");
    return { ok: "Settings saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveWeightsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  if (fd.get("reset") === "1") {
    await db.userSettings.update({ where: { userId }, data: { scoringWeights: "{}" } });
  } else {
    const w: Record<string, number> = {};
    for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) w[k] = clamp(Number(fd.get(k)) || 0, 0, 100);
    if (Object.values(w).every((v) => v === 0)) return { error: "At least one weight must be above zero." };
    await db.userSettings.update({ where: { userId }, data: { scoringWeights: JSON.stringify(w) } });
  }
  await recomputeMatches(userId);
  revalidatePath("/settings");
  revalidatePath("/jobs");
  return { ok: "Weights saved and all scores recalculated." };
}

export async function saveAiSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const a = String(fd.get("analysisProvider") ?? "");
  const w = String(fd.get("writingProvider") ?? "");
  const valid = (p: string) => (PROVIDERS as readonly string[]).includes(p) ? p : null;
  const settings = await db.userSettings.findUniqueOrThrow({ where: { userId } });
  const keys = parseJson<Record<string, string>>(settings.encryptedProviderKeys, {});
  for (const p of PROVIDERS) {
    const v = String(fd.get(`key:${p}`) ?? "").trim();
    if (v) keys[p] = encryptSecret(v);
    if (fd.get(`clear:${p}`) === "on") delete keys[p];
  }
  await db.userSettings.update({
    where: { userId },
    data: { analysisProvider: valid(a), writingProvider: valid(w), encryptedProviderKeys: JSON.stringify(keys) },
  });
  revalidatePath("/settings");
  return { ok: "AI settings saved. Keys are encrypted in your local database (keys in .env take priority)." };
}

export async function saveAppPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const pw = String(fd.get("appPassword") ?? "");
  if (fd.get("clear") === "1") {
    await db.userSettings.update({ where: { userId }, data: { encryptedAppPassword: null } });
    revalidatePath("/settings");
    return { ok: "Application password removed. Workday jobs will be skipped in auto mode." };
  }
  if (pw.length < 8) return { error: "Use at least 8 characters. Use a password you don't use anywhere else." };
  await db.userSettings.update({ where: { userId }, data: { encryptedAppPassword: encryptSecret(pw) } });
  revalidatePath("/settings");
  return { ok: "Saved (encrypted). Use it when creating accounts on Workday-type job sites." };
}

export async function generateExtensionTokenAction(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const token = `upv_${randomToken(24)}`;
  await db.userSettings.update({ where: { userId }, data: { extensionTokenHash: sha256(token), extensionTokenCreatedAt: new Date() } });
  await logActivity(userId, "Extension pairing token created", "Previous token revoked", false);
  revalidatePath("/settings");
  return { ok: `Pairing token (shown once – paste it into the extension's options page): ${token}` };
}

export async function refreshSponsorListAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const listId = String(fd.get("listId")) as SponsorListId;
  if (!SPONSOR_LISTS[listId]) return { error: "Unknown list" };
  const r = await refreshSponsorList(listId);
  if (r.ok) await reanalyzeAll(userId);
  revalidatePath("/sponsors");
  return r.ok ? { ok: r.message } : { error: r.message };
}

export async function importSponsorFileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const listId = String(fd.get("listId")) as SponsorListId;
  const file = fd.get("file");
  if (!SPONSOR_LISTS[listId]) return { error: "Unknown list" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV (or saved HTML page) you downloaded." };
  if (file.size > 80 * 1024 * 1024) return { error: "File is too large (max 80 MB)." };
  try {
    const rows = parseByList(listId, await file.text());
    if (!rows.length) return { error: "No employer rows found. Check you picked the right file for this list." };
    const n = await storeSponsorRows(listId, rows, `Manual import: ${file.name}`);
    await reanalyzeAll(userId);
    revalidatePath("/sponsors");
    return { ok: `Imported ${n.toLocaleString("en-US")} employers from ${file.name}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Re-run rule analysis so sponsor-list evidence is updated (no AI calls). */
async function reanalyzeAll(userId: string) {
  const jobs = await db.job.findMany({ where: { isActive: true }, include: { company: true } });
  for (const j of jobs) await analyzeJob(j, { useAI: false, force: j.analysisSource !== "ai" });
  await recomputeMatches(userId);
}

export async function saveApplySettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const email = s("applicationEmail");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That application email doesn't look valid." };
  const sensitive: Record<string, string> = {};
  for (const k of ["gender", "race", "hispanic", "veteran", "disability", "pronouns", "orientation", "salary"]) if (s(`sens_${k}`)) sensitive[k] = s(`sens_${k}`);
  await db.userSettings.update({
    where: { userId },
    data: {
      applicationEmail: email,
      applyDailyCap: clamp(Math.round(Number(s("applyDailyCap")) || 25), 1, 150),
      defaultSubmitPolicy: s("defaultSubmitPolicy") === "auto" ? "auto" : "review",
      engineHeadless: fd.get("engineHeadless") === "on",
      humanDelayMs: clamp(Math.round(Number(s("humanDelayMs")) || 900), 200, 5000),
      sensitiveDefaults: JSON.stringify(sensitive),
      notifyDesktop: fd.get("notifyDesktop") === "on",
      digestEnabled: fd.get("digestEnabled") === "on",
      digestEmailTo: s("digestEmailTo"),
      discoveryEnabled: fd.get("discoveryEnabled") === "on",
    },
  });
  revalidatePath("/settings");
  return { ok: "Saved." };
}

