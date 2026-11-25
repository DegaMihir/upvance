import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { missingProfileFields } from "@/lib/resume/document";
import { parseJson } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ProfileEditor } from "./profile-editor";
import { deleteProfileAction } from "@/app/actions/profile";
import type { Education, Experience, Project } from "@/lib/matching/candidate";

export const metadata = { title: "Edit profile" };

export default async function ProfileEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ parsed?: string }> }) {
  const { id } = await params;
  const { parsed } = await searchParams;
  const userId = await requireUserId();
  const p = await db.profile.findFirst({ where: { id, userId } });
  if (!p) notFound();
  const missing = missingProfileFields(p);
  return (
    <>
      <PageHeader
        title={`Edit “${p.name}”`}
        description="Review every field. Upvance only ever uses what's here – it never invents experience, skills, degrees or dates."
        actions={
          <form action={deleteProfileAction}>
            <input type="hidden" name="id" value={p.id} />
            <Button variant="ghost" type="submit" className="text-destructive">
              Delete profile
            </Button>
          </form>
        }
      />
      {parsed && (
        <Alert variant={missing.length ? "warning" : "success"} title={`Resume extracted (${p.parsedBy === "ai" ? "with AI" : "rule-based parser"})`} className="mb-4">
          Please check each field{missing.length ? `. Missing required fields are highlighted in red: ${missing.join(", ")}` : ""}.
        </Alert>
      )}
      <ProfileEditor
        missing={missing}
        profile={{
          id: p.id,
          name: p.name,
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          location: p.location,
          linkedin: p.linkedin,
          website: p.website,
          headline: p.headline,
          summary: p.summary,
          skills: parseJson<string[]>(p.skills, []).join(", "),
          certifications: parseJson<string[]>(p.certifications, []).join(", "),
          citizenship: p.citizenship,
          currentCountry: p.currentCountry,
          workAuthorizations: parseJson<string[]>(p.workAuthorizations, []).map((c) => (c === "EU" ? "EU" : countryName(c))).join(", "),
          needsSponsorship: p.needsSponsorship,
          willingToRelocate: p.willingToRelocate,
          relocationCountries: parseJson<string[]>(p.relocationCountries, []).map(countryName).join(", "),
          salaryExpectation: p.salaryExpectation?.toString() ?? "",
          salaryCurrency: p.salaryCurrency,
          noticePeriod: p.noticePeriod,
          yearsExperience: p.yearsExperience?.toString() ?? "",
          experiences: parseJson<Experience[]>(p.experiences, []),
          education: parseJson<Education[]>(p.education, []),
          projects: parseJson<Project[]>(p.projects, []),
        }}
      />
    </>
  );
}
