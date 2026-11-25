/**
 * "Ask Upvance anything" – a chat that calls the app's own actions.
 * Every change is recorded with an undo. AI when configured; a rule-based
 * understanding of common requests otherwise.
 */
import { db } from "./db";
import { parseJson } from "./utils";
import { runAI } from "./ai";
import { findCountries, countryName } from "./countries";
import { describeFilters, filtersToQuery, FILTER_KEYS, type FeedFilters } from "./feed";
import { applyToAll, saveWatcher, setWatcher, feedRows } from "./apply/queue";
import { evaluateJob, loadUserContext } from "./matching";
import { logActivity } from "./activity";

export type AssistantAction =
  | { type: "set_filters"; filters: FeedFilters }
  | { type: "create_saved_search"; name?: string; filters: FeedFilters; keepApplying?: boolean; policy?: "review" | "auto"; intervalMin?: number }
  | { type: "update_saved_search"; name: string; filters?: FeedFilters; enabled?: boolean }
  | { type: "set_auto_mode"; on: boolean }
  | { type: "apply_to_all"; filters: FeedFilters; policy?: "review" | "auto" }
  | { type: "keep_applying"; filters: FeedFilters; policy?: "review" | "auto"; intervalMin?: number; name?: string }
  | { type: "explain_match"; query: string }
  | { type: "summarize_inbox" };

export interface ChangeView {
  id: string;
  description: string;
  undone: boolean;
}
export interface AssistantReply {
  reply: string;
  navigate?: string;
  changes: ChangeView[];
}

const SYSTEM = `You are the assistant inside Upvance, a local job-search app for international candidates.
Turn the user's request into actions. Reply briefly in plain English. Never promise visa approval or interviews.
Respond with JSON {"reply": string, "actions": Action[]}. Actions:
- {"type":"set_filters","filters":F} – show jobs matching filters on the feed
- {"type":"create_saved_search","name":string,"filters":F}
- {"type":"update_saved_search","name":string,"filters"?:F,"enabled"?:boolean}
- {"type":"set_auto_mode","on":boolean}
- {"type":"apply_to_all","filters":F,"policy":"review"|"auto"} – only when the user explicitly asks to apply
- {"type":"keep_applying","filters":F,"policy":"review"|"auto","intervalMin":number} – watch for new matches and apply
- {"type":"explain_match","query":string} – explain why a job matches (query = job title/company)
- {"type":"summarize_inbox"}
Filters F keys (all optional): q (title/company words), posted (days), countries (ISO-2 codes), workplace (["remote","hybrid","onsite"]), companies, degree ("none"|"bachelor"|"master"|"phd"), maxExp (years), sponsorship (true = needs visa sponsorship), noClearance (true), fairPay (true = remote pay not cut by location, and not below my minimum), targetRoles (true = only my target roles from Settings, false = all roles; default true), roles (["ML / AI engineering","Software engineering","Data science / analytics","Data engineering","MLOps / Platform","Product / programme"]), level (["Intern","Junior","Mid","Senior","Lead"]), employment (["full-time","contract",...]), pay (min yearly), exclude (words), band ("Excellent"|"Strong"|"Good"|"Moderate").
Default policy is "review" unless the user explicitly asks for auto submit.`;

/** Understand common requests without AI. */
export function parseRequest(text: string, current: FeedFilters = {}): { reply: string; actions: AssistantAction[] } {
  const t = text.toLowerCase();
  const actions: AssistantAction[] = [];
  const f: FeedFilters = {};
  const countries = findCountries(text);
  if (countries.length) f.countries = countries;
  const wp: ("remote" | "hybrid" | "onsite")[] = [];
  if (/\bremote\b/.test(t)) wp.push("remote");
  if (/\bhybrid\b/.test(t)) wp.push("hybrid");
  if (/\bon-?site|in[- ]office\b/.test(t)) wp.push("onsite");
  if (wp.length) f.workplace = wp;
  if (/sponsor|visa/.test(t)) f.sponsorship = true;
  if (/no (security )?clearance|without clearance/.test(t)) f.noClearance = true;
  if (/(same|equal|fair|full|on-?site|local) (remote )?(pay|salary)|pay parity|not location[- ]adjusted/.test(t)) f.fairPay = true;
  if (/(all|any|every|other) (roles|job titles|jobs types)/.test(t)) f.targetRoles = false;
  const posted = t.match(/(?:last|past)\s+(\d+)\s*(day|week|hour)/);
  if (posted) f.posted = posted[2] === "week" ? Number(posted[1]) * 7 : posted[2] === "hour" ? 1 : Number(posted[1]);
  else if (/today|24 hours/.test(t)) f.posted = 1;
  else if (/this week/.test(t)) f.posted = 7;
  const lv = (["intern", "junior", "senior", "lead", "principal"] as const).filter((l) => new RegExp(`\\b${l}\\b`).test(t));
  if (lv.length) f.level = lv.map((l) => l[0].toUpperCase() + l.slice(1));
  const band = t.match(/\b(excellent|strong|good)\b (?:match|matches|jobs)/);
  if (band) f.band = band[1][0].toUpperCase() + band[1].slice(1);
  const pay = t.match(/(?:pay|salary)\D{0,15}(\d+)\s*(k)?/);
  if (pay) f.pay = Number(pay[1]) * (pay[2] ? 1000 : 1);
  const role = text.match(/\b((?:senior |junior |lead |staff )?(?:[a-z]+ ){0,2}(?:engineer|scientist|developer|analyst|designer|manager|architect)s?)\b/i)?.[1];
  if (role) {
    const cleaned = role.replace(/^(only|remote|hybrid|onsite|senior|junior|lead|staff|all|the|for|as|any|new|jobs?)\s+/gi, "").replace(/s$/, "").trim();
    if (cleaned && !/^(engineer|developer)$/i.test(cleaned)) f.q = cleaned;
  }
  const where = f.countries?.map(countryName).join("/");

  if (/inbox|emails?|mail\b/.test(t) && /summar|what|any|new|check/.test(t)) return { reply: "Here's your inbox summary.", actions: [{ type: "summarize_inbox" }] };
  if (/\b(why|explain)\b/.test(t)) return { reply: "Let me explain that match.", actions: [{ type: "explain_match", query: text.replace(/.*\b(why|explain)\b(\s+(does|do|is|the))?/i, "").replace(/\b(match|matches|me|a|good|for)\b/gi, " ").trim() }] };
  if (/auto ?mode/.test(t) && /\b(on|enable|start)\b/.test(t)) return { reply: "Turning auto mode on.", actions: [{ type: "set_auto_mode", on: true }] };
  if (/auto ?mode/.test(t) && /\b(off|disable|stop)\b/.test(t)) return { reply: "Turning auto mode off.", actions: [{ type: "set_auto_mode", on: false }] };
  const merged = Object.keys(f).length ? f : current;
  const policy = /auto ?submit|without (asking|review)/.test(t) ? "auto" : "review";
  if (/keep applying|new matches|watch (for|these)|automatically apply|auto-?apply/.test(t)) return { reply: `I'll keep applying to new jobs matching ${describeFilters(merged)} (${policy === "auto" ? "auto submit" : "review before submit"}).`, actions: [{ type: "keep_applying", filters: merged, policy }] };
  if (/apply to (all|them|these|every)/.test(t)) return { reply: `Queuing applications for jobs matching ${describeFilters(merged)} (${policy === "auto" ? "auto submit" : "you'll review each before it's sent"}).`, actions: [{ type: "apply_to_all", filters: merged, policy }] };
  if (/save (this|these|it)? ?(as )?(a )?search|saved search/.test(t)) return { reply: "Saved this search.", actions: [{ type: "create_saved_search", filters: merged }] };
  if (Object.keys(f).length) {
    if (/\b(only|also|and|add|plus)\b/.test(t) && !/^\s*(show|find|search)/.test(t)) {
      // "only remote jobs in Germany" narrows the current view
      return { reply: `Showing ${describeFilters({ ...current, ...f })}${where ? "" : ""}.`, actions: [{ type: "set_filters", filters: { ...current, ...f } }] };
    }
    return { reply: `Showing ${describeFilters(f)}.`, actions: [{ type: "set_filters", filters: f }] };
  }
  return {
    reply: "I can filter jobs (e.g. “only remote jobs in Germany with sponsorship”), explain a match, save searches, start “Apply to all” or “Keep applying to new matches”, turn auto mode on/off, or summarise your inbox.",
    actions: [],
  };
}

function cleanFilters(raw: unknown): FeedFilters {
  const f = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) if (f[k] != null && f[k] !== "") out[k] = f[k];
  if (Array.isArray(out.countries)) out.countries = (out.countries as string[]).map((c) => c.toUpperCase().slice(0, 2));
  return out as FeedFilters;
}

async function recordChange(userId: string, description: string, undo: Record<string, unknown>) {
  const c = await db.assistantChange.create({ data: { userId, description, undo: JSON.stringify(undo) } });
  return { id: c.id, description, undone: false };
}

async function execute(userId: string, a: AssistantAction, current: FeedFilters, out: AssistantReply, notes: string[]) {
  switch (a.type) {
    case "set_filters": {
      const f = cleanFilters(a.filters);
      out.navigate = `/jobs?${filtersToQuery(f)}`;
      out.changes.push(await recordChange(userId, `Feed filters → ${describeFilters(f)}`, { type: "navigate", url: `/jobs?${filtersToQuery(current)}` }));
      return;
    }
    case "create_saved_search":
    case "keep_applying": {
      const f = cleanFilters(a.filters);
      const keep = a.type === "keep_applying" || a.keepApplying;
      const s = await saveWatcher(userId, f, { name: a.name, policy: a.policy ?? "review", intervalMin: a.intervalMin });
      if (!keep) await db.savedSearch.update({ where: { id: s.id }, data: { autoApply: false } });
      out.changes.push(await recordChange(userId, keep ? `Keep applying to new matches: ${describeFilters(f)} (${a.policy === "auto" ? "auto submit" : "review before submit"})` : `Saved search “${s.name}”`, { type: "delete_saved_search", id: s.id }));
      return;
    }
    case "update_saved_search": {
      const s = await db.savedSearch.findFirst({ where: { userId, name: { contains: a.name } } });
      if (!s) {
        notes.push(`I couldn't find a saved search called “${a.name}”.`);
        return;
      }
      const before = { filters: s.filters, enabled: s.enabled, autoApply: s.autoApply };
      await db.savedSearch.update({ where: { id: s.id }, data: { ...(a.filters ? { filters: JSON.stringify(cleanFilters(a.filters)) } : {}), ...(a.enabled != null ? { enabled: a.enabled } : {}) } });
      if (a.enabled === false && s.autoApply) await setWatcher(userId, s.id, false);
      out.changes.push(await recordChange(userId, `Updated saved search “${s.name}”`, { type: "restore_saved_search", id: s.id, data: before }));
      return;
    }
    case "set_auto_mode": {
      const s = await db.userSettings.findUniqueOrThrow({ where: { userId } });
      await db.userSettings.update({ where: { userId }, data: { autoModeEnabled: a.on } });
      await logActivity(userId, `Auto mode turned ${a.on ? "ON" : "OFF"} by the assistant`, "", false);
      out.changes.push(await recordChange(userId, `Auto mode ${a.on ? "ON" : "OFF"}`, { type: "set_auto_mode", on: s.autoModeEnabled }));
      return;
    }
    case "apply_to_all": {
      const f = cleanFilters(a.filters);
      const before = new Set((await db.applyJob.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id));
      const r = await applyToAll(userId, f, { policy: a.policy ?? "review" });
      const created = (await db.applyJob.findMany({ where: { userId, status: "queued" }, select: { id: true } })).filter((x) => !before.has(x.id)).map((x) => x.id);
      out.changes.push(await recordChange(userId, `Apply to all: ${r.queued} job(s) queued for ${describeFilters(f)} (${a.policy === "auto" ? "auto submit" : "review before submit"})`, { type: "unqueue", ids: created }));
      return;
    }
    case "explain_match": {
      const ctx = await loadUserContext(userId);
      const rows = await feedRows(userId, { q: a.query || undefined, eligibility: "all" });
      const m = rows[0];
      if (!m || !ctx.candidate) {
        notes.push(`I couldn't find a job matching “${a.query}”.`);
        return;
      }
      const ev = evaluateJob(m.job, ctx.candidate, ctx.prefs, ctx.weights);
      notes.push(
        `**${m.job.title} at ${m.job.company.name}** – suitability ${ev.score} (${ev.eligibility.status === "Ineligible" ? "Ineligible" : ev.band}).\n` +
          [...ev.whyMatch.map((w) => `✓ ${w}`), ...ev.whyNot.map((w) => `✗ ${w}`), ...(ev.eligibility.status !== "Eligible" ? ev.eligibility.reasons.map((r) => `⚠ ${r}`) : [])].join("\n"),
      );
      return;
    }
    case "summarize_inbox": {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const emails = await db.email.findMany({ where: { userId, date: { gte: since }, direction: "in" }, orderBy: { date: "desc" } });
      if (!emails.length) {
        notes.push("No job emails in the last 7 days" + ((await db.mailbox.count({ where: { userId } })) ? "." : " – connect your mailbox on the Inbox page."));
        return;
      }
      const by = new Map<string, number>();
      for (const e of emails) by.set(e.category, (by.get(e.category) ?? 0) + 1);
      const important = emails.filter((e) => ["Interview", "Offer", "Assessment", "Recruiter"].includes(e.category)).slice(0, 5);
      notes.push(
        `Last 7 days: ${Array.from(by.entries()).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
          (important.length ? `\nNeeds attention:\n${important.map((e) => `• ${e.category}: ${e.companyName ?? e.fromName} – ${e.subject}`).join("\n")}` : "") +
          `\nUnread: ${emails.filter((e) => !e.read).length}.`,
      );
      return;
    }
  }
}

export async function ask(userId: string, message: string, current: FeedFilters = {}): Promise<AssistantReply> {
  await db.assistantMessage.create({ data: { userId, role: "user", content: message.slice(0, 2000) } });
  const searches = await db.savedSearch.findMany({ where: { userId }, select: { name: true, autoApply: true, enabled: true } });
  let plan: { reply: string; actions: AssistantAction[] };
  const ai = await runAI<{ reply: string; actions: AssistantAction[] }>({
    role: "analysis",
    task: "assistant",
    userId,
    cache: false,
    input: {
      system: SYSTEM,
      prompt: `Current feed filters: ${JSON.stringify(current)}\nSaved searches: ${JSON.stringify(searches)}\n\nUser: ${message}`,
      json: true,
      maxTokens: 800,
      temperature: 0.1,
    },
  });
  plan = ai.ok && typeof ai.data?.reply === "string" ? { reply: ai.data.reply, actions: Array.isArray(ai.data.actions) ? ai.data.actions.slice(0, 4) : [] } : parseRequest(message, current);

  const out: AssistantReply = { reply: plan.reply, changes: [] };
  const notes: string[] = [];
  for (const a of plan.actions) {
    try {
      await execute(userId, a, current, out, notes);
    } catch (e) {
      notes.push(`Couldn't do that: ${(e as Error).message}`);
    }
  }
  if (notes.length) out.reply = [out.reply, ...notes].join("\n\n");
  await db.assistantMessage.create({ data: { userId, role: "assistant", content: out.reply, actions: JSON.stringify(out.changes) } });
  return out;
}

/** Undo one change the assistant made. */
export async function undoChange(userId: string, changeId: string): Promise<{ navigate?: string; message: string }> {
  const c = await db.assistantChange.findFirstOrThrow({ where: { id: changeId, userId } });
  if (c.undone) return { message: "Already undone." };
  const u = parseJson<Record<string, unknown>>(c.undo, {});
  let navigate: string | undefined;
  if (u.type === "navigate") navigate = String(u.url);
  if (u.type === "delete_saved_search") {
    await db.applyJob.updateMany({ where: { userId, savedSearchId: String(u.id), status: "queued" }, data: { status: "stopped", reason: "Undone" } });
    await db.savedSearch.deleteMany({ where: { id: String(u.id), userId } });
  }
  if (u.type === "restore_saved_search") await db.savedSearch.updateMany({ where: { id: String(u.id), userId }, data: u.data as object });
  if (u.type === "set_auto_mode") await db.userSettings.update({ where: { userId }, data: { autoModeEnabled: !!u.on } });
  if (u.type === "unqueue") await db.applyJob.deleteMany({ where: { userId, id: { in: (u.ids as string[]) ?? [] }, status: "queued" } });
  await db.assistantChange.update({ where: { id: c.id }, data: { undone: true } });
  return { navigate, message: `Undone: ${c.description}` };
}
