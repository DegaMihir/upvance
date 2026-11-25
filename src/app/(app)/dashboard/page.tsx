import Link from "next/link";
import { AlertCircle, ArrowRight, Briefcase, CheckCircle2, ClipboardCheck, Globe2, MessageSquare, Plane, Search, ShieldCheck, ShieldQuestion, Sparkles, Trophy, XCircle, Bot } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { applicationsOverTime, dashboardStats, rate } from "@/lib/stats";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { BandBadge, SponsorshipBadge, RemoteBadge } from "@/components/domain/badges";
import { ApplicationsChart } from "@/components/charts";
import { aiStatus } from "@/lib/ai";
import { missingProfileFields } from "@/lib/resume/document";
import { getDefaultProfile } from "@/lib/matching";
import { parseJson, timeAgo } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function Tile({ label, value, icon: Icon, href, tone }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; href?: string; tone?: string }) {
  const body = (
    <Card className="p-4 h-full transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${tone ?? "text-muted-foreground"}`} />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const userId = await requireUserId();
  const [s, weekly, top, needsYou, profile, ai, settings] = await Promise.all([
    dashboardStats(userId),
    applicationsOverTime(userId, 10),
    db.match.findMany({
      where: { userId, eligibility: { not: "Ineligible" }, status: { not: "skipped" }, job: { isActive: true, applications: { none: { userId } } } },
      orderBy: { score: "desc" },
      take: 5,
      include: { job: { include: { company: true } } },
    }),
    db.application.findMany({ where: { userId, status: "Needs you" }, include: { job: { include: { company: true } } }, take: 5, orderBy: { updatedAt: "desc" } }),
    getDefaultProfile(userId),
    aiStatus(userId),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const missing = profile ? missingProfileFields(profile) : ["Profile"];
  const heartbeat = await db.systemState.findUnique({ where: { key: "worker-heartbeat" } });
  const workerDown = !heartbeat || Date.now() - new Date(heartbeat.value).getTime() > 3 * 60_000;
  const noAi = ai.every((r) => !r.chain.some((c) => c.hasKey));
  const submittedTotal = s.submitted;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your job search at a glance. Scores show how well a job suits you – not the chance of an interview."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/discover">
                <Search /> Find jobs
              </Link>
            </Button>
            <Button asChild variant="brand">
              <Link href="/jobs">
                <Sparkles /> Open match feed
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 mb-6">
        {missing.length > 0 && (
          <Alert variant="warning" title="Finish your profile">
            Missing: {missing.join(", ")}. <Link className="underline" href={profile ? `/profile/${profile.id}` : "/profile"}>Complete it</Link> so matching and applications work properly.
          </Alert>
        )}
        {noAi && (
          <Alert variant="info" title="Running without AI">
            No AI keys found, so Upvance uses rule-based matching and templates. Add <code>GEMINI_API_KEY</code> (free) to <code>.env</code> to enable AI.
          </Alert>
        )}
        {workerDown && (
          <Alert variant={settings?.autoModeEnabled ? "warning" : "info"} title="Background worker isn't running">
            Scheduled searches, board refreshes and the AI queue need it. It starts automatically with <code>npm run dev</code> (or run <code>npm run worker</code> in a second window).
          </Alert>
        )}
        {settings?.autoModeEnabled && (
          <Alert variant="info" title="Auto mode is ON">
            Saved searches run on schedule and prepare applications for your review. <Link className="underline" href="/searches">Manage auto mode</Link>
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
        <Tile label="Jobs discovered" value={s.jobsDiscovered} icon={Briefcase} href="/jobs?eligibility=all" />
        <Tile label="Relevant matches" value={s.relevantMatches} icon={Sparkles} href="/jobs" tone="text-primary" />
        <Tile label="Sponsorship confirmed" value={s.confirmedSponsorship} icon={ShieldCheck} href="/jobs?sponsorship=Confirmed" tone="text-emerald-600" />
        <Tile label="Sponsorship unknown" value={s.unknownSponsorship} icon={ShieldQuestion} href="/jobs?sponsorship=Unknown" />
        <Tile label="Remote-eligible" value={s.remoteEligible} icon={Globe2} href="/jobs?remote=remote" />
        <Tile label="Relocation needed" value={s.relocationRequired} icon={Plane} />
        <Tile label="Needs you" value={s.needsYou} icon={AlertCircle} href="/applications?tab=needs-you" tone="text-amber-600" />
        <Tile label="Ready to apply" value={s.ready} icon={ClipboardCheck} href="/applications?tab=ready" />
        <Tile label="Submitted" value={s.submitted} icon={CheckCircle2} href="/applications?tab=submitted" />
        <Tile label="Recruiter responses" value={s.recruiterResponses} icon={MessageSquare} tone="text-blue-600" />
        <Tile label="Interviews · Offers" value={`${s.interviews} · ${s.offers}`} icon={Trophy} tone="text-emerald-600" />
        <Tile label="Rejected · Errors" value={`${s.rejected} · ${s.errors}`} icon={XCircle} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Applications over time</CardTitle>
            <CardDescription>
              Response rate: {rate(s.recruiterResponses, submittedTotal)}% of {submittedTotal} submitted. “No response” is not counted as a rejection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplicationsChart data={weekly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs you</CardTitle>
            <CardDescription>Applications paused until you decide.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {needsYou.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting. 🎉</p>}
            {needsYou.map((a) => (
              <Link key={a.id} href={`/applications/${a.id}`} className="rounded-lg border p-3 hover:bg-muted/40">
                <div className="text-sm font-medium">{a.job.title}</div>
                <div className="text-xs text-muted-foreground">{a.job.company.name}</div>
                <ul className="mt-1 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4">
                  {parseJson<{ label: string }[]>(a.needsYou, []).slice(0, 3).map((n) => (
                    <li key={n.label}>{n.label}</li>
                  ))}
                </ul>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Top matches you haven&apos;t applied to</CardTitle>
              <CardDescription>Nothing is applied to just because it appears here.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/jobs">
                All matches <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {top.length === 0 && <p className="text-sm text-muted-foreground">No matches yet. Add companies or import jobs on the Discover page.</p>}
            {top.map((m) => (
              <Link key={m.id} href={`/jobs/${m.jobId}`} className="flex flex-col gap-2 rounded-lg border p-3 hover:bg-muted/40 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.job.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.job.company.name} · {m.job.location || "Location not stated"} · {timeAgo(m.job.postedAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <SponsorshipBadge category={m.job.sponsorshipCategory} />
                  <RemoteBadge category={m.job.remoteCategory} countries={parseJson(m.job.remoteCountries, [])} />
                  <BandBadge band={m.band} score={m.score} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardContent className="pt-5 flex items-center gap-3 text-sm text-muted-foreground">
            <Bot className="size-4" />
            AI usage today:{" "}
            {ai.flatMap((r) => r.chain.map((c) => `${r.role} → ${c.provider}${c.hasKey ? ` ${c.used}/${c.limit}` : " (no key)"}`)).join(" · ") || "AI off"}
            <Link href="/settings#ai" className="ml-auto underline">
              Details
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
