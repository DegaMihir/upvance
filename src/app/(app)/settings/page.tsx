import Link from "next/link";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { parseJson } from "@/lib/utils";
import { splitTiers } from "@/lib/matching/priority";
import { countryName } from "@/lib/countries";
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, type WeightKey } from "@/lib/matching/scoring";
import { PROVIDERS, PROVIDER_INFO, type ProviderName } from "@/lib/ai/providers";
import { aiStatus, getModel, today } from "@/lib/ai";
import { decryptSecret } from "@/lib/crypto";
import { queueStats } from "@/lib/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, PageHeader, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { generateExtensionTokenAction, saveAiSettingsAction, saveAppPasswordAction, saveSettingsAction, saveWeightsAction } from "@/app/actions/settings";
import { deleteAccountAction } from "@/app/actions/privacy";
import { ApplySettings } from "@/components/settings/apply-settings";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requireUserId();
  const s = await db.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
  const [status, usage, queue] = await Promise.all([aiStatus(userId), db.aiUsage.findMany({ where: { day: today() } }), queueStats()]);
  const weights = { ...DEFAULT_WEIGHTS, ...parseJson<Partial<typeof DEFAULT_WEIGHTS>>(s.scoringWeights, {}) };
  const storedKeys = parseJson<Record<string, string>>(s.encryptedProviderKeys, {});
  const types = parseJson<string[]>(s.employmentTypes, []);
  const list = (k: string) => parseJson<string[]>(k, []).join(", ");
  const totalCost = usage.reduce((n, u) => n + u.estCostUsd, 0);
  const envKey = (p: ProviderName) => !!(PROVIDER_INFO[p].keyVar && process.env[PROVIDER_INFO[p].keyVar]);

  return (
    <>
      <PageHeader title="Settings" description="Everything is stored in your local database. Secrets are encrypted." />
      <div className="grid gap-6">
        <ActionForm action={saveSettingsAction} className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Job preferences</CardTitle>
              <CardDescription>
                Profile and resumes are on the <Link href="/profile" className="underline">Profile page</Link>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Tier 1 countries – highest priority" hint="In priority order, comma separated. Jobs are shown and applied to in this order: your first country first.">
                <Input name="targetCountries" defaultValue={splitTiers(parseJson<string[]>(s.targetCountries, []), s.tier1Count).tier1.map(countryName).join(", ")} />
              </Field>
              <Field label="Tier 2 countries" hint="Also in priority order. They come after all Tier 1 countries. Leave empty for a single list.">
                <Input name="targetCountriesTier2" defaultValue={splitTiers(parseJson<string[]>(s.targetCountries, []), s.tier1Count).tier2.map(countryName).join(", ")} />
              </Field>
              <Field label="Target job titles">
                <Input name="targetTitles" defaultValue={list(s.targetTitles)} />
              </Field>
              <Field label="Key skills to look for">
                <Input name="targetSkills" defaultValue={list(s.targetSkills)} />
              </Field>
              <Field label="Experience range (years)">
                <div className="flex gap-2">
                  <Input name="minExperience" type="number" min={0} defaultValue={s.minExperience} aria-label="Minimum" />
                  <Input name="maxExperience" type="number" min={0} defaultValue={s.maxExperience} aria-label="Maximum" />
                </div>
              </Field>
              <Field label="Minimum salary (per year)">
                <div className="flex gap-2">
                  <Input name="minSalary" inputMode="numeric" defaultValue={s.minSalary ?? ""} />
                  <Input name="salaryCurrency" defaultValue={s.salaryCurrency} className="w-24" aria-label="Currency" />
                </div>
              </Field>
              <Field label="Remote preference">
                <Select name="remotePreference" defaultValue={s.remotePreference}>
                  <option value="any">No preference</option>
                  <option value="remote">Prefer remote</option>
                  <option value="hybrid">Prefer hybrid</option>
                  <option value="onsite">Prefer onsite</option>
                </Select>
              </Field>
              <Field label="Excluded companies" hint="Never shown as matches">
                <Input name="excludedCompanies" defaultValue={list(s.excludedCompanies)} />
              </Field>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Employment types</span>
                <div className="flex flex-wrap gap-3">
                  {["full-time", "part-time", "contract", "internship"].map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="employmentTypes" value={t} defaultChecked={types.includes(t)} className="size-4" /> {t}
                    </label>
                  ))}
                </div>
              </div>
              <Checkbox name="sponsorshipRequired" defaultChecked={s.sponsorshipRequired} label="I need visa sponsorship" />
              <Checkbox name="strictSponsorship" defaultChecked={s.strictSponsorship} label="Strict sponsorship filter" hint="Hide jobs where sponsorship is Unknown or Case-by-Case when you'd need a visa." />
              <Checkbox name="relocationOk" defaultChecked={s.relocationOk} label="Open to relocation" />
              <Checkbox name="remotePayParity" defaultChecked={s.remotePayParity} label="Remote jobs must pay the on-site rate" hint="Lowers the match score of remote jobs whose pay is adjusted to where you live, and of jobs paying below your minimum salary. Jobs with no pay listed aren't affected. Set your minimum salary at the rate paid in the country you'd move to." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Applications & approvals</CardTitle>
              <CardDescription>Human approval is ON by default. Nothing is ever submitted without your confirmation.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Resume optimisation">
                <Select name="resumeMode" defaultValue={s.resumeMode}>
                  <option value="off">Off – use my original resume</option>
                  <option value="honest">Honest – light, truthful tailoring</option>
                  <option value="aggressive">Aggressive – stronger keyword emphasis (still truthful)</option>
                </Select>
              </Field>
              <Field label="Minimum match for auto mode">
                <Select name="minMatchBand" defaultValue={s.minMatchBand}>
                  {["Excellent", "Strong", "Good", "Stretch"].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              </Field>
              <Checkbox name="resumeApproval" defaultChecked={s.resumeApproval} label="Require my approval of tailored resumes" />
              <Checkbox name="coverLetterApproval" defaultChecked={s.coverLetterApproval} label="Require my approval of cover letters" />
              <Checkbox name="reviewBeforeSubmit" defaultChecked={s.reviewBeforeSubmit} label="Review before submit step" hint="Extra reminder to check the employer form after autofill." />
              <div />
              <Field label="Max applications per company" hint="Duplicate rule">
                <Input name="perCompanyLimit" type="number" min={1} max={50} defaultValue={s.perCompanyLimit} />
              </Field>
              <Checkbox name="blockSameCompanyPending" defaultChecked={s.blockSameCompanyPending} label="Block a 2nd application while one at the same company is pending" />
              <Field label="Interview pause (days)" hint="Pause new applications to a company after an interview (7–180).">
                <Input name="interviewPauseDays" type="number" min={7} max={180} defaultValue={s.interviewPauseDays} />
              </Field>
              <Field label="Recruiter follow-up after (days)">
                <Input name="outreachFollowUpDays" type="number" min={2} max={60} defaultValue={s.outreachFollowUpDays} />
              </Field>
            </CardContent>
          </Card>

          <Card id="auto">
            <CardHeader>
              <CardTitle>Auto mode (opt-in)</CardTitle>
              <CardDescription>Runs your saved searches on schedule and prepares applications. Automatic actions are rate-limited and logged.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Checkbox name="autoModeEnabled" defaultChecked={s.autoModeEnabled} label="Turn auto mode on" hint="Turning it off stops future runs immediately. Submitted applications stay submitted." />
              <Field label="Daily cap (1–150)" hint="Shared across all saved searches. Failed submissions don't count.">
                <Input name="dailyCap" type="number" min={1} max={150} defaultValue={s.dailyCap} />
              </Field>
              <Checkbox name="extensionPrepareOnOpen" defaultChecked={s.extensionPrepareOnOpen} label="Extension: prepare applications for jobs I open" hint="Off by default." />
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <SubmitButton variant="brand">Save settings</SubmitButton>
          </div>
        </ActionForm>

        <Card>
          <CardHeader>
            <CardTitle>Scoring weights</CardTitle>
            <CardDescription>How much each part counts. They&apos;re normalised to 100%. Hard eligibility rules always override the score.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveWeightsAction} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-4">
                {(Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).map((k) => (
                  <Field key={k} label={`${WEIGHT_LABELS[k]} (default ${DEFAULT_WEIGHTS[k]})`}>
                    <Input name={k} type="number" min={0} max={100} defaultValue={weights[k]} />
                  </Field>
                ))}
              </div>
              <div className="flex gap-2">
                <SubmitButton variant="outline">Save weights</SubmitButton>
                <SubmitButton variant="ghost" name="reset" value="1">
                  Reset to defaults
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>

        <ApplySettings s={s} />

        <Card id="ai">
          <CardHeader>
            <CardTitle>AI providers & usage</CardTitle>
            <CardDescription>Two roles: analysis (job analysis, eligibility, scoring, resume parsing) and writing (resumes, cover letters, answers, messages).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Alert variant="warning" title="Free tiers and your data">
              Free AI tiers (Gemini, Groq, OpenRouter free models) may use what you send to train their models. Don&apos;t include anything you wouldn&apos;t want shared. Choose “none” to keep everything on your computer.
            </Alert>
            <Table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Provider chain</th>
                  <th>Today</th>
                </tr>
              </thead>
              <tbody>
                {status.map((r) => (
                  <tr key={r.role}>
                    <td className="capitalize">{r.role}</td>
                    <td>
                      {r.chain.length === 0 ? (
                        <Badge variant="muted">none – rules & templates</Badge>
                      ) : (
                        r.chain.map((c, i) => (
                          <span key={c.provider} className="mr-2">
                            {i > 0 && "→ "}
                            <Badge variant={c.hasKey ? (c.cooling ? "warning" : "success") : "danger"}>
                              {c.provider}
                              {i > 0 ? " (fallback)" : ""}
                              {!c.hasKey ? " – no key" : c.cooling ? " – rate limited" : ""}
                            </Badge>
                          </span>
                        ))
                      )}
                    </td>
                    <td className="text-muted-foreground">{r.chain.map((c) => `${c.provider}: ${c.used}/${c.limit}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {usage.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Role</th>
                    <th>Requests</th>
                    <th>Failures</th>
                    <th>Tokens in/out</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.id}>
                      <td>{u.provider}</td>
                      <td>{u.role}</td>
                      <td>{u.requests}</td>
                      <td>{u.failures}</td>
                      <td>
                        {u.inputTokens.toLocaleString("en-US")} / {u.outputTokens.toLocaleString("en-US")}
                      </td>
                      <td>{PROVIDER_INFO[u.provider as ProviderName]?.free ? "free" : `$${u.estCostUsd.toFixed(4)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">
              Estimated paid cost today: ${totalCost.toFixed(4)} · Background AI queue: {queue.pending} pending, {queue.failed} failed{queue.lastError ? ` · last issue: ${queue.lastError}` : ""}. Daily limit per provider: AI_DAILY_LIMIT in .env.
            </p>
            <ActionForm action={saveAiSettingsAction} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Analysis provider" hint="Overrides ANALYSIS_PROVIDER in .env">
                  <Select name="analysisProvider" defaultValue={s.analysisProvider ?? ""}>
                    <option value="">Use .env ({process.env.ANALYSIS_PROVIDER ?? "gemini"})</option>
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_INFO[p].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Writing provider" hint="Overrides WRITING_PROVIDER in .env">
                  <Select name="writingProvider" defaultValue={s.writingProvider ?? ""}>
                    <option value="">Use .env ({process.env.WRITING_PROVIDER ?? "gemini"})</option>
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_INFO[p].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROVIDERS.filter((p) => p !== "none").map((p) => (
                  <Field key={p} label={`${PROVIDER_INFO[p].label} key`} hint={`Model: ${getModel(p)} (${PROVIDER_INFO[p].modelVar} in .env)`}>
                    <PasswordInput
                      name={`key:${p}`}
                      autoComplete="off"
                      placeholder={envKey(p) ? `Set in .env (${PROVIDER_INFO[p].keyVar})` : storedKeys[p] ? "Saved (encrypted) – enter to replace" : "Not set"}
                    />
                    {storedKeys[p] && (
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" name={`clear:${p}`} /> remove saved key
                      </label>
                    )}
                  </Field>
                ))}
              </div>
              <SubmitButton variant="outline" className="justify-self-start">
                Save AI settings
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Application password</CardTitle>
              <CardDescription>For employer portals that need an account (e.g. Workday). Stored encrypted. Auto mode skips Workday jobs until this is set.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveAppPasswordAction} className="grid gap-2">
                <PasswordInput name="appPassword" autoComplete="new-password" placeholder={decryptSecret(s.encryptedAppPassword) ? "Saved – enter to replace" : "Not set"} />
                <div className="flex gap-2">
                  <SubmitButton size="sm" variant="outline">
                    Save
                  </SubmitButton>
                  {s.encryptedAppPassword && (
                    <SubmitButton size="sm" variant="ghost" name="clear" value="1">
                      Remove
                    </SubmitButton>
                  )}
                </div>
              </ActionForm>
            </CardContent>
          </Card>
          <Card id="extension">
            <CardHeader>
              <CardTitle>Chrome extension pairing</CardTitle>
              <CardDescription>
                {s.extensionTokenHash ? `Paired token created ${s.extensionTokenCreatedAt?.toLocaleString("en-GB")}. Creating a new one revokes it.` : "Not paired yet."} The extension only talks to this app on your computer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={generateExtensionTokenAction}>
                <SubmitButton size="sm" variant="outline">
                  {s.extensionTokenHash ? "Create new pairing token" : "Create pairing token"}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </div>

        <Card id="privacy">
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>Everything lives in a database file on this computer (prisma/dev.db) plus uploaded resumes in data/uploads.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 content-start">
              <Button asChild variant="outline" className="justify-self-start">
                <a href="/api/export/my-data">Download all my data (JSON)</a>
              </Button>
              <Button asChild variant="ghost" className="justify-self-start">
                <a href="/api/export/applications">Download applications (CSV)</a>
              </Button>
            </div>
            <ActionForm action={deleteAccountAction} className="grid gap-2 rounded-lg border border-destructive/40 p-3">
              <p className="text-sm font-medium text-destructive">Delete my account and all data</p>
              <p className="text-xs text-muted-foreground">Permanently deletes profiles, applications, messages, settings and uploaded resumes. This can&apos;t be undone.</p>
              <Input name="confirm" placeholder="Type DELETE to confirm" autoComplete="off" />
              <SubmitButton size="sm" variant="destructive" className="justify-self-start">
                Delete everything
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
