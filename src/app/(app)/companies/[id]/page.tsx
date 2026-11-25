import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { companyIntel } from "@/lib/employer";
import { parseJson, timeAgo } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { RemoteBadge, SponsorshipBadge, StatusBadge } from "@/components/domain/badges";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Employer" };
}

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (!(await db.company.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const [intel, apps, pause, outreach] = await Promise.all([
    companyIntel(id),
    db.application.findMany({ where: { userId, job: { companyId: id } }, include: { job: true } }),
    db.companyPause.findFirst({ where: { userId, companyId: id, until: { gt: new Date() } } }),
    db.outreach.count({ where: { userId, job: { companyId: id } } }),
  ]);
  const { company } = intel;
  return (
    <>
      <PageHeader
        title={company.name}
        description={[company.industry, company.size && `${company.size} employees`, company.headquarters].filter(Boolean).join(" · ") || "Employer profile"}
        actions={company.website ? (
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary">
            Website <ExternalLink className="size-3.5" />
          </a>
        ) : undefined}
      />
      {pause && <Alert variant="info" className="mb-4" title="Applications paused">Paused until {pause.until.toDateString()} – {pause.reason}.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What we know</CardTitle>
            <CardDescription>Each line shows where it comes from and how confident we are. Being a licensed sponsor never guarantees a specific role is sponsored.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Claim</th>
                  <th>Source</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {intel.claims.map((c, i) => (
                  <tr key={i}>
                    <td className="font-medium whitespace-nowrap">{c.topic}</td>
                    <td>{c.value}</td>
                    <td className="text-xs text-muted-foreground">
                      {c.url ? (
                        <a href={c.url} className="underline" target="_blank" rel="noopener noreferrer">
                          {c.source}
                        </a>
                      ) : (
                        c.source
                      )}
                    </td>
                    <td>
                      <Badge variant={c.confidence === "high" ? "success" : c.confidence === "medium" ? "info" : c.confidence === "low" ? "warning" : "muted"}>{c.confidence === "unknown" ? "Unknown" : c.confidence}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your history here</CardTitle>
            <CardDescription>{outreach} recruiter message(s) linked to this employer&apos;s jobs.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {apps.length === 0 && <p className="text-muted-foreground">No applications yet.</p>}
            {apps.map((a) => (
              <Link key={a.id} href={`/applications/${a.id}`} className="flex items-center justify-between gap-2 rounded border p-2 hover:bg-muted/40">
                <span className="truncate">{a.job.title}</span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Open jobs ({intel.activeJobs.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {intel.activeJobs.slice(0, 50).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex flex-col gap-1 rounded border p-3 hover:bg-muted/40 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <div className="font-medium">{j.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {j.location || "Location not stated"} · {timeAgo(j.postedAt)}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <SponsorshipBadge category={j.sponsorshipCategory} />
                  <RemoteBadge category={j.remoteCategory} countries={parseJson(j.remoteCountries, [])} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
