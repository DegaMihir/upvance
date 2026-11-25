import { z } from "zod";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { createApplication, prepareApplication, DuplicateError } from "@/lib/applications";

export const OPTIONS = options;

export const POST = extensionHandler(async (req, userId) => {
  const { jobId } = z.object({ jobId: z.string().min(1) }).parse(await req.json());
  try {
    const app = await createApplication(userId, jobId, { origin: "extension" });
    const r = await prepareApplication(app.id, userId, { useAI: true });
    return json(req, { applicationId: app.id, status: r.status, needsYou: r.failing.map((f) => f.label) });
  } catch (e) {
    if (e instanceof DuplicateError) return json(req, { error: e.message, duplicate: e.details }, 409);
    throw e;
  }
});
