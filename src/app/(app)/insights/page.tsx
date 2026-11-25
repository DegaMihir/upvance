import { Lightbulb } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { computeInsights, type Group } from "@/lib/insights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader, Progress, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { applySuggestionAction, dismissSuggestionAction, refreshSuggestionsAction } from "@/app/actions/insights";

export const metadata = { title: "Insights" };

function GroupTable({ title, rows, note }: { title: string; rows: Group[]; note?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {note && <CardDescription>{note}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough data yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th></th>
                <th>Applied</th>
                <th>Responses</th>
                <th className="hidden sm:table-cell">Interviews</th>
                <th className="w-36">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.label}>
                  <td className="font-medium">
                    {g.label} {g.applied < 3 && <span className="text-xs text-muted-foreground">(few)</span>}
                  </td>
                  <td>{g.applied}</td>
                  <td>{g.responses}</td>
                  <td className="hidden sm:table-cell">{g.interviews}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Progress value={g.rate} className="h-1.5" />
                      <span className="text-xs tabular-nums w-9 text-right">{g.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default async function InsightsPage() {
  const userId = await requireUserId();
  const [ins, suggestions] = await Promise.all([computeInsights(userId), db.suggestion.findMany({ where: { userId, status: "open" }, orderBy: { createdAt: "desc" } })]);
  return (
    <>
      <PageHeader
        title="Insights"
        description="Which roles, resume profiles, skills and companies get better responses. A “response” means a recruiter reply, assessment, interview or offer. “No response” is not a rejection."
      />
      {ins.total < 5 && <Alert variant="info" className="mb-6">Insights get more reliable after about 10 submitted applications with recorded outcomes. You have {ins.total}.</Alert>}

      <Card className="mb-6">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4" /> Suggestions
            </CardTitle>
            <CardDescription>Based on your outcomes. Nothing changes until you click “Apply”. Refreshed weekly by the worker.</CardDescription>
          </div>
          <ActionForm action={refreshSuggestionsAction}>
            <SubmitButton size="sm" variant="outline">
              Refresh suggestions
            </SubmitButton>
          </ActionForm>
        </CardHeader>
        <CardContent className="grid gap-3">
          {suggestions.length === 0 && <p className="text-sm text-muted-foreground">No open suggestions.</p>}
          {suggestions.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  {s.title} <Badge variant="muted">{s.kind}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{s.detail}</p>
              </div>
              <div className="flex gap-2">
                {s.kind !== "skill" && s.kind !== "profile" && (
                  <ActionForm action={applySuggestionAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton size="sm" variant="brand">
                      Apply
                    </SubmitButton>
                  </ActionForm>
                )}
                <form action={dismissSuggestionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <Button size="sm" variant="ghost" type="submit">
                    Dismiss
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <GroupTable title="By role type" rows={ins.byRole} />
        <GroupTable title="By resume profile" rows={ins.byProfile} />
        <GroupTable title="By skill asked for" rows={ins.bySkill} note="Skills listed in the jobs you applied to." />
        <GroupTable title="By company" rows={ins.byCompany} />
        <GroupTable title="By sponsorship label" rows={ins.bySponsorship} />
        <GroupTable title="By how you applied" rows={ins.byOrigin} />
      </div>
    </>
  );
}
