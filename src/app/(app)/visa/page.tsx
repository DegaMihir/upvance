import Link from "next/link";
import { VISA_INFO } from "@/lib/visa-info";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Visa guide" };

export default function VisaPage() {
  return (
    <>
      <PageHeader title="Visa guide" description="Short overviews with links to official government sources. Rules and salary thresholds change – always check the official page." />
      <Alert variant="warning" className="mb-6" title="Not legal advice">
        Upvance never guarantees visa approval or interviews. Sponsorship labels come from job-post wording and public sponsor lists and may be wrong.
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VISA_INFO.map((v) => (
          <Link key={v.code} href={`/visa/${v.code.toLowerCase()}`}>
            <Card className="h-full hover:bg-muted/30">
              <CardHeader>
                <CardTitle>{v.name}</CardTitle>
                <CardDescription>{v.routes.length} routes · last checked {v.lastChecked}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground line-clamp-4">{v.overview}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
