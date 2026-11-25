import { db } from "@/lib/db";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const sp = await searchParams;
  const demo = !!(await db.user.findUnique({ where: { email: "demo@upvance.local" }, select: { id: true } }));
  const redirectTo = sp.callbackUrl?.startsWith("/") ? sp.callbackUrl : "/dashboard";
  return <LoginForm redirectTo={redirectTo} demo={demo} />;
}
