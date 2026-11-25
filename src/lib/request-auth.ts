import { auth } from "@/auth";
import { db } from "./db";
import { sha256 } from "./crypto";

/** User id from the browser session, or from the extension's pairing token (Authorization: Bearer upv_…). */
export async function userFromRequest(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(upv_[\w-]+)$/);
  if (m) {
    const s = await db.userSettings.findFirst({ where: { extensionTokenHash: sha256(m[1]) }, select: { userId: true } });
    return s?.userId ?? null;
  }
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** CORS for the Chrome extension (chrome-extension:// origins only). */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!origin.startsWith("chrome-extension://")) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  };
}
