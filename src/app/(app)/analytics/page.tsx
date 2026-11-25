import { Download } from "lucide-react";
import { requireUserId } from "@/lib/session";
import { applicationsOverTime } from "@/lib/stats";
import { aiUsageTrend, distributions, funnel, responseRateTrend, scoreVsResponse, timeToResponse } from "@/lib/analytics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Progress } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ApplicationsChart, DonutChart, HBarChart, RateLineChart } from "@/components/charts";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const userId = await requireUserId();
  const [f, weekly, trend, ttr, svr, dist, ai] = await Promise.all([
    funnel(userId),
    applicationsOverTime(userId, 12),
    responseRateTrend(userId, 12),
    timeToResponse(userId),
    scoreVsResponse(userId),
    distributions(userId),
    aiUsageTrend(14),
  ]);
  const max = Math.max(1, ...f.map((x) => x.value));
  return (
    <>
      <PageHeader
        title="Analytics"
        description="How your search is going over time. Small numbers can be noisy – treat trends as hints, not facts."
        actions={
          <Button asChild variant="outline">
            <a href="/api/export/applications">
              <Download /> Export applications (CSV)
            </a>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>From discovered jobs to offers.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {f.map((s, i) => (
              <div key={s.label} className="grid grid-cols-[150px_1fr_60px] items-center gap-3 text-sm">
                <span>{s.label}</span>
                <Progress value={(s.value / max) * 100} tone={i < 3 ? "bg-blue-500/70" : undefined} />
                <span className="text-right tabular-nums">
                  {s.value}
                  {i > 0 && f[i - 1].value > 0 && s.value <= f[i - 1].value && <span className="text-xs text-muted-foreground"> {Math.round((s.value / f[i - 1].value) * 100)}%</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Applications per week</CardTitle>
          </CardHeader>
          <CardContent>
            <ApplicationsChart data={weekly} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Response rate over time</CardTitle>
            <CardDescription>Cumulative share of submitted applications that got a response.</CardDescription>
          </CardHeader>
          <CardContent>
            <RateLineChart data={trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Does the score predict responses?</CardTitle>
            <CardDescription>Response rate by suitability band (scored with today&apos;s weights). If lower bands do as well as higher ones, consider adjusting the weights – Insights suggests changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarChart data={svr.map((r) => ({ label: `${r.label} (${r.applied})`, value: r.rate }))} unit="%" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Time to response</CardTitle>
            <CardDescription>{ttr.median !== null ? `Median ${ttr.median} day(s) across ${ttr.count} replies.` : "No replies recorded yet."}</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarChart data={ttr.buckets} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sponsorship among your matches</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart data={dist.sponsorship} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Work mode among your matches</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart data={dist.remote} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Where jobs come from</CardTitle>
          </CardHeader>
          <CardContent>
            <HBarChart data={dist.source} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>AI requests (last 14 days)</CardTitle>
            <CardDescription>Across all providers. Failures include rate limits that triggered the fallback.</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarChart data={ai.filter((d) => d.requests || d.failures).map((d) => ({ label: d.label, value: d.requests }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
