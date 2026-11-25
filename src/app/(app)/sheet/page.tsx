import { requireUserId } from "@/lib/session";
import { sheetRows } from "@/lib/sheet";
import { PageHeader } from "@/components/ui/misc";
import { SheetTable } from "@/components/sheet/sheet-table";

export const metadata = { title: "Applications sheet" };

export default async function SheetPage() {
  const userId = await requireUserId();
  const rows = await sheetRows(userId);
  const countries = Array.from(new Set(rows.map((r) => r.country).filter(Boolean))).sort();
  return (
    <>
      <PageHeader
        title="Applications sheet"
        description="Every application – automatic, assisted and ones you add yourself. Status and responses update from your inbox; click a Status, Latest response, Response date, recruiter contact or Notes cell to edit it. Recruiter contacts come from recruiters you saved and people who emailed you – LinkedIn is never scraped. “No response” is never treated as a rejection."
      />
      <SheetTable rows={rows} countries={countries} />
    </>
  );
}
