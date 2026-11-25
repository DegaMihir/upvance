import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parse a JSON text column safely. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (v: unknown) => JSON.stringify(v ?? null);

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "unknown date";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function formatMoney(min?: number | null, max?: number | null, currency?: string | null) {
  if (!min && !max) return null;
  const c = currency || "USD";
  const f = (n: number) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${c} ${n.toLocaleString("en")}`;
    }
  };
  if (min && max && min !== max) return `${f(min)} – ${f(max)}`;
  return f((min || max)!);
}

export function splitList(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
