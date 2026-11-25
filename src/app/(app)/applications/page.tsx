import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { formatDate, parseJson } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Table } from "@/components/ui/misc";
import { StatusBadge } from "@/components/domain/badges";
import { cn } from "@/lib/utils";

export const metadata = { title: "Applications" };

const TABS: { key: string; label: string; statuses?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you", statuses: ["Needs you"] },
  { key: "ready", label: "Ready for assisted apply", statuses: ["Ready"] },
  { key: "in-progress", label: "Preparing", statuses: ["Saved", "Preparing"] },
  { key: "submitted", label: "Submitted", statuses: ["Submitted", "No response"] },
  { key: "responses", label: "Responses", statuses: ["Recruiter response", "Assessment", "Interview", "Offer"] },
  { key: "closed", label: "Rejected", statuses: ["Rejected"] },
];

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "all" } = await searchParams;
  const userId = await requireUserId();
  const all = await db.application.findMany({
    where: { userId },
    include: { job: { include: { company: true } }, profile: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const apps = current.statuses ? all.filter((a) => current.statuses!.includes(a.status)) : all;
  return (
    <>
      <PageHeader title="Applications" description="Every application, its documents and its timeline. “No response” is never treated as a rejection." />
      <div className="flex flex-wrap gap-1 mb-4" role="tablist">
        {TABS.map((t) => {
          const n = t.statuses ? all.filter((a) => t.statuses!.includes(a.status)).length : all.length;
          return (
            <Link
              key={t.key}
              href={`/applications?tab=${t.key}`}
              role="tab"
              aria-selected={t.key === current.key}
              className={cn("rounded-full px-3 py-1.5 text-sm border", t.key === current.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent")}
            >
              {t.label} <span className="opacity-70">({n})</span>
            </Link>
          );
        })}
      </div>
      {apps.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-8" />} title="Nothing here yet">
          Pick a job in the <Link className="underline" href="/jobs">match feed</Link> and click “Prepare application”.
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Resume</th>
                <th className="hidden md:table-cell">Origin</th>
                <th className="hidden sm:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const needs = parseJson<{ label: string }[]>(a.needsYou, []);
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/applications/${a.id}`} className="font-medium hover:underline">
                        {a.job.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{a.job.company.name}</div>
                      {a.status === "Needs you" && needs.length > 0 && <div className="text-xs text-amber-700 dark:text-amber-300">{needs.map((n) => n.label).join(" · ")}</div>}
                      {a.failed && <div className="text-xs text-red-600">Failed: {a.failureReason}</div>}
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="hidden md:table-cell text-muted-foreground">{a.profile.name}</td>
                    <td className="hidden md:table-cell text-muted-foreground capitalize">{a.origin}</td>
                    <td className="hidden sm:table-cell text-muted-foreground">{formatDate(a.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
