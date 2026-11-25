"use client";

import { useState, useTransition } from "react";
import { Eye, Loader2, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { applyToAllAction, keepApplyingAction, previewApplyAllAction } from "@/app/actions/apply";

type Preview = Awaited<ReturnType<typeof previewApplyAllAction>>;

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-xl max-h-[90dvh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ApplyBar({ query, defaultPolicy, matchCount }: { query: string; defaultPolicy: "review" | "auto"; matchCount: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [policy, setPolicy] = useState<"review" | "auto">(defaultPolicy);
  const [open, setOpen] = useState<"apply" | "keep" | null>(null);
  const [pending, start] = useTransition();

  const openApply = (p: "review" | "auto" = policy) =>
    start(async () => {
      setPreview(await previewApplyAllAction(query, p));
      setOpen("apply");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="brand" onClick={() => openApply()} disabled={pending || matchCount === 0}>
        {pending ? <Loader2 className="animate-spin" /> : <Rocket />} Apply to all ({matchCount})
      </Button>
      <Button variant="outline" onClick={() => setOpen("keep")}>
        <Eye /> Keep applying to new matches
      </Button>

      {open === "apply" && preview && (
        <Dialog title="Apply to all matching jobs?" onClose={() => setOpen(null)}>
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">Filters: {preview.description}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-2">
                <div className="text-2xl font-bold">{preview.count}</div>
                <div className="text-xs text-muted-foreground">will be queued</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-2xl font-bold">{preview.needsReview}</div>
                <div className="text-xs text-muted-foreground">need your review</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-2xl font-bold">~{preview.estimatedMinutes < 60 ? `${preview.estimatedMinutes}m` : `${Math.round(preview.estimatedMinutes / 6) / 10}h`}</div>
                <div className="text-xs text-muted-foreground">estimated time</div>
              </div>
            </div>
            <p>
              Daily cap: {preview.cap.used}/{preview.cap.cap} used today.{" "}
              {preview.count > preview.cap.remaining ? `${preview.count - preview.cap.remaining} job(s) will wait and continue automatically over about ${preview.daysNeeded} day(s).` : "All fit within today's cap."} Highest match first, one at a time.
            </p>
            {preview.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer text-primary">{preview.skipped.reduce((n, s) => n + s.count, 0)} of {preview.matched} matching jobs will be skipped</summary>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {preview.skipped.map((s) => (
                    <li key={s.reason}>
                      {s.reason}: {s.count}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-xs text-muted-foreground">Submit policy</legend>
              <label className="flex gap-2">
                <input type="radio" checked={policy === "review"} onChange={() => (setPolicy("review"), openApply("review"))} /> <span><b>Review before submit</b> (recommended) – the engine fills each form, takes a screenshot and waits for your Approve.</span>
              </label>
              <label className="flex gap-2">
                <input type="radio" checked={policy === "auto"} onChange={() => (setPolicy("auto"), openApply("auto"))} /> <span><b>Auto submit</b> – submits without asking you first.</span>
              </label>
              {policy === "auto" && <Alert variant="warning">Auto submit sends applications in your name without a final check. Questions your profile can&apos;t answer, CAPTCHAs and uncertain eligibility still pause for you.</Alert>}
            </fieldset>
            <ActionForm action={applyToAllAction} className="grid gap-2">
              <input type="hidden" name="filters" value={query} />
              <input type="hidden" name="policy" value={policy} />
              <SubmitButton variant="brand" disabled={!preview.count} pendingText="Queuing…">
                Queue {preview.count} application(s)
              </SubmitButton>
            </ActionForm>
          </div>
        </Dialog>
      )}

      {open === "keep" && (
        <Dialog title="Keep applying to new matches" onClose={() => setOpen(null)}>
          <ActionForm action={keepApplyingAction} className="grid gap-3 text-sm">
            <p className="text-muted-foreground">Saves the current filters. Whenever discovery finds new jobs that match them, they&apos;re queued and applied to with the same settings.</p>
            <input type="hidden" name="filters" value={query} />
            <label className="grid gap-1">
              Name
              <input name="name" className="h-9 rounded-md border bg-card px-2" placeholder="e.g. Remote ML jobs with sponsorship" />
            </label>
            <label className="grid gap-1">
              Check for new jobs every
              <select name="interval" defaultValue="60" className="h-9 rounded-md border bg-card px-2">
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="180">3 hours</option>
                <option value="360">6 hours</option>
              </select>
            </label>
            <label className="grid gap-1">
              Submit policy
              <select name="policy" defaultValue={defaultPolicy} className="h-9 rounded-md border bg-card px-2">
                <option value="review">Review before submit (recommended)</option>
                <option value="auto">Auto submit</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">Uses your default resume profile, tailoring mode, daily cap and the minimum match in the filters. Turn it off any time – submitted applications stay submitted.</p>
            <SubmitButton variant="brand">Start watching</SubmitButton>
          </ActionForm>
        </Dialog>
      )}
    </div>
  );
}
