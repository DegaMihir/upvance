"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  ClipboardList,
  Compass,
  Globe2,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Rocket,
  Sheet,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
  X,
} from "lucide-react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/apply-queue", label: "Apply queue", icon: Rocket, badgeKey: "review" as const },
  { href: "/inbox", label: "Inbox", icon: Mail, badgeKey: "unread" as const },
  { href: "/discover", label: "Discover jobs", icon: Compass },
  { href: "/applications", label: "Applications", icon: ClipboardList, badgeKey: "needsYou" as const },
  { href: "/sheet", label: "Applications sheet", icon: Sheet },
  { href: "/profile", label: "Profile & resumes", icon: User },
  { href: "/searches", label: "Auto mode", icon: Bot },
  { href: "/outreach", label: "Recruiter outreach", icon: MessagesSquare },
  { href: "/companies", label: "Employers", icon: Building2 },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/visa", label: "Visa guide", icon: Globe2 },
  { href: "/sponsors", label: "Sponsor lists", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
      aria-label="Toggle dark mode"
    >
      <Sun className="size-4 hidden dark:block" />
      <Moon className="size-4 dark:hidden" />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </button>
  );
}

function NavList({ counts, onNavigate }: { counts: { needsYou: number; unread: number; review: number }; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="grid gap-0.5" aria-label="Main">
      {NAV.map((item) => {
        const active = path === item.href || path.startsWith(item.href + "/");
        const Icon = item.icon;
        const count = item.badgeKey ? counts[item.badgeKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 text-primary font-medium dark:bg-primary/20" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {count > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logo.icon} alt="" width={32} height={32} className="rounded-lg" />
      <div className="leading-tight">
        <div className="font-extrabold tracking-tight brand-text text-lg">{brand.name}</div>
        <div className="text-[10.5px] text-muted-foreground">{brand.tagline}</div>
      </div>
    </Link>
  );
}

export function Sidebar({ counts, userEmail, signOutAction }: { counts: { needsYou: number; unread: number; review: number }; userEmail: string; signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const footer = (
    <div className="grid gap-1 border-t pt-3">
      <ThemeToggle />
      <form action={signOutAction}>
        <button type="submit" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full">
          <LogOut className="size-4" /> Sign out
        </button>
      </form>
      <p className="px-3 text-[11px] text-muted-foreground truncate" title={userEmail}>
        {userEmail}
      </p>
    </div>
  );
  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col gap-5 border-r bg-sidebar p-4">
        <Brand />
        <div className="flex-1 overflow-y-auto">
          <NavList counts={counts} />
        </div>
        {footer}
      </aside>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 backdrop-blur px-4 h-14">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 hover:bg-accent">
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col gap-5 bg-sidebar p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-2 hover:bg-accent">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavList counts={counts} onNavigate={() => setOpen(false)} />
            </div>
            {footer}
          </aside>
        </div>
      )}
    </>
  );
}
