"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";

type N = { id: string; title: string; body: string; href: string; kind: string };

/** Polls for new notifications and shows them as desktop notifications (if allowed) plus an in-app toast. */
export function NotificationPoller() {
  const [toasts, setToasts] = useState<N[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const router = useRouter();

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (!r.ok) return;
        const list: N[] = await r.json();
        if (!alive || !list.length) return;
        setToasts((t) => [...t, ...list].slice(-4));
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const n of list) {
            const desk = new Notification(n.title, { body: n.body, icon: "/icons/icon-192.png", tag: n.id });
            desk.onclick = () => {
              window.focus();
              if (n.href) router.push(n.href);
            };
          }
        }
        router.refresh();
      } catch {
        /* offline */
      }
    };
    void tick();
    const id = setInterval(tick, 45_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  return (
    <div className="fixed bottom-4 right-4 z-50 grid gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {perm === "default" && (
        <button type="button" onClick={async () => setPerm(await Notification.requestPermission())} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-sm hover:bg-accent">
          <Bell className="size-3.5" /> Allow desktop notifications for interviews, offers and “Needs you”
        </button>
      )}
      {toasts.map((t) => (
        <div key={t.id} role="status" className="rounded-lg border bg-card p-3 shadow-lg text-sm">
          <div className="flex items-start gap-2">
            <Bell className="size-4 mt-0.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <button type="button" className="font-medium text-left hover:underline" onClick={() => t.href && router.push(t.href)}>
                {t.title}
              </button>
              {t.body && <p className="text-xs text-muted-foreground line-clamp-2">{t.body}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="rounded p-0.5 hover:bg-accent">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
