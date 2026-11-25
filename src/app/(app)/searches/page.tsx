import Link from "next/link";
import { Bot, Pause, Play, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson, formatDate } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import { autoCountToday, MAX_SAVED_SEARCHES, RUN_HOURS } from "@/lib/auto/pipeline";
import { decryptSecret } from "@/lib/crypto";
import type { SavedSearch, Profile } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Alert, PageHeader, Progress } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { deleteSearchAction, runSearchNowAction, saveSearchAction, toggleAutoModeAction } from "@/app/actions/searches";

export const metadata = { title: "Auto mode" };

function SearchForm({ s, profiles }: { s?: SavedSearch; profiles: Profile[] }) {
  const list = (v?: string) => parseJson<string[]>(v, []).join(", ");
  const types = parseJson<string[]>(s?.jobTypes, []);
  return (
    <ActionForm action={saveSearchAction} className="grid gap-4">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input name="name" defaultValue={s?.name} required />
        </Field>
        <Field label="Include keywords" hint="Any of these (comma separated)">
          <Input name="includeKeywords" defaultValue={list(s?.includeKeywords)} placeholder="machine learning, llm" />
        </Field>
        <Field label="Exclude keywords" hint="None of these in the title">
          <Input name="excludeKeywords" defaultValue={list(s?.excludeKeywords)} placeholder="intern, principal" />
        </Field>
        <Field label="Countries" hint="Empty = anywhere. Worldwide-remote jobs always qualify.">
          <Input name="locations" defaultValue={parseJson<string[]>(s?.locations, []).map(countryName).join(", ")} placeholder="United Kingdom, Germany" />
        </Field>
        <Field label="Remote preference">
          <Select name="remotePreference" defaultValue={s?.remotePreference ?? "any"}>
            <option value="any">Any</option>
            <option value="remote">Remote only</option>
            <option value="hybrid">Hybrid only</option>
            <option value="onsite">Onsite only</option>
          </Select>
        </Field>
        <Field label="Experience level">
          <Select name="experienceLevel" defaultValue={s?.experienceLevel ?? "any"}>
            <option value="any">Any</option>
            <option value="entry">Entry / junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead / principal / manager</option>
          </Select>
        </Field>
        <Field label="Only companies (optional)">
          <Input name="companyInclude" defaultValue={list(s?.companyInclude)} />
        </Field>
        <Field label="Exclude companies">
          <Input name="companyExclude" defaultValue={list(s?.companyExclude)} />
        </Field>
        <Field label="Minimum match">
          <Select name="minBand" defaultValue={s?.minBand ?? "Good"}>
            <option value="Excellent">Excellent (85+)</option>
            <option value="Strong">Strong (75+)</option>
            <option value="Good">Good (65+)</option>
            <option value="Stretch">Stretch (50+)</option>
          </Select>
        </Field>
        <Field label="Resume profile">
          <Select name="profileId" defaultValue={s?.profileId ?? profiles.find((p) => p.isDefault)?.id}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Runs per day (your time zone)">
          <Select name="runsPerDay" defaultValue={String(s?.runsPerDay ?? 1)}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}× – at {RUN_HOURS[n].map((h) => `${h}:00`).join(", ")}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Job types</span>
          <div className="flex flex-wrap gap-3">
            {["full-time", "part-time", "contract", "internship"].map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="jobTypes" value={t} defaultChecked={types.includes(t)} className="size-4" /> {t}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox name="sponsorshipNeeded" defaultChecked={s?.sponsorshipNeeded ?? false} label="Sponsorship required" hint="Only Confirmed / Likely sponsorship" />
        <Checkbox name="reviewRequired" defaultChecked={s?.reviewRequired ?? true} label="Review each application" hint="ON by default" />
        <Checkbox name="enabled" defaultChecked={s?.enabled ?? true} label="Enabled" />
      </div>
      <SubmitButton variant={s ? "outline" : "brand"} className="justify-self-start">
        {s ? "Save changes" : "Create saved search"}
      </SubmitButton>
    </ActionForm>
  );
}

export default async function SearchesPage() {
  const userId = await requireUserId();
  const [user, searches, profiles, activity] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } }),
    db.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 3 }, profile: true, _count: { select: { applications: true } } } }),
    db.profile.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.activityLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const s = user.settings!;
  const used = await autoCountToday(userId, user.timezone);
  const workdaySkipped = !decryptSecret(s.encryptedAppPassword);

  return (
    <>
      <PageHeader
        title="Auto mode"
        description="Opt-in. Saved searches run on schedule, prepare documents and queue applications for your review. Nothing is submitted for you – jobs go to “Ready for assisted apply”."
        actions={
          <form action={toggleAutoModeAction}>
            <input type="hidden" name="on" value={s.autoModeEnabled ? "0" : "1"} />
            <Button type="submit" variant={s.autoModeEnabled ? "outline" : "brand"}>
              {s.autoModeEnabled ? (
                <>
                  <Pause /> Turn auto mode off
                </>
              ) : (
                <>
                  <Play /> Turn auto mode on
                </>
              )}
            </Button>
          </form>
        }
      />
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">
            <Bot className="size-4" /> {s.autoModeEnabled ? <Badge variant="success">ON</Badge> : <Badge variant="muted">OFF</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Time zone: {user.timezone}. Only jobs posted in the last 48 hours.</p>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Today&apos;s cap (shared by all searches)</div>
          <div className="mt-1 font-semibold">
            {used} / {s.dailyCap}
          </div>
          <Progress value={(used / s.dailyCap) * 100} className="mt-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Change in <Link className="underline" href="/settings#auto">Settings</Link>. Failed submissions don&apos;t count.
          </p>
        </Card>
        <Card className="p-4 text-sm">
          <div className="text-xs text-muted-foreground">Rules</div>
          <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground list-disc pl-4">
            <li>Interview recorded → company paused {s.interviewPauseDays} days</li>
            <li>{workdaySkipped ? "Workday jobs skipped (no application password)" : "Workday jobs allowed"}</li>
            <li>Worker must be running (started by npm run dev)</li>
          </ul>
        </Card>
      </div>

      {!s.autoModeEnabled && <Alert variant="info" className="mb-6">Auto mode is off. Saved searches won&apos;t run on schedule, but you can still use “Run now”.</Alert>}

      <div className="grid gap-6">
        {searches.map((search) => (
          <Card key={search.id}>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {search.name} {search.enabled ? <Badge variant="success">enabled</Badge> : <Badge variant="muted">paused</Badge>}
                </CardTitle>
                <CardDescription>
                  Profile “{search.profile?.name ?? "default"}” · {search.runsPerDay}×/day · last run {formatDate(search.lastRunAt)} · {search._count.applications} application(s)
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <ActionForm action={runSearchNowAction}>
                  <input type="hidden" name="id" value={search.id} />
                  <SubmitButton size="sm" variant="outline" pendingText="Running…">
                    <Play /> Run now
                  </SubmitButton>
                </ActionForm>
                <form action={deleteSearchAction}>
                  <input type="hidden" name="id" value={search.id} />
                  <Button size="sm" variant="ghost" type="submit" aria-label="Delete search">
                    <Trash2 />
                  </Button>
                </form>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {search.runs.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-primary">Recent runs</summary>
                  <div className="mt-2 grid gap-2">
                    {search.runs.map((r) => (
                      <div key={r.id} className="rounded border p-2 text-xs">
                        <div className="font-medium">
                          {r.startedAt.toLocaleString("en-GB")} · {r.trigger} · discovered {r.discovered}, filtered {r.filtered}, eligible {r.scored}, prepared {r.queued}
                          {r.stoppedReason && <span className="text-amber-600"> · {r.stoppedReason}</span>}
                        </div>
                        <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                          {parseJson<string[]>(r.log, []).slice(0, 12).map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-primary">Edit search</summary>
                <div className="mt-3">
                  <SearchForm s={search} profiles={profiles} />
                </div>
              </details>
            </CardContent>
          </Card>
        ))}

        {searches.length < MAX_SAVED_SEARCHES ? (
          <Card>
            <CardHeader>
              <CardTitle>New saved search</CardTitle>
              <CardDescription>
                {searches.length} of {MAX_SAVED_SEARCHES} used.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SearchForm profiles={profiles} />
            </CardContent>
          </Card>
        ) : (
          <Alert variant="info">You have the maximum of {MAX_SAVED_SEARCHES} saved searches.</Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
            <CardDescription>Every automatic action is logged here.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {activity.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
              {activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="text-xs text-muted-foreground w-36 shrink-0">{a.createdAt.toLocaleString("en-GB")}</span>
                  <span>
                    {a.automatic && <Badge variant="info" className="mr-1">auto</Badge>}
                    {a.action}
                    {a.details && <span className="text-muted-foreground"> – {a.details}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
