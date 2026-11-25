import { db } from "@/lib/db";
import { userFromRequest, corsHeaders } from "@/lib/request-auth";
import { textToPdf } from "@/lib/resume/export";
import { slugify } from "@/lib/text";

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await userFromRequest(req);
  if (!userId) return new Response("Unauthorized", { status: 401, headers: corsHeaders(req) });
  const { id } = await params;
  const app = await db.application.findFirst({ where: { id, userId }, include: { job: { include: { company: true } }, profile: true } });
  if (!app?.coverLetter) return new Response("Not found", { status: 404, headers: corsHeaders(req) });
  const pdf = await textToPdf(`Cover letter – ${app.job.company.name}`, app.coverLetter);
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...corsHeaders(req),
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${slugify(app.profile.fullName || "cover")}-cover-letter-${slugify(app.job.company.name)}.pdf"`,
    },
  });
}
