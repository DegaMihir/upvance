"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveProfileAction } from "@/app/actions/profile";
import type { Education, Experience, Project } from "@/lib/matching/candidate";

type P = {
  id: string;
  name: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  headline: string;
  summary: string;
  skills: string;
  certifications: string;
  citizenship: string;
  currentCountry: string;
  workAuthorizations: string;
  needsSponsorship: boolean;
  willingToRelocate: boolean;
  relocationCountries: string;
  salaryExpectation: string;
  salaryCurrency: string;
  noticePeriod: string;
  yearsExperience: string;
  experiences: Experience[];
  education: Education[];
  projects: Project[];
};

export function ProfileEditor({ profile: p, missing }: { profile: P; missing: string[] }) {
  const [exps, setExps] = useState<Experience[]>(p.experiences);
  const [edu, setEdu] = useState<Education[]>(p.education);
  const [projects, setProjects] = useState<Project[]>(p.projects);
  const miss = (label: string) => missing.includes(label);
  const inv = (label: string) => (miss(label) ? { "aria-invalid": true as const } : {});

  const updExp = (i: number, patch: Partial<Experience>) => setExps(exps.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const updEdu = (i: number, patch: Partial<Education>) => setEdu(edu.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const updProj = (i: number, patch: Partial<Project>) => setProjects(projects.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <ActionForm action={saveProfileAction} className="grid gap-6">
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="experiences" value={JSON.stringify(exps.map((e) => ({ ...e, bullets: e.bullets.map((b) => b.trim()).filter(Boolean) })))} />
      <input type="hidden" name="education" value={JSON.stringify(edu)} />
      <input type="hidden" name="projects" value={JSON.stringify(projects)} />

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Profile name" htmlFor="name">
            <Input id="name" name="name" defaultValue={p.name} />
          </Field>
          <Field label="Full name" htmlFor="fullName" missing={miss("Full name")}>
            <Input id="fullName" name="fullName" defaultValue={p.fullName} {...inv("Full name")} />
          </Field>
          <Field label="Email" htmlFor="email" missing={miss("Email")}>
            <Input id="email" name="email" type="email" defaultValue={p.email} {...inv("Email")} />
          </Field>
          <Field label="Phone" htmlFor="phone" missing={miss("Phone")}>
            <Input id="phone" name="phone" defaultValue={p.phone} {...inv("Phone")} />
          </Field>
          <Field label="Location (city, country)" htmlFor="location">
            <Input id="location" name="location" defaultValue={p.location} />
          </Field>
          <Field label="LinkedIn URL" htmlFor="linkedin">
            <Input id="linkedin" name="linkedin" defaultValue={p.linkedin} />
          </Field>
          <Field label="Website / GitHub" htmlFor="website">
            <Input id="website" name="website" defaultValue={p.website} />
          </Field>
          <Field label="Headline" htmlFor="headline">
            <Input id="headline" name="headline" defaultValue={p.headline} placeholder="e.g. Machine Learning Engineer" />
          </Field>
          <Field label="Summary" htmlFor="summary" className="sm:col-span-2">
            <Textarea id="summary" name="summary" rows={4} defaultValue={p.summary} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work authorization & preferences</CardTitle>
          <CardDescription>Used for eligibility checks and truthful screening answers. Visa approval is never guaranteed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Citizenship(s)" htmlFor="citizenship" hint="Comma separated, e.g. India, Ireland" missing={miss("Citizenship")}>
            <Input id="citizenship" name="citizenship" defaultValue={p.citizenship} {...inv("Citizenship")} />
          </Field>
          <Field label="Current country" htmlFor="currentCountry" missing={miss("Current country")}>
            <Input id="currentCountry" name="currentCountry" defaultValue={p.currentCountry} {...inv("Current country")} />
          </Field>
          <Field label="Existing work authorization" htmlFor="workAuthorizations" hint="Countries where you can already work without sponsorship (e.g. India, EU, United Kingdom).">
            <Input id="workAuthorizations" name="workAuthorizations" defaultValue={p.workAuthorizations} />
          </Field>
          <Field label="Relocation countries" htmlFor="relocationCountries" hint="Leave empty for “anywhere”.">
            <Input id="relocationCountries" name="relocationCountries" defaultValue={p.relocationCountries} />
          </Field>
          <Checkbox name="needsSponsorship" defaultChecked={p.needsSponsorship} label="I need visa sponsorship outside the countries above" />
          <Checkbox name="willingToRelocate" defaultChecked={p.willingToRelocate} label="I'm willing to relocate" />
          <Field label="Salary expectation (per year)" htmlFor="salaryExpectation">
            <div className="flex gap-2">
              <Input id="salaryExpectation" name="salaryExpectation" inputMode="numeric" defaultValue={p.salaryExpectation} />
              <Input name="salaryCurrency" defaultValue={p.salaryCurrency} className="w-24" aria-label="Currency" />
            </div>
          </Field>
          <Field label="Notice period / availability" htmlFor="noticePeriod">
            <Input id="noticePeriod" name="noticePeriod" defaultValue={p.noticePeriod} placeholder="e.g. 30 days" />
          </Field>
          <Field label="Years of experience" htmlFor="yearsExperience" hint="Leave empty to calculate from your work history.">
            <Input id="yearsExperience" name="yearsExperience" inputMode="decimal" defaultValue={p.yearsExperience} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills & certifications</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Skills" htmlFor="skills" hint="Comma separated. Only list skills you genuinely have – tailoring never adds new ones." missing={miss("Skills")}>
            <Textarea id="skills" name="skills" rows={3} defaultValue={p.skills} {...inv("Skills")} />
          </Field>
          <Field label="Certifications" htmlFor="certifications" hint="Comma separated">
            <Input id="certifications" name="certifications" defaultValue={p.certifications} />
          </Field>
        </CardContent>
      </Card>

      <Card className={miss("Work history") ? "border-destructive" : undefined}>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className={miss("Work history") ? "text-destructive" : undefined}>Work history{miss("Work history") && " (required – missing)"}</CardTitle>
            <CardDescription>One bullet per line. Dates as YYYY-MM or “Present”.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setExps([...exps, { title: "", company: "", location: "", start: "", end: "", bullets: [] }])}>
            <Plus /> Add role
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {exps.map((e, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <Input placeholder="Job title" value={e.title} onChange={(ev) => updExp(i, { title: ev.target.value })} aria-invalid={!e.title || undefined} />
              <Input placeholder="Company" value={e.company} onChange={(ev) => updExp(i, { company: ev.target.value })} aria-invalid={!e.company || undefined} />
              <Input placeholder="Location" value={e.location ?? ""} onChange={(ev) => updExp(i, { location: ev.target.value })} />
              <div className="flex gap-2">
                <Input placeholder="Start (YYYY-MM)" value={e.start ?? ""} onChange={(ev) => updExp(i, { start: ev.target.value })} />
                <Input placeholder="End / Present" value={e.end ?? ""} onChange={(ev) => updExp(i, { end: ev.target.value })} />
              </div>
              <Textarea className="sm:col-span-2" rows={4} placeholder="Achievements, one per line" value={e.bullets.join("\n")} onChange={(ev) => updExp(i, { bullets: ev.target.value.split("\n") })} />
              <Button type="button" variant="ghost" size="sm" className="justify-self-start text-destructive" onClick={() => setExps(exps.filter((_, j) => j !== i))}>
                <Trash2 /> Remove role
              </Button>
            </div>
          ))}
          {exps.length === 0 && <p className="text-sm text-muted-foreground">No roles yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Education</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setEdu([...edu, { degree: "", school: "", field: "", start: "", end: "" }])}>
            <Plus /> Add
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {edu.map((e, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-5">
              <Input placeholder="Degree" value={e.degree} onChange={(ev) => updEdu(i, { degree: ev.target.value })} />
              <Input placeholder="Field" value={e.field ?? ""} onChange={(ev) => updEdu(i, { field: ev.target.value })} />
              <Input placeholder="School" value={e.school} onChange={(ev) => updEdu(i, { school: ev.target.value })} className="sm:col-span-2" />
              <div className="flex gap-1">
                <Input placeholder="Start" value={e.start ?? ""} onChange={(ev) => updEdu(i, { start: ev.target.value })} />
                <Input placeholder="End" value={e.end ?? ""} onChange={(ev) => updEdu(i, { end: ev.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setEdu(edu.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Projects</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setProjects([...projects, { name: "", description: "", link: "" }])}>
            <Plus /> Add
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {projects.map((pr, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
              <Input placeholder="Name" value={pr.name} onChange={(ev) => updProj(i, { name: ev.target.value })} />
              <Input placeholder="Description" value={pr.description} onChange={(ev) => updProj(i, { description: ev.target.value })} />
              <Input placeholder="Link" value={pr.link ?? ""} onChange={(ev) => updProj(i, { link: ev.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setProjects(projects.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <SubmitButton variant="brand" size="lg" pendingText="Saving…">
          Save profile
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
