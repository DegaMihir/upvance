"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";

export type FormState = { error?: string; ok?: string; field?: "name" | "email" | "password" | "confirmPassword" } | undefined;

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Your password needs at least 8 characters.").max(200, "That password is too long (200 characters at most)."),
  confirmPassword: z.string(),
});

export async function registerAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({ ...Object.fromEntries(formData), confirmPassword: String(formData.get("confirmPassword") ?? "") });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: issue.path[0] as "name" | "email" | "password" };
  }
  const { name, email, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) return { error: "The passwords don't match. Check both boxes (use the eye button to see them) and try again.", field: "confirmPassword" };
  if (await db.user.findUnique({ where: { email } })) return { error: "An account with this email already exists. Sign in instead, or use a different email.", field: "email" };
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      timezone: String(formData.get("timezone") || "UTC"),
      settings: { create: {} },
      profiles: { create: { name: "Main resume", isDefault: true, fullName: name, email } },
    },
  });
  void user;
  try {
    await signIn("credentials", { email, password, redirectTo: "/setup" });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Account created – please sign in." };
    throw e;
  }
}

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? "").toLowerCase().trim(),
      password: String(formData.get("password") ?? ""),
      redirectTo: String(formData.get("redirectTo") || "/dashboard"),
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Wrong email or password." };
    throw e;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
