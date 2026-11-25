import { z } from "zod";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { draftOutreach, OutreachBlockedError, upsertRecruiter } from "@/lib/outreach";

export const OPTIONS = options;

/** Visible recruiter details captured by the user on a profile page → a draft message (never sent by the app). */
export const POST = extensionHandler(async (req, userId) => {
  const body = z
    .object({
      name: z.string().min(1).max(120),
      title: z.string().max(200).optional().default(""),
      company: z.string().max(200).optional().default(""),
      profileUrl: z.string().max(500).optional().default(""),
      jobId: z.string().optional(),
      role: z.string().max(200).optional(),
    })
    .parse(await req.json());
  const recruiter = await upsertRecruiter(userId, body);
  try {
    const r = await draftOutreach(userId, { recruiterId: recruiter.id, jobId: body.jobId || null, role: body.role });
    return json(req, { outreachId: r.outreachId, message: r.message, generator: r.generator, note: r.note ?? null, resume: r.resumeLabel });
  } catch (e) {
    if (e instanceof OutreachBlockedError) return json(req, { error: e.message }, 409);
    throw e;
  }
});
