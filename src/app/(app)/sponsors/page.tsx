import { ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { SPONSOR_LISTS, type SponsorListId } from "@/lib/sponsors/lookup";
import { formatDate } from "@/lib/utils";
import { normalizeCompany } from "@/lib/text";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import { Alert, PageHeader, Table } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { importSponsorFileAction, refreshSponsorListAction } from "@/app/actions/settings";

export const metadata = { title: "Sponsor lists" };

export default async function SponsorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUserId();
  const { q } = await searchParams;
  const lists = await db.sponsorList.findMany();
  const byId = new Map(lists.map((l) => [l.id, l]));
  const results = q && q.trim().length >= 2 ? await db.sponsorRecord.findMany({ where: { normalizedName: { contains: normalizeCompany(q) } }, take: 50 }) : [];
  return (
    <>
      <PageHeader title="Official sponsor lists" description="Public government lists of employers licensed to sponsor visas. Used to upgrade “Unknown” sponsorship to “Likely” – never to guarantee sponsorship." />
      <Alert variant="info" className="mb-6">
        The background worker refreshes each list weekly. If an automatic download fails (government sites change), download the file from the official link and import it here.
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(SPONSOR_LISTS) as SponsorListId[]).map((id) => {
          const meta = SPONSOR_LISTS[id];
          const l = byId.get(id);
          return (
            <Card key={id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {meta.name}
                  <Badge variant={l?.status === "ok" ? "success" : l?.status === "error" ? "danger" : l?.status === "demo" ? "warning" : "muted"}>{l?.status === "demo" ? "sample only" : (l?.status ?? "not imported")}</Badge>
                </CardTitle>
                <CardDescription>
                  {l?.recordCount?.toLocaleString("en-US") ?? 0} employers · last updated {formatDate(l?.lastUpdated)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {l?.message && <p className={l.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>{l.message}</p>}
                <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Official source <ExternalLink className="size-3.5" />
                </a>
                <ActionForm action={refreshSponsorListAction}>
                  <input type="hidden" name="listId" value={id} />
                  <SubmitButton size="sm" variant="outline" pendingText="Downloading (can take a minute)…">
                    Download latest now
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={importSponsorFileAction} className="flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="listId" value={id} />
                  <Input type="file" name="file" accept=".csv,.txt,.html,.htm" />
                  <SubmitButton size="sm" variant="ghost">
                    Import file
                  </SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Search the lists</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2 mb-4">
            <Input name="q" defaultValue={q} placeholder="Company name" />
            <Button type="submit">Search</Button>
          </form>
          {q && (
            <Table>
              <thead>
                <tr>
                  <th>Employer</th>
                  <th>List</th>
                  <th>City</th>
                  <th>Route</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.listId}</td>
                    <td>{r.city}</td>
                    <td className="text-muted-foreground">{r.route}</td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted-foreground">
                      No matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
