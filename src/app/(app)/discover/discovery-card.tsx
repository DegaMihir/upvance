import { Radar } from "lucide-react";
import { directoryStats } from "@/lib/discovery";
import { timeAgo } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addDirectoryCompanyAction, runDiscoveryAction } from "@/app/actions/jobs";

export async function DiscoveryCard() {
  const st = await directoryStats();
  const total = Object.values(st.counts).reduce((a, b) => a + b, 0);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4" /> Company discovery
        </CardTitle>
        <CardDescription>
          A directory of {total.toLocaleString("en-US")} employers from the official sponsor lists (UK, US H-1B, NL, Canada) plus companies you add. The background worker looks for each one&apos;s public job board – your target countries and roles first – and imports jobs from boards it finds with medium/high confidence. It&apos;s slow on purpose (rate-limited) and picks up where it left off.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="success">found {st.counts.found ?? 0}</Badge>
          <Badge variant="muted">waiting {st.counts.pending ?? 0}</Badge>
          <Badge variant="outline">no public board {st.counts["not-found"] ?? 0}</Badge>
          {st.counts.error ? <Badge variant="danger">errors {st.counts.error}</Badge> : null}
          {st.last && <span className="text-muted-foreground">Last run {timeAgo(st.last.at)}: {st.last.found} found, {st.last.jobsAdded} new jobs, jobs from {st.last.countries} countries.</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ActionForm action={runDiscoveryAction}>
            <SubmitButton variant="outline" pendingText="Discovering (about a minute)…">
              Run discovery now
            </SubmitButton>
          </ActionForm>
          <ActionForm action={addDirectoryCompanyAction} className="flex flex-col gap-2 sm:flex-row">
            <Input name="name" placeholder="Company name" required />
            <Input name="website" placeholder="Website (optional, helps)" />
            <SubmitButton variant="outline" pendingText="Looking…">
              Find board
            </SubmitButton>
          </ActionForm>
        </div>
        {st.recent.length > 0 && (
          <div className="grid gap-1 text-sm">
            <div className="text-xs text-muted-foreground">Recently found</div>
            {st.recent.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground">
                  {d.atsType} / {d.boardSlug} · {d.jobCount ?? "?"} jobs
                </span>
                <Badge variant={d.confidence === "high" ? "success" : d.confidence === "medium" ? "info" : "warning"}>{d.confidence} confidence</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
