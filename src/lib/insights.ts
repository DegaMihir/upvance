/**
 * Insights & continuous optimisation: what's working, and suggestions
 * the user can apply with one click (never applied automatically).
 */
import { db } from "./db";
import { parseJson } from "./utils";
import { analysisOf, evaluateJob, loadUserContext } from "./matching";
import { candidateFromProfile } from "./matching/candidate";
import { DEFAULT_WEIGHTS, normalizeWeights, WEIGHT_LABELS, type WeightKey, type Weights } from "./matching/scoring";
import { POST_SUBMIT, RESPONSE_STATUSES } from "./applications";

export function roleFamily(title: string): string {
  const t = title.toLowerCase();
  if (/\b(mlops|platform|devops|sre|infrastructure)\b/.test(t)) return "MLOps / Platform";
  if (/\b(llm|nlp|machine learning|ml|ai|computer vision|applied scientist|deep learning)\b/.test(t)) return "ML / AI engineering";
  if (/\bdata engineer/.test(t)) return "Data engineering";
  if (/\b(data scien|analyst|analytics)/.test(t)) return "Data science / analytics";
  if (/\b(backend|software|developer|python|full[- ]?stack|engineer)\b/.test(t)) return "Software engineering";
  if (/\b(product|program|project) manager/.test(t)) return "Product / programme";
  return "Other";
}

export interface Group {
  label: string;
  applied: number;
  responses: number;
  interviews: number;
  offers: number;
  rejected: number;
  noResponse: number;
  rate: number;
}

function group<T>(items: T[], key: (t: T) => string | string[], outcome: (t: T) => string): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    const keys = ([] as string[]).concat(key(it));
    const s = outcome(it);
    for (const k of keys) {
      const g = map.get(k) ?? { label: k, applied: 0, responses: 0, interviews: 0, offers: 0, rejected: 0, noResponse: 0, rate: 0 };
      g.applied++;
      if (RESPONSE_STATUSES.includes(s as never)) g.responses++;
      if (s === "Interview" || s === "Offer") g.interviews++;
      if (s === "Offer") g.offers++;
      if (s === "Rejected") g.rejected++;
      if (s === "No response" || s === "Submitted") g.noResponse++;
      map.set(k, g);
    }
  }
  return Array.from(map.values())
    .map((g) => ({ ...g, rate: g.applied ? Math.round((g.responses / g.applied) * 100) : 0 }))
    .sort((a, b) => b.applied - a.applied || b.rate - a.rate);
}

export async function computeInsights(userId: string) {
  const apps = await db.application.findMany({
    where: { userId, status: { in: POST_SUBMIT as unknown as string[] } },
    include: { job: { include: { company: true } }, profile: true },
  });
  const outcome = (a: (typeof apps)[number]) => a.status;
  const total = apps.length;
  const responses = apps.filter((a) => RESPONSE_STATUSES.includes(a.status as never)).length;
  return {
    total,
    responses,
    overallRate: total ? Math.round((responses / total) * 100) : 0,
    byRole: group(apps, (a) => roleFamily(a.job.title), outcome),
    byProfile: group(apps, (a) => a.profile.name, outcome),
    byCompany: group(apps, (a) => a.job.company.name, outcome).slice(0, 12),
    byOrigin: group(apps, (a) => (a.origin === "auto" ? "Auto mode" : a.origin === "extension" ? "Extension" : "Manual"), outcome),
    bySponsorship: group(apps, (a) => a.job.sponsorshipCategory, outcome),
    byRemote: group(apps, (a) => a.job.remoteCategory, outcome),
    bySkill: group(apps, (a) => analysisOf(a.job).requiredSkills.slice(0, 8), outcome).filter((g) => g.applied >= 2).slice(0, 15),
    apps,
  };
}

export interface SuggestionDraft {
  kind: "search" | "weights" | "skill" | "profile";
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

/** Suggest data-driven tweaks to the weights: components that separate responses from silence get more weight. */
export async function suggestWeights(userId: string): Promise<SuggestionDraft | null> {
  const ctx = await loadUserContext(userId);
  const apps = await db.application.findMany({ where: { userId, status: { in: POST_SUBMIT as unknown as string[] } }, include: { job: { include: { company: true } }, profile: true } });
  if (apps.length < 6) return null;
  const sums = { yes: {} as Record<WeightKey, number>, no: {} as Record<WeightKey, number> };
  const n = { yes: 0, no: 0 };
  for (const a of apps) {
    const ev = evaluateJob(a.job, candidateFromProfile(a.profile), ctx.prefs, ctx.weights);
    const bucket = RESPONSE_STATUSES.includes(a.status as never) ? "yes" : "no";
    n[bucket]++;
    for (const k of Object.keys(ev.breakdown.components) as WeightKey[]) sums[bucket][k] = (sums[bucket][k] ?? 0) + ev.breakdown.components[k];
  }
  if (n.yes < 2 || n.no < 2) return null;
  const diffs = (Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).map((k) => ({ k, d: sums.yes[k] / n.yes - sums.no[k] / n.no })).sort((a, b) => b.d - a.d);
  const up = diffs[0];
  const down = diffs[diffs.length - 1];
  if (up.d < 8) return null;
  const current: Weights = normalizeWeights(ctx.weights);
  const next = { ...current, [up.k]: Math.round(current[up.k] + 5), [down.k]: Math.max(0, Math.round(current[down.k] - 5)) };
  return {
    kind: "weights",
    title: `Give “${WEIGHT_LABELS[up.k]}” more weight`,
    detail: `Jobs that got a response scored ${Math.round(up.d)} points higher on ${WEIGHT_LABELS[up.k].toLowerCase()} than jobs that didn't (${n.yes} vs ${n.no} applications). Suggest +5 for ${WEIGHT_LABELS[up.k]}, −5 for ${WEIGHT_LABELS[down.k]}. Small samples can mislead – this is only a suggestion.`,
    payload: { weights: next },
  };
}

export async function generateSuggestions(userId: string): Promise<SuggestionDraft[]> {
  const ins = await computeInsights(userId);
  const out: SuggestionDraft[] = [];
  if (ins.total < 3) return out;

  const bestRole = ins.byRole.filter((g) => g.applied >= 2 && g.rate > ins.overallRate).sort((a, b) => b.rate - a.rate)[0];
  if (bestRole) {
    const titles = Array.from(new Set(ins.apps.filter((a) => roleFamily(a.job.title) === bestRole.label).map((a) => a.job.title.toLowerCase().replace(/^(senior|junior|lead|staff)\s+/, ""))));
    out.push({
      kind: "search",
      title: `Focus on ${bestRole.label} roles`,
      detail: `${bestRole.rate}% response rate (${bestRole.responses}/${bestRole.applied}) vs ${ins.overallRate}% overall. Create a saved search for these titles.`,
      payload: { name: `${bestRole.label} (suggested)`, includeKeywords: titles.slice(0, 4) },
    });
  }
  const profiles = ins.byProfile.filter((g) => g.applied >= 2);
  if (profiles.length >= 2) {
    const [best, worst] = [...profiles].sort((a, b) => b.rate - a.rate);
    if (best.rate - worst.rate >= 15)
      out.push({
        kind: "profile",
        title: `“${best.label}” gets more responses`,
        detail: `${best.rate}% vs ${worst.rate}% for “${worst.label}”. Consider using it for similar roles.`,
        payload: { profile: best.label },
      });
  }
  // Skills that appear in jobs that responded but are missing from the default profile
  const ctx = await loadUserContext(userId);
  const have = new Set((ctx.candidate?.skills ?? []).map((s) => s.toLowerCase()));
  const responded = ins.apps.filter((a) => RESPONSE_STATUSES.includes(a.status as never));
  const counts = new Map<string, number>();
  for (const a of responded) for (const s of analysisOf(a.job).requiredSkills) if (!have.has(s.toLowerCase())) counts.set(s, (counts.get(s) ?? 0) + 1);
  const gap = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (gap && gap[1] >= 2)
    out.push({
      kind: "skill",
      title: `Skill gap: ${gap[0]}`,
      detail: `${gap[0]} appears in ${gap[1]} jobs that responded to you but isn't on your profile. Add it only if you genuinely have it – or consider learning it.`,
      payload: { skill: gap[0] },
    });
  const noSpons = ins.bySponsorship.find((g) => g.label === "No Sponsorship");
  if (noSpons && noSpons.applied >= 2 && noSpons.rate === 0)
    out.push({ kind: "search", title: "Turn on the strict sponsorship filter", detail: `${noSpons.applied} applications to “no sponsorship” jobs got no responses.`, payload: { strictSponsorship: true } });
  const w = await suggestWeights(userId);
  if (w) out.push(w);
  return out;
}

/** Store new suggestions (deduplicated by title) – called weekly by the worker or on demand. */
export async function refreshSuggestions(userId: string) {
  const drafts = await generateSuggestions(userId);
  let created = 0;
  for (const d of drafts) {
    const exists = await db.suggestion.findFirst({ where: { userId, title: d.title, status: { in: ["open", "dismissed"] } } });
    if (exists) continue;
    await db.suggestion.create({ data: { userId, kind: d.kind, title: d.title, detail: d.detail, payload: JSON.stringify(d.payload) } });
    created++;
  }
  return created;
}

export async function applySuggestion(userId: string, id: string) {
  const s = await db.suggestion.findFirstOrThrow({ where: { id, userId, status: "open" } });
  const p = parseJson<Record<string, unknown>>(s.payload, {});
  if (s.kind === "weights" && p.weights) {
    await db.userSettings.update({ where: { userId }, data: { scoringWeights: JSON.stringify(p.weights) } });
  } else if (s.kind === "search" && p.includeKeywords) {
    const count = await db.savedSearch.count({ where: { userId } });
    if (count >= 5) throw new Error("You already have 5 saved searches – delete one first.");
    const profile = await db.profile.findFirst({ where: { userId, isDefault: true } });
    await db.savedSearch.create({ data: { userId, name: String(p.name ?? s.title), includeKeywords: JSON.stringify(p.includeKeywords), profileId: profile?.id, enabled: false } });
  } else if (s.kind === "search" && p.strictSponsorship) {
    await db.userSettings.update({ where: { userId }, data: { strictSponsorship: true } });
  }
  await db.suggestion.update({ where: { id }, data: { status: "applied" } });
  return s;
}
