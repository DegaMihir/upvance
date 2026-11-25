import { userFromRequest } from "@/lib/request-auth";
import { applicationsCsv } from "@/lib/analytics";

export async function GET(req: Request) {
  const userId = await userFromRequest(req);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const csv = await applicationsCsv(userId);
  return new Response("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="upvance-applications-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
