import { auth } from "@/auth";
import { db } from "@/lib/db";

/** New notifications not yet shown on the desktop (interviews, offers, recruiter replies, needs-you, review). */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const fresh = await db.notification.findMany({ where: { userId, shownAt: null }, orderBy: { createdAt: "asc" }, take: 10 });
  if (fresh.length) await db.notification.updateMany({ where: { id: { in: fresh.map((n) => n.id) } }, data: { shownAt: new Date() } });
  return Response.json(fresh.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, kind: n.kind })));
}
