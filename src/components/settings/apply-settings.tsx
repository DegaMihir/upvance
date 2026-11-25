import type { UserSettings } from "@prisma/client";
import { parseJson } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveApplySettingsAction } from "@/app/actions/settings";

const SENSITIVE: { key: string; label: string; hint: string }[] = [
  { key: "gender", label: "Gender", hint: "e.g. Male, Female, Non-binary" },
  { key: "race", label: "Race / ethnicity", hint: "Leave empty = “prefer not to say”" },
  { key: "hispanic", label: "Hispanic or Latino?", hint: "Yes / No" },
  { key: "veteran", label: "Veteran status", hint: "e.g. I am not a protected veteran" },
  { key: "disability", label: "Disability status", hint: "e.g. No, I don't have a disability" },
  { key: "pronouns", label: "Pronouns", hint: "optional" },
  { key: "orientation", label: "Sexual orientation", hint: "optional" },
  { key: "salary", label: "Salary answer on forms", hint: "e.g. 95,000 USD (negotiable)" },
];

export function ApplySettings({ s }: { s: UserSettings }) {
  const sens = parseJson<Record<string, string>>(s.sensitiveDefaults, {});
  return (
    <>
      <Card id="apply">
        <CardHeader>
          <CardTitle>Automatic applying & inbox</CardTitle>
          <CardDescription>Used by “Apply to all”, “Keep applying to new matches” and the apply engine.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveApplySettingsAction} className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Application email" hint="Used on application forms and to spot employer emails. Tip: a plus-address like yourname+upvance@gmail.com.">
                <Input name="applicationEmail" type="email" defaultValue={s.applicationEmail} placeholder="yourname+upvance@gmail.com" />
              </Field>
              <Field label="Applications per day (1–150)" hint="Jobs over the cap wait for the next day automatically. Failed ones don't count.">
                <Input name="applyDailyCap" type="number" min={1} max={150} defaultValue={s.applyDailyCap} />
              </Field>
              <Field label="Default submit policy">
                <Select name="defaultSubmitPolicy" defaultValue={s.defaultSubmitPolicy}>
                  <option value="review">Review before submit (recommended)</option>
                  <option value="auto">Auto submit (no final check)</option>
                </Select>
              </Field>
              <Field label="Pause between actions (ms)" hint="Human-paced typing and clicking.">
                <Input name="humanDelayMs" type="number" min={200} max={5000} defaultValue={s.humanDelayMs} />
              </Field>
              <Checkbox name="engineHeadless" defaultChecked={s.engineHeadless} label="Headless mode (hide the browser window)" hint="Off = watch mode: you see every step. CAPTCHAs can only be solved in watch mode." />
              <Checkbox name="discoveryEnabled" defaultChecked={s.discoveryEnabled} label="Background company discovery" hint="Finds public job boards for employers in the directory, a few at a time." />
            </div>
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Sensitive & voluntary questions</legend>
              <p className="text-xs text-muted-foreground">Used only when a form asks. Empty = choose “Prefer not to say / Decline” if offered, otherwise the form waits for you.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {SENSITIVE.map((x) => (
                  <Field key={x.key} label={x.label} hint={x.hint}>
                    <Input name={`sens_${x.key}`} defaultValue={sens[x.key] ?? ""} />
                  </Field>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Checkbox name="notifyDesktop" defaultChecked={s.notifyDesktop} label="Desktop notifications" hint="Interviews, offers, recruiter replies, “Needs you” and forms waiting for review." />
              <div className="grid gap-2">
                <Checkbox name="digestEnabled" defaultChecked={s.digestEnabled} label="Daily digest email" hint="A summary of applications and updates, sent from your connected mailbox once a day." />
                <Input name="digestEmailTo" type="email" defaultValue={s.digestEmailTo} placeholder="Send digest to (default: your mailbox)" />
              </div>
            </div>
            <SubmitButton variant="brand" className="justify-self-start">
              Save
            </SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
