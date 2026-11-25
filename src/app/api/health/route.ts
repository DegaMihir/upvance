import { brand } from "@/config/brand";

export function GET() {
  return Response.json({ ok: true, app: brand.name, time: new Date().toISOString() }, { headers: { "access-control-allow-origin": "*" } });
}
