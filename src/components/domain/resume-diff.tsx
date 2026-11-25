"use client";

import { diffWords } from "diff";
import type { ResumeDoc } from "@/lib/resume/document";

function Diffed({ a, b, side }: { a: string; b: string; side: "left" | "right" }) {
  const parts = diffWords(a ?? "", b ?? "");
  return (
    <span>
      {parts.map((p, i) => {
        if (p.added) return side === "right" ? <ins key={i} className="bg-emerald-500/20 no-underline rounded-sm">{p.value}</ins> : null;
        if (p.removed) return side === "left" ? <del key={i} className="bg-red-500/20 rounded-sm">{p.value}</del> : null;
        return <span key={i}>{p.value}</span>;
      })}
    </span>
  );
}

function Column({ doc, other, side, title }: { doc: ResumeDoc; other: ResumeDoc; side: "left" | "right"; title: string }) {
  const a = side === "left" ? doc : other;
  const b = side === "left" ? other : doc;
  return (
    <div className="rounded-lg border p-4 text-sm grid gap-3 content-start bg-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div>
        <div className="font-semibold">Summary</div>
        <p className="text-muted-foreground">
          <Diffed a={a.summary} b={b.summary} side={side} />
        </p>
      </div>
      <div>
        <div className="font-semibold">Skills</div>
        <p className="text-muted-foreground">
          {doc.skills.map((s, i) => (
            <span key={s} className={other.skills[i] !== s ? "bg-blue-500/15 rounded-sm" : undefined}>
              {s}
              {i < doc.skills.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      </div>
      {doc.experiences.map((e, i) => {
        const o = other.experiences[i];
        return (
          <div key={i}>
            <div className="font-semibold">
              {e.title} – {e.company}
            </div>
            <ul className="list-disc pl-4 grid gap-1 text-muted-foreground">
              {e.bullets.map((bl, j) => {
                const counterpart = o?.bullets[j] ?? "";
                const moved = o && o.bullets.includes(bl) && counterpart !== bl;
                if (moved || (o && o.bullets.includes(bl))) return <li key={j} className={moved ? "bg-blue-500/10 rounded-sm" : undefined}>{bl}</li>;
                return (
                  <li key={j}>
                    {side === "left" ? <Diffed a={bl} b={counterpart} side="left" /> : <Diffed a={counterpart} b={bl} side="right" />}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ResumeDiff({ original, tailored }: { original: ResumeDoc; tailored: ResumeDoc }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Column doc={original} other={tailored} side="left" title="Original" />
      <Column doc={tailored} other={original} side="right" title="Tailored for this job" />
      <p className="md:col-span-2 text-xs text-muted-foreground">
        <span className="bg-red-500/20 px-1 rounded-sm">removed</span> <span className="bg-emerald-500/20 px-1 rounded-sm">added wording</span> <span className="bg-blue-500/15 px-1 rounded-sm">moved / reordered</span> – no new facts are allowed; unsupported edits are reverted automatically.
      </p>
    </div>
  );
}
