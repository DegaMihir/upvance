import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/request-auth";

/** Screenshots taken by the apply engine (filled form / confirmation page). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await userFromRequest(req);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const aj = await db.applyJob.findFirst({ where: { id, userId } });
  const kind = new URL(req.url).searchParams.get("kind");
  const file = kind === "confirmation" ? aj?.confirmationPath : aj?.screenshotPath;
  if (!file) return new Response("Not found", { status: 404 });
  try {
    return new Response(new Uint8Array(await readFile(file)), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("Screenshot no longer available", { status: 404 });
  }
}
