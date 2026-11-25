/**
 * Advanced analytics (phase 3): funnel, trends, time to response,
 * does the score predict responses, sources and AI usage.
 */
import { db } from "./db";
import { RESPONSE_STATUSES, POST_SUBMIT } from "./applications";
import { evaluateJob, loadUserContext } from "./matching";
import { candidateFromProfile } from "./matching/candidate";
import { bandFor } from "./matching/scoring";

const DAY = 86_400_000;

export async function funnel(userId: string) {
  const [discovered, matches, apps] = await Promise.all([
    db.job.count(),
    db.match.findMany({ where: { userId }, select: { eligibility: true, score: true } }),
    db.application.findMany({ where: { userId }, select: { status: true } }),
  ]);
  const submitted = apps.filter((a) => POST_SUBMIT.includes(a.status as never)).length;
  return [
    { label: "Jobs discovered", value: discovered },
    { label: "Eligible matches", value: matches.filter((m) => m.eligibility !== "Ineligible").length },
    { label: "Good+ matches", value: matches.filter((m) => m.eligibility !== "Ineligible" && m.score >= 65).length },
    { label: "Applications prepared", value: apps.length },
    { label: "Submitted", value: submitted },
    { label: "Responses", value: apps.filter((a) => RESPONSE_STATUSES.includes(a.status as never)).length },
    { label: "Interviews", value: apps.filter((a) => a.status === "Interview" || a.status === "Offer").length },
    { label: "Offers", value: apps.filter((a) => a.status === "Offer").length },
  ];
}

/** Cumulative response rate by week (only applications old enough to have had a chance to respond). */
export async function responseRateTrend(userId: string, weeks = 10, now = new Date()) {
  const apps = await db.application.findMany({ where: { userId, submittedAt: { not: null } }, select: { submittedAt: true, status: true } });
  const out: { label: string; rate: number; submitted: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * DAY);
    const upTo = apps.filter((a) => a.submittedAt! <= end);
    const resp = upTo.filter((a) => RESPONSE_STATUSES.includes(a.status as never)).length;
    out.push({ label: end.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), rate: upTo.length ? Math.round((resp / upTo.length) * 100) : 0, submitted: upTo.length });
  }
  return out;
}

/** Days from submission to the first outcome update (median and buckets). */
export async function timeToResponse(userId: string) {
  const apps = await db.application.findMany({
    where: { userId, submittedAt: { not: null }, status: { in: [...RESPONSE_STATUSES, "Rejected"] as string[] } },
    include: { events: { where: { type: "outcome" }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const days = apps
    .map((a) => (a.events[0] ? Math.max(0, Math.round((a.events[0].createdAt.getTime() - a.submittedAt!.getTime()) / DAY)) : null))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  const median = days.length ? days[Math.floor(days.length / 2)] : null;
  const buckets = [
    { label: "≤ 3 days", value: days.filter((d) => d <= 3).length },
    { label: "4–7 days", value: days.filter((d) => d > 3 && d <= 7).length },
    { label: "8–14 days", value: days.filter((d) => d > 7 && d <= 14).length },
    { label: "15+ days", value: days.filter((d) => d > 14).length },
  ];
  return { median, count: days.length, buckets };
}

/** Does the suitability score line up with responses? (A sanity check on the weights.) */
export async function scoreVsResponse(userId: string) {
  const ctx = await loadUserContext(userId);
  const apps = await db.application.findMany({ where: { userId, status: { in: POST_SUBMIT as unknown as string[] } }, include: { job: { include: { company: true } }, profile: true } });
  const rows = new Map<string, { label: string; applied: number; responses: number }>();
  for (const b of ["Excellent", "Strong", "Good", "Moderate", "Poor"]) rows.set(b, { label: b, applied: 0, responses: 0 });
  for (const a of apps) {
    const ev = evaluateJob(a.job, candidateFromProfile(a.profile), ctx.prefs, ctx.weights);
    const r = rows.get(bandFor(ev.score))!;
    r.applied++;
    if (RESPONSE_STATUSES.includes(a.status as never)) r.responses++;
  }
  return Array.from(rows.values()).map((r) => ({ ...r, rate: r.applied ? Math.round((r.responses / r.applied) * 100) : 0 }));
}

export async function distributions(userId: string) {
  const matches = await db.match.findMany({ where: { userId, job: { isActive: true } }, include: { job: { select: { sponsorshipCategory: true, remoteCategory: true, source: true } } } });
  const count = (key: (m: (typeof matches)[number]) => string) => {
    const map = new Map<string, number>();
    for (const m of matches) map.set(key(m), (map.get(key(m)) ?? 0) + 1);
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };
  return {
    sponsorship: count((m) => m.job.sponsorshipCategory),
    remote: count((m) => m.job.remoteCategory),
    source: count((m) => m.job.source),
    eligibility: count((m) => m.eligibility),
  };
}

export async function aiUsageTrend(days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
  const rows = await db.aiUsage.findMany({ where: { day: { gte: since } } });
  const out: { label: string; requests: number; failures: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    const today = rows.filter((r) => r.day === d);
    out.push({ label: d.slice(5), requests: today.reduce((n, r) => n + r.requests, 0), failures: today.reduce((n, r) => n + r.failures, 0) });
  }
  return out;
}

export async function applicationsCsv(userId: string) {
  const apps = await db.application.findMany({ where: { userId }, include: { job: { include: { company: true } }, profile: true }, orderBy: { createdAt: "asc" } });
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v instanceof Date ? v.toISOString() : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["created", "submitted", "status", "company", "title", "location", "sponsorship", "remote", "resume_profile", "origin", "apply_url"];
  const lines = apps.map((a) => [a.createdAt, a.submittedAt, a.status, a.job.company.name, a.job.title, a.job.location, a.job.sponsorshipCategory, a.job.remoteCategory, a.profile.name, a.origin, a.job.applyUrl].map(esc).join(","));
  return [header.join(","), ...lines].join("\r\n");
}
