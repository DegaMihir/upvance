"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Send, Sparkles, Undo2 } from "lucide-react";

type Change = { id: string; description: string; undone: boolean };
type Msg = { role: "user" | "assistant"; content: string; changes?: Change[] };

export function AssistantChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : []))
      .then(setMsgs)
      .catch(() => {});
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const params = new URLSearchParams(sp.toString());
      params.delete("job");
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, query: params.toString() }) });
      const data = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: data.reply ?? data.error, changes: data.changes }]);
      if (data.navigate) router.push(data.navigate);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ undo: id }) });
    const data = await r.json();
    setMsgs((m) => [...m.map((x) => ({ ...x, changes: x.changes?.map((c) => (c.id === id ? { ...c, undone: true } : c)) })), { role: "assistant", content: data.message }]);
    if (data.navigate) router.push(data.navigate);
    else router.refresh();
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" /> Ask Upvance anything
      </div>
      <div className="max-h-72 overflow-y-auto grid gap-2 text-sm" aria-live="polite">
        {msgs.length === 0 && <p className="text-xs text-muted-foreground">Try: “only remote jobs in Germany with sponsorship”, “why does the Nominal job match?”, “keep applying to new ML engineer jobs in the UK”, “summarise my inbox”.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "justify-self-end max-w-[90%] rounded-lg bg-primary/10 px-3 py-2" : "max-w-[95%] rounded-lg border bg-muted/40 px-3 py-2"}>
            <div className="whitespace-pre-wrap">{m.content.replace(/\*\*/g, "")}</div>
            {m.changes?.map((c) => (
              <div key={c.id} className="mt-1 flex items-center gap-2 text-xs">
                <span className={c.undone ? "line-through text-muted-foreground" : "text-emerald-700 dark:text-emerald-300"}>✓ {c.description}</span>
                {!c.undone && (
                  <button type="button" onClick={() => undo(c.id)} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                    <Undo2 className="size-3" /> Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or tell me what to do…" className="h-9 flex-1 rounded-md border bg-card px-3 text-sm" aria-label="Message the assistant" />
        <button type="submit" disabled={busy} className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-60" aria-label="Send">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
    </div>
  );
}
