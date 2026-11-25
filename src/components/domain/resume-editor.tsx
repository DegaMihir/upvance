"use client";

import { useState } from "react";
import type { ResumeDoc } from "@/lib/resume/document";
import { Textarea } from "@/components/ui/form";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { resumeDecisionAction } from "@/app/actions/applications";

/** Lets the user edit wording of the tailored resume (summary, skill order, bullets). */
export function ResumeEditor({ appId, doc }: { appId: string; doc: ResumeDoc }) {
  const [d, setD] = useState<ResumeDoc>(doc);
  return (
    <ActionForm action={resumeDecisionAction} className="grid gap-3">
      <input type="hidden" name="id" value={appId} />
      <input type="hidden" name="decision" value="draft" />
      <input type="hidden" name="doc" value={JSON.stringify(d)} />
      <label className="grid gap-1 text-sm">
        Summary
        <Textarea rows={4} value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">
        Skills (order matters; comma separated)
        <Textarea rows={2} value={d.skills.join(", ")} onChange={(e) => setD({ ...d, skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </label>
      {d.experiences.map((e, i) => (
        <label key={i} className="grid gap-1 text-sm">
          {e.title} – {e.company} (one bullet per line)
          <Textarea
            rows={Math.max(3, e.bullets.length + 1)}
            value={e.bullets.join("\n")}
            onChange={(ev) => setD({ ...d, experiences: d.experiences.map((x, j) => (j === i ? { ...x, bullets: ev.target.value.split("\n") } : x)) })}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">You are responsible for keeping your edits truthful.</p>
      <SubmitButton variant="outline">Save edits</SubmitButton>
    </ActionForm>
  );
}
