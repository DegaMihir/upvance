import { db } from "@/lib/db";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { brand } from "@/config/brand";

export const OPTIONS = options;

export const GET = extensionHandler(async (req, userId) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  const ready = await db.application.findMany({
    where: { userId, status: "Ready" },
    include: { job: { include: { company: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return json(req, {
    ok: true,
    app: brand.name,
    email: user.email,
    prepareOnOpen: user.settings?.extensionPrepareOnOpen ?? false,
    ready: ready.map((a) => ({ id: a.id, title: a.job.title, company: a.job.company.name, applyUrl: a.job.applyUrl })),
  });
});
