import Link from "next/link";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { PageHeader, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Employers" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const userId = await requireUserId();
  const { q } = await searchParams;
  const companies = await db.company.findMany({
    where: q ? { name: { contains: q } } : { jobs: { some: {} } },
    include: {
      _count: { select: { jobs: { where: { isActive: true } } } },
      followed: { where: { userId } },
      jobs: { select: { sponsorshipCategory: true, remoteCategory: true }, where: { isActive: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="Employers" description="Sponsorship history, remote policy, hiring locations and salary data – each with its source and confidence." />
      <form className="flex gap-2 mb-4 max-w-md">
        <Input name="q" defaultValue={q} placeholder="Search employers" />
        <Button type="submit">Search</Button>
      </form>
      <Card>
        <Table>
          <thead>
            <tr>
              <th>Employer</th>
              <th>Open jobs</th>
              <th className="hidden md:table-cell">Sponsorship in posts</th>
              <th className="hidden md:table-cell">Industry</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const confirmed = c.jobs.filter((j) => j.sponsorshipCategory === "Confirmed").length;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>{" "}
                    {c.followed.length > 0 && <Badge variant="info">following</Badge>}
                  </td>
                  <td>{c._count.jobs}</td>
                  <td className="hidden md:table-cell text-muted-foreground">{c.jobs.length ? `${confirmed}/${c.jobs.length} confirmed` : "—"}</td>
                  <td className="hidden md:table-cell text-muted-foreground">{c.industry ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
