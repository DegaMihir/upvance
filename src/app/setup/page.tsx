import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle, FileText, LogOut, SlidersHorizontal } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { setupStatus } from "@/lib/setup";
import { parseJson } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import { splitTiers } from "@/lib/matching/priority";
import { brand } from "@/config/brand";
import { saveSetupAction } from "@/app/actions/setup";
import { signOutAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Set up your account" };

function Step({ n, done, title }: { n: number; done: boolean; title: string }) {
  return (
    <span className="flex items-center gap-2">
      {done ? <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" /> : <Circle className="size-5 text-muted-foreground" />}
      <span>
        Step {n}: {title}
      </span>
    </span>
  );
}

export default async function SetupPage() {
  const userId = await requireUserId();
  const st = await setupStatus(userId);
  if (st.complete) redirect("/dashboard");
  const [settings, profile] = await Promise.all([
    db.userSettings.findUnique({ where: { userId } }),
    st.profileId ? db.profile.findUnique({ where: { id: st.profileId } }) : null,
  ]);
  const order = parseJson<string[]>(settings?.targetCountries, []);
  const { tier1, tier2 } = splitTiers(order, settings?.tier1Count ?? 0);
  const roles = parseJson<string[]>(settings?.targetTitles, []);

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-extrabold tracking-tight brand-text text-lg">{brand.name}</span>
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut /> Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold">Set up your account</h1>
          <p className="text-sm text-muted-foreground">Two quick steps. Everything after this – the job feed, matching and applying – uses these details, so jobs are filtered for you from the start.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" />
              <Step n={1} done={st.profileOk} title="Your resume and profile" />
            </CardTitle>
            <CardDescription>Upload your resume – the details are read from it – then check every field and fill in what&apos;s missing (citizenship, phone, work authorisation).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {st.profileOk ? (
              <Alert variant="success">Profile complete{profile?.fullName ? ` – ${profile.fullName}` : ""}.</Alert>
            ) : (
              <Alert variant="warning" title="Still needed">
                {st.profileMissing.join(", ")}
              </Alert>
            )}
            <Button asChild variant={st.profileOk ? "outline" : "brand"} className="justify-self-start">
              <Link href="/profile">{st.hasResume ? "Open my profile" : "Upload my resume"}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              <Step n={2} done={st.prefsOk && st.confirmed} title="Where and what you want to work" />
            </CardTitle>
            <CardDescription>Countries in priority order, the roles you want, and your visa needs. You can change all of this later in Settings.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveSetupAction} className="grid gap-4">
              <Field label="Tier 1 countries – highest priority" hint="In priority order, comma separated, e.g. United States, Canada, United Kingdom.">
                <Input name="tier1" required defaultValue={tier1.map(countryName).join(", ")} />
              </Field>
              <Field label="Tier 2 countries (optional)" hint="Also in order. They come after all Tier 1 countries.">
                <Input name="tier2" defaultValue={tier2.map(countryName).join(", ")} />
              </Field>
              <Field label="Job roles you want" hint="Comma separated, e.g. AI Engineer, Python Developer, Backend Developer (Node.js / Python). Only jobs with these titles are shown and applied to.">
                <textarea name="roles" required rows={3} defaultValue={roles.join(", ")} className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs" />
              </Field>
              <Checkbox name="sponsorshipRequired" defaultChecked={settings?.setupCompletedAt ? settings.sponsorshipRequired : (profile?.needsSponsorship ?? settings?.sponsorshipRequired ?? true)} label="I need visa sponsorship to work in these countries" hint="Jobs that say they don't sponsor are marked as not eligible for you." />
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label="Minimum salary (per year)" hint="At the rate paid in the country you'd move to.">
                  <Input name="minSalary" inputMode="numeric" defaultValue={settings?.minSalary ?? ""} />
                </Field>
                <Field label="Currency">
                  <Input name="salaryCurrency" defaultValue={settings?.salaryCurrency ?? "USD"} />
                </Field>
              </div>
              <Checkbox name="remotePayParity" defaultChecked={settings?.remotePayParity ?? true} label="Remote jobs must pay the on-site rate" hint="Lowers the match of remote jobs whose pay is cut to where you live." />
              <Field label="Application email" hint="Put on job forms; employers reply here. A plus-address like yourname+jobs@gmail.com is easy to filter. Leave empty to use your profile email.">
                <Input name="applicationEmail" type="email" defaultValue={settings?.applicationEmail || ""} placeholder={profile?.email || "yourname+jobs@gmail.com"} />
              </Field>
              <SubmitButton variant="brand" className="justify-self-start" pendingText="Saving…">
                Finish setup
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
