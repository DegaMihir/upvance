"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { MAX_RESUME_BYTES, parseResume, pdfToText } from "@/lib/resume/parse";
import { recomputeMatches } from "@/lib/matching";
import { countryCode, countryName } from "@/lib/countries";
import { splitList } from "@/lib/utils";
import { canonicalSkill } from "@/lib/skills";
import { errorMessage, type ActionResult } from "./types";

async function ownProfile(userId: string, id: string) {
  const p = await db.profile.findFirst({ where: { id, userId } });
  if (!p) throw new Error("Profile not found");
  return p;
}

export async function uploadResumeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const file = fd.get("resume");
  const target = String(fd.get("profileId") ?? "");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF file." };
  if (file.size > MAX_RESUME_BYTES) return { error: "The PDF is larger than 10 MB." };
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return { error: "Only PDF resumes are supported." };
  let profileId: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await pdfToText(bytes);
    if (text.replace(/\s/g, "").length < 50) return { error: "Couldn't read text from this PDF (it may be a scanned image). Enter your details manually instead." };
    const { data, parsedBy, note } = await parseResume(text, userId);
    const dir = path.join(process.cwd(), "data", "uploads", userId);
    await mkdir(dir, { recursive: true });
    const stored = path.join(dir, `${Date.now()}.pdf`);
    await writeFile(stored, bytes);
    const fields = {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      location: data.location,
      linkedin: data.linkedin,
      website: data.website,
      headline: data.headline,
      summary: data.summary,
      skills: JSON.stringify(data.skills),
      experiences: JSON.stringify(data.experiences),
      education: JSON.stringify(data.education),
      certifications: JSON.stringify(data.certifications),
      projects: JSON.stringify(data.projects),
      currentCountry: data.currentCountry ? countryName(data.currentCountry) : "",
      resumeText: text.slice(0, 50000),
      resumeFileName: file.name.slice(0, 200),
      resumeFilePath: stored,
      parsedBy,
    };
    if (target) {
      const p = await ownProfile(userId, target);
      // Keep existing non-empty values the parser couldn't find
      const merged = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === "" || v === "[]" ? (p as Record<string, unknown>)[k] : v]));
      await db.profile.update({ where: { id: p.id }, data: merged });
      profileId = p.id;
    } else {
      const count = await db.profile.count({ where: { userId } });
      const p = await db.profile.create({ data: { userId, name: String(fd.get("name") || `Resume ${count + 1}`), isDefault: count === 0, ...fields } });
      profileId = p.id;
    }
    await recomputeMatches(userId);
    revalidatePath("/profile");
    void note;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/profile/${profileId}?parsed=1`);
}

function jsonField<T>(fd: FormData, key: string, fallback: T): T {
  try {
    return JSON.parse(String(fd.get(key) ?? "")) as T;
  } catch {
    return fallback;
  }
}

export async function saveProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    const p = await ownProfile(userId, String(fd.get("id")));
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const auths = splitList(s("workAuthorizations")).map((c) => (c.toUpperCase() === "EU" ? "EU" : countryCode(c) ?? c));
    const reloc = splitList(s("relocationCountries")).map((c) => countryCode(c) ?? c);
    const salary = Number(s("salaryExpectation").replace(/[^0-9]/g, ""));
    const years = parseFloat(s("yearsExperience"));
    await db.profile.update({
      where: { id: p.id },
      data: {
        name: s("name") || p.name,
        fullName: s("fullName"),
        email: s("email"),
        phone: s("phone"),
        location: s("location"),
        linkedin: s("linkedin"),
        website: s("website"),
        headline: s("headline"),
        summary: s("summary"),
        skills: JSON.stringify(Array.from(new Set(splitList(s("skills")).map(canonicalSkill)))),
        experiences: JSON.stringify(jsonField(fd, "experiences", [])),
        education: JSON.stringify(jsonField(fd, "education", [])),
        projects: JSON.stringify(jsonField(fd, "projects", [])),
        certifications: JSON.stringify(splitList(s("certifications"))),
        citizenship: s("citizenship"),
        currentCountry: s("currentCountry"),
        workAuthorizations: JSON.stringify(auths),
        needsSponsorship: fd.get("needsSponsorship") === "on",
        willingToRelocate: fd.get("willingToRelocate") === "on",
        relocationCountries: JSON.stringify(reloc),
        salaryExpectation: salary > 0 ? salary : null,
        salaryCurrency: s("salaryCurrency") || "USD",
        noticePeriod: s("noticePeriod"),
        yearsExperience: Number.isFinite(years) ? years : null,
      },
    });
    await recomputeMatches(userId);
    revalidatePath(`/profile/${p.id}`);
    revalidatePath("/jobs");
    return { ok: "Profile saved. Matches were recalculated." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function createProfileAction(fd: FormData) {
  const userId = await requireUserId();
  const copyFrom = String(fd.get("copyFrom") ?? "");
  const name = String(fd.get("name") ?? "").trim() || "New resume";
  const count = await db.profile.count({ where: { userId } });
  let data: Record<string, unknown> = {};
  if (copyFrom) {
    const src = await ownProfile(userId, copyFrom);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, createdAt, updatedAt, isDefault, name: _n, ...rest } = src;
    data = rest;
  } else {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    data = { userId, fullName: user.name ?? "", email: user.email };
  }
  const p = await db.profile.create({ data: { ...(data as { userId: string }), userId, name, isDefault: count === 0 } });
  redirect(`/profile/${p.id}`);
}

export async function setDefaultProfileAction(fd: FormData) {
  const userId = await requireUserId();
  const p = await ownProfile(userId, String(fd.get("id")));
  await db.profile.updateMany({ where: { userId }, data: { isDefault: false } });
  await db.profile.update({ where: { id: p.id }, data: { isDefault: true } });
  await recomputeMatches(userId);
  revalidatePath("/profile");
}

export async function deleteProfileAction(fd: FormData) {
  const userId = await requireUserId();
  const p = await ownProfile(userId, String(fd.get("id")));
  const count = await db.profile.count({ where: { userId } });
  if (count <= 1) throw new Error("You need at least one profile.");
  const used = await db.application.count({ where: { profileId: p.id } });
  if (used) throw new Error("This profile is used by applications and can't be deleted.");
  await db.profile.delete({ where: { id: p.id } });
  if (p.isDefault) {
    const next = await db.profile.findFirst({ where: { userId } });
    if (next) await db.profile.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  redirect("/profile");
}
