import { auth } from "@/auth";
import { sheetRows, toCsv, toJson, toPdf, toXlsx } from "@/lib/sheet";
import { applyView, normalizeView, type SheetView } from "@/lib/sheet-view";

/** Download the sheet's current view (same filters, sort and columns as on screen). */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const form = await req.formData();
  const format = String(form.get("format") ?? "xlsx");
  const view = normalizeView(JSON.parse(String(form.get("view") ?? "{}")) as Partial<SheetView>);
  const rows = applyView(await sheetRows(userId), view);
  const name = `upvance-applications-${new Date().toISOString().slice(0, 10)}`;
  const headers = (type: string, ext: string) => ({ "content-type": type, "content-disposition": `attachment; filename="${name}.${ext}"` });
  if (format === "csv") return new Response(toCsv(rows, view.columns), { headers: headers("text/csv; charset=utf-8", "csv") });
  if (format === "json") return new Response(toJson(rows, view.columns), { headers: headers("application/json", "json") });
  if (format === "pdf") return new Response(new Uint8Array(await toPdf(rows, view.columns)), { headers: headers("application/pdf", "pdf") });
  return new Response(new Uint8Array(await toXlsx(rows, view.columns)), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
}
