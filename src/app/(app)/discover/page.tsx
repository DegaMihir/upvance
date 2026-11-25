import Link from "next/link";
import { Building2, ClipboardPaste, Globe, Link2, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { adzunaConfigured, googleJobsConfigured } from "@/lib/sources";
import { DiscoveryCard } from "./discovery-card";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addCompanyAction, pasteTextAction, pasteUrlAction, refreshCompanyAction, searchSourceAction, checkJobSitesAction } from "@/app/actions/jobs";

export const metadata = { title: "Discover jobs" };

export default async function DiscoverPage() {
  const userId = await requireUserId();
  const followed = await db.followedCompany.findMany({ where: { userId }, include: { company: { include: { _count: { select: { jobs: { where: { isActive: true } } } } } } }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader
        title="Discover jobs"
        description="Upvance only uses official public job-board APIs, job pages you paste, and pages you send from the browser extension. It never scrapes LinkedIn or sites that forbid it."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> Paste a job URL
            </CardTitle>
            <CardDescription>Analysed in one request. Greenhouse, Lever and Ashby links use their official APIs. LinkedIn/Indeed links aren&apos;t fetched – use the extension.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={pasteUrlAction} className="flex flex-col gap-2 sm:flex-row">
              <Input name="url" type="url" required placeholder="https://jobs.lever.co/company/1234…" />
              <SubmitButton pendingText="Analysing…">Analyse</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" /> Add a company
            </CardTitle>
            <CardDescription>
              Enter the board name from the company&apos;s careers URL (e.g. <code>boards.greenhouse.io/<b>acme</b></code>), the full careers URL (Gem, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor, BambooHR, Breezy, JazzHR, Workday…), or just the company name – we try the common boards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={addCompanyAction} className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                <Input name="company" required placeholder="Board name or careers URL" />
                <Select name="ats" defaultValue="">
                  <option value="">Auto-detect</option>
                  <option value="greenhouse">Greenhouse</option>
                  <option value="lever">Lever</option>
                  <option value="ashby">Ashby</option>
                  <option value="gem">Gem</option>
                  <option value="workable">Workable</option>
                  <option value="smartrecruiters">SmartRecruiters</option>
                  <option value="recruitee">Recruitee</option>
                  <option value="personio">Personio</option>
                  <option value="teamtailor">Teamtailor</option>
                  <option value="bamboohr">BambooHR</option>
                  <option value="breezy">Breezy HR</option>
                  <option value="jazzhr">JazzHR</option>
                  <option value="workday">Workday (paste the URL)</option>
                </Select>
              </div>
              <Input name="displayName" placeholder="Company display name (optional)" />
              <SubmitButton pendingText="Loading open jobs…">Add & pull open jobs</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-4" /> Search job APIs
            </CardTitle>
            <CardDescription>Remotive, Remote OK, We Work Remotely, Y Combinator jobs and Arbeitnow are free and public. Adzuna needs a free key in .env. Jobs from We Work Remotely and YC are matched to the employer&apos;s own job page so they can be applied to.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={searchSourceAction} className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Source">
                  <Select name="source" defaultValue="remotive">
                    <option value="remotive">Remotive (remote jobs)</option>
                    <option value="remoteok">Remote OK (remote jobs)</option>
                    <option value="weworkremotely">We Work Remotely (remote jobs)</option>
                    <option value="ycombinator">Y Combinator jobs (startups, shows visa sponsorship)</option>
                    <option value="arbeitnow">Arbeitnow (Europe, many with visa info)</option>
                    <option value="adzuna" disabled={!adzunaConfigured()}>
                      Adzuna – several countries {adzunaConfigured() ? "" : "(add key to .env)"}
                    </option>
                    <option value="googlejobs" disabled={!googleJobsConfigured()}>
                      Google Jobs via SerpApi {googleJobsConfigured() ? "" : "(add SERPAPI_KEY to .env)"}
                    </option>
                  </Select>
                </Field>
                <Field label="Countries / location" hint="Adzuna: gb, de, nl… or “all” for your target countries. Google Jobs: a place name.">
                  <Input name="country" defaultValue="gb" maxLength={2} />
                </Field>
              </div>
              <Field label="Keywords" hint="Free keyword filter – runs before any AI call.">
                <Input name="keyword" placeholder="e.g. machine learning" />
              </Field>
              <SubmitButton pendingText="Fetching…">Import matching jobs</SubmitButton>
            </ActionForm>
            <ActionForm action={checkJobSitesAction} className="mt-4 grid gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">Or check all four job sites (Remotive, Remote OK, We Work Remotely, YC) for your target roles from Settings. This also runs by itself every 6 hours while the app is running.</p>
              <SubmitButton variant="outline" pendingText="Checking job sites… (about a minute)">Check job sites now</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardPaste className="size-4" /> Paste a job description
            </CardTitle>
            <CardDescription>For sites that can&apos;t be fetched. Copy the text yourself.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={pasteTextAction} className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input name="title" required placeholder="Job title" />
                <Input name="companyName" required placeholder="Company" />
                <Input name="location" placeholder="Location (e.g. Remote – US only)" />
                <Input name="applyUrl" type="url" placeholder="Employer apply link (optional)" />
              </div>
              <Textarea name="description" required rows={6} placeholder="Paste the full job description…" />
              <SubmitButton pendingText="Analysing…">Analyse job</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <DiscoveryCard />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Followed companies</CardTitle>
          <CardDescription>Refreshed automatically by the background worker every 6 hours (when it&apos;s running).</CardDescription>
        </CardHeader>
        <CardContent>
          {followed.length === 0 ? (
            <Alert variant="info">No companies yet. Add one above.</Alert>
          ) : (
            <div className="grid gap-2">
              {followed.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                  <Link href={`/companies/${f.companyId}`} className="font-medium hover:underline">
                    {f.company.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {f.company.atsType} / {f.company.boardSlug} · {f.company._count.jobs} open · refreshed {formatDate(f.company.lastFetchedAt)}
                  </span>
                  <form action={refreshCompanyAction} className="ml-auto">
                    <input type="hidden" name="companyId" value={f.companyId} />
                    <Button size="sm" variant="outline" type="submit">
                      <RefreshCw /> Refresh
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
