import { z } from "zod";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { confirmSubmitted } from "@/lib/applications";

export const OPTIONS = options;

/** The user clicked “I submitted it” in the extension after submitting the employer form themselves. */
export const POST = extensionHandler(async (req, userId) => {
  const body = z.object({ applicationId: z.string(), confirmed: z.literal(true) }).parse(await req.json());
  const app = await confirmSubmitted(body.applicationId, userId, { confirmed: body.confirmed, via: "extension" });
  return json(req, { ok: true, status: app.status });
});
