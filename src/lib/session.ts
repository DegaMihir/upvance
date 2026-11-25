import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "./db";

/** Current user id or redirect to /login. Use in server components & actions. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const exists = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) redirect("/login");
  return id;
}

export async function getUser() {
  const id = await requireUserId();
  return db.user.findUniqueOrThrow({ where: { id }, include: { settings: true } });
}
