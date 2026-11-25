import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ask, undoChange } from "@/lib/assistant";
import { parseFilters } from "@/lib/feed";

async function uid() {
  const s = await auth();
  return s?.user?.id ?? null;
}

export async function GET() {
  const userId = await uid();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const messages = await db.assistantMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
  const changes = await db.assistantChange.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 40 });
  const undone = new Map(changes.map((c) => [c.id, c.undone]));
  return Response.json(
    messages.reverse().map((m) => ({ role: m.role, content: m.content, changes: (JSON.parse(m.actions) as { id: string; description: string }[]).map((c) => ({ ...c, undone: undone.get(c.id) ?? false })) })),
  );
}

export async function POST(req: Request) {
  const userId = await uid();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json()) as { message?: string; query?: string; undo?: string };
  if (body.undo) return Response.json(await undoChange(userId, body.undo));
  if (!body.message?.trim()) return Response.json({ error: "Type a question." }, { status: 400 });
  const current = parseFilters(Object.fromEntries(new URLSearchParams(body.query ?? "")));
  return Response.json(await ask(userId, body.message, current));
}
