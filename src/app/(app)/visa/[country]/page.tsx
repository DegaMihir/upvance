import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { visaInfo } from "@/lib/visa-info";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export default async function VisaCountryPage({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const v = visaInfo(country);
  if (!v) notFound();
  return (
    <>
      <PageHeader
        title={`Working in ${v.name}`}
        description={`Last checked ${v.lastChecked}. Official sources only.`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/jobs?country=${v.code}&eligibility=all`}>Jobs in {v.name}</Link>
          </Button>
        }
      />
      <div className="grid gap-6 max-w-3xl">
        <p className="leading-relaxed">{v.overview}</p>
        {v.routes.map((r) => (
          <Card key={r.name}>
            <CardHeader>
              <CardTitle>{r.name}</CardTitle>
              <CardDescription>{r.summary}</CardDescription>
            </CardHeader>
            <CardContent>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
                Official page: {new URL(r.url).hostname} <ExternalLink className="size-3.5" />
              </a>
            </CardContent>
          </Card>
        ))}
        {v.sponsorList && (
          <Alert variant="info" title="Official sponsor list">
            <a className="underline" href={v.sponsorList.url} target="_blank" rel="noopener noreferrer">
              {v.sponsorList.name}
            </a>{" "}
            – import it on the <Link className="underline" href="/sponsors">Sponsor lists</Link> page.
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Tips</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 grid gap-1 text-sm">
              {v.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Alert variant="warning">This is general information, not legal advice. Visa approval is never guaranteed.</Alert>
      </div>
    </>
  );
}
