import { auth } from "@/auth";
import { randomToken } from "@/lib/crypto";
import { gmailAuthUrl, gmailConfigured, gmailExchange, syncMailbox } from "@/lib/inbox/mailbox";
import { setState } from "@/lib/tasks";
import { db } from "@/lib/db";

/** Gmail OAuth (read-only). GET without ?code starts sign-in; Google redirects back here with ?code. */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/inbox/gmail`;
  if (!userId) return Response.redirect(`${url.origin}/login`);
  if (!gmailConfigured()) return Response.redirect(`${url.origin}/inbox?error=${encodeURIComponent("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env to use Gmail sign-in, or use an app password instead.")}`);
  const code = url.searchParams.get("code");
  if (!code) {
    const state = randomToken(16);
    await setState(`gmail-oauth:${userId}`, state);
    return Response.redirect(gmailAuthUrl(redirectUri, state));
  }
  const expected = (await db.systemState.findUnique({ where: { key: `gmail-oauth:${userId}` } }))?.value;
  if (!expected || expected !== url.searchParams.get("state")) return Response.redirect(`${url.origin}/inbox?error=${encodeURIComponent("Sign-in expired – try again.")}`);
  try {
    const box = await gmailExchange(userId, code, redirectUri);
    await syncMailbox(box.id, { days: 30 });
    return Response.redirect(`${url.origin}/inbox?connected=1`);
  } catch (e) {
    return Response.redirect(`${url.origin}/inbox?error=${encodeURIComponent((e as Error).message)}`);
  }
}
