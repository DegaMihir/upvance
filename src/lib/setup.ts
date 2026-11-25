/**
 * First-time setup: before using the dashboard and applying, you must have
 * 1. a profile with the required details (ideally from your uploaded resume), and
 * 2. confirmed your job preferences (countries, roles, visa sponsorship, salary, application email),
 * so every job is filtered and scored for you from the start.
 */
import { db } from "./db";
import { parseJson } from "./utils";
import { missingProfileFields } from "./resume/document";

export interface SetupStatus {
  profileId: string | null;
  hasResume: boolean;
  profileMissing: string[];
  profileOk: boolean;
  prefsMissing: string[];
  prefsOk: boolean;
  confirmed: boolean;
  complete: boolean;
}

export async function setupStatus(userId: string): Promise<SetupStatus> {
  const [profile, settings] = await Promise.all([
    db.profile.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const profileMissing = profile ? missingProfileFields(profile) : ["Resume"];
  const hasResume = !!profile && (profile.resumeText.trim().length > 0 || !!profile.resumeFileName);
  if (profile && !hasResume && profileMissing.length) profileMissing.unshift("Resume");
  const prefsMissing: string[] = [];
  if (!parseJson<string[]>(settings?.targetCountries, []).length) prefsMissing.push("Countries");
  if (!parseJson<string[]>(settings?.targetTitles, []).length) prefsMissing.push("Job roles");
  const confirmed = !!settings?.setupCompletedAt;
  const profileOk = !!profile && profileMissing.length === 0;
  const prefsOk = prefsMissing.length === 0;
  return { profileId: profile?.id ?? null, hasResume, profileMissing, profileOk, prefsMissing, prefsOk, confirmed, complete: profileOk && prefsOk && confirmed };
}

/** Pages you can open before setup is finished (everything else sends you to /setup). */
export function allowedBeforeSetup(path: string) {
  return /^\/(setup|profile)(\/|$|\?)/.test(path);
}
