import { db } from "@/lib/db";
import { parseJson, toJson } from "@/lib/utils";
import { userFromRequest, corsHeaders } from "@/lib/request-auth";
import { resumeFromProfile, type ResumeDoc } from "@/lib/resume/document";
import { resumeToDocx, resumeToPdf } from "@/lib/resume/export";
import { slugify } from "@/lib/text";

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Download the resume for an application (or a profile with ?profile=1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await userFromRequest(req);
  if (!userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders(req) });
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  let doc: ResumeDoc;
  let label: string;
  if (url.searchParams.get("profile") === "1") {
    const p = await db.profile.findFirst({ where: { id, userId } });
    if (!p) return new Response("Not found", { status: 404 });
    doc = resumeFromProfile(p);
    label = p.name;
  } else {
    const app = await db.application.findFirst({ where: { id, userId }, include: { profile: true, tailoredResume: true, job: { include: { company: true } } } });
    if (!app) return new Response("Not found", { status: 404, headers: corsHeaders(req) });
    const original = resumeFromProfile(app.profile);
    const tr = app.tailoredResume;
    const wantOriginal = url.searchParams.get("version") === "original" || tr?.status === "use-original";
    doc = !tr || wantOriginal ? parseJson<ResumeDoc>(tr?.original ?? toJson(original), original) : parseJson<ResumeDoc>(tr.tailored, original);
    label = app.job.company.name;
  }
  const base = `${slugify(doc.name || "resume")}-resume-${slugify(label)}`;
  if (format === "docx") {
    const buf = await resumeToDocx(doc);
    return new Response(new Uint8Array(buf), {
      headers: {
        ...corsHeaders(req),
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${base}.docx"`,
      },
    });
  }
  const pdf = await resumeToPdf(doc);
  return new Response(new Uint8Array(pdf), {
    headers: { ...corsHeaders(req), "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"` },
  });
}
