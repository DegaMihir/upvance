import Link from "next/link";
import { FileUp, Plus, Star } from "lucide-react";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { missingProfileFields } from "@/lib/resume/document";
import { formatDate, parseJson } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createProfileAction, setDefaultProfileAction, uploadResumeAction } from "@/app/actions/profile";

export const metadata = { title: "Profile & resumes" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const userId = await requireUserId();
  const profiles = await db.profile.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { applications: true } } } });
  return (
    <>
      <PageHeader title="Profile & resumes" description="Keep several resume profiles (e.g. “AI resume”, “Software resume”). Each saved search and application can use a different one." />
      {welcome && (
        <Alert variant="success" title="Welcome!" className="mb-6">
          Start by uploading your resume PDF – Upvance extracts the details and you review every field.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 grid gap-3 content-start">
          {profiles.map((p) => {
            const missing = missingProfileFields(p);
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/profile/${p.id}`} className="font-semibold hover:underline">
                        {p.name}
                      </Link>
                      {p.isDefault && (
                        <Badge>
                          <Star /> Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {p.fullName || "No name"} · {p.headline || "No headline"} · {parseJson<string[]>(p.skills, []).length} skills · {parseJson<unknown[]>(p.experiences, []).length} roles
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.resumeFileName ? `From ${p.resumeFileName} (${p.parsedBy === "ai" ? "AI-parsed" : "rule-parsed"})` : "Entered manually"} · updated {formatDate(p.updatedAt)} · used by {p._count.applications} applications
                    </p>
                    {missing.length > 0 && <p className="text-xs text-red-600 dark:text-red-400 mt-1">Missing required: {missing.join(", ")}</p>}
                  </div>
                  <div className="flex gap-2">
                    {!p.isDefault && (
                      <form action={setDefaultProfileAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <Button size="sm" variant="ghost" type="submit">
                          Make default
                        </Button>
                      </form>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/profile/${p.id}`}>Edit</Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        <div className="grid gap-6 content-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileUp className="size-4" /> Upload resume (PDF)
              </CardTitle>
              <CardDescription>Max 10 MB. AI extracts the details if configured; otherwise a rule-based parser does. You review everything.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={uploadResumeAction} className="grid gap-3">
                <Input type="file" name="resume" accept="application/pdf,.pdf" required />
                <Select name="profileId" defaultValue="">
                  <option value="">Create a new profile</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      Update “{p.name}”
                    </option>
                  ))}
                </Select>
                <Input name="name" placeholder="New profile name (e.g. AI resume)" />
                <SubmitButton pendingText="Reading your resume…">Upload & extract</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="size-4" /> New profile
              </CardTitle>
              <CardDescription>Copy an existing profile and adjust its emphasis, or start blank (manual entry).</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createProfileAction} className="grid gap-3">
                <Input name="name" placeholder="Profile name" required />
                <Select name="copyFrom" defaultValue={profiles[0]?.id ?? ""}>
                  <option value="">Start blank</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      Copy “{p.name}”
                    </option>
                  ))}
                </Select>
                <SubmitButton variant="outline">Create</SubmitButton>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
