import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/request-auth";

/** Download everything stored about you (secrets are excluded). */
export async function GET(req: Request) {
  const userId = await userFromRequest(req);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      settings: true,
      profiles: true,
      applications: { include: { events: true, job: { include: { company: true } } } },
      resumes: true,
      savedSearches: true,
      recruiters: true,
      outreach: true,
      activity: true,
      suggestions: true,
    },
  });
  const { passwordHash: _p, ...safeUser } = user;
  void _p;
  if (safeUser.settings) {
    safeUser.settings = { ...safeUser.settings, encryptedAppPassword: safeUser.settings.encryptedAppPassword ? "[encrypted – not exported]" : null, encryptedProviderKeys: "[not exported]", extensionTokenHash: null };
  }
  return new Response(JSON.stringify(safeUser, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="upvance-my-data-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
