/**
 * Provider-agnostic AI entry point with two roles:
 *  - "analysis": job analysis, eligibility checks, scoring, resume parsing
 *  - "writing": resume tailoring, cover letters, screening answers, recruiter messages
 *
 * Free-tier protection: results are cached (same input → no second call),
 * requests are spaced out per provider, retried with backoff, fall back to a
 * second provider on rate limits, and pause cleanly when daily limits are hit.
 */
import { db } from "../db";
import { decryptSecret } from "../crypto";
import { hashKey } from "../text";
import { parseJson } from "../utils";
import {
  PRICING,
  PROVIDER_INFO,
  PROVIDERS,
  ProviderError,
  RateLimitError,
  callProvider,
  extractJson,
  type CallInput,
  type ProviderName,
} from "./providers";

export type AiRole = "analysis" | "writing";
export const PROMPT_VERSION = "v3";

export type AiResult<T> =
  | { ok: true; data: T; provider: ProviderName; cached: boolean }
  | { ok: false; reason: string; paused?: boolean; off?: boolean };

const MIN_INTERVAL_MS: Record<string, number> = { gemini: 4500, groq: 2200, openrouter: 3500, anthropic: 300 };
const lastCall = new Map<string, number>();
const cooldownUntil = new Map<string, number>();

export function today(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function dailyLimit(provider: string) {
  const specific = Number(process.env[`AI_DAILY_LIMIT_${provider.toUpperCase()}`]);
  if (specific > 0) return specific;
  return Number(process.env.AI_DAILY_LIMIT) || 200;
}

function isProvider(v: unknown): v is ProviderName {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

export async function getKey(provider: ProviderName, userId?: string | null): Promise<string | null> {
  if (provider === "none") return null;
  const envKey = process.env[PROVIDER_INFO[provider].keyVar];
  if (envKey && envKey.trim()) return envKey.trim();
  // Keys entered in Settings are stored encrypted
  const settings = userId
    ? await db.userSettings.findUnique({ where: { userId } })
    : await db.userSettings.findFirst({ where: { encryptedProviderKeys: { not: "{}" } } });
  const stored = parseJson<Record<string, string>>(settings?.encryptedProviderKeys, {});
  return decryptSecret(stored[provider]) || null;
}

export function getModel(provider: ProviderName) {
  const info = PROVIDER_INFO[provider];
  return (info.modelVar && process.env[info.modelVar]) || info.defaultModel;
}

/** Main model plus same-provider fallback models (e.g. a lighter Gemini model when Flash is overloaded). */
export function getModels(provider: ProviderName): string[] {
  const fallbackVar = `${provider.toUpperCase()}_FALLBACK_MODEL`;
  const defaults: Record<string, string> = { gemini: "gemini-flash-lite-latest" };
  const extra = (process.env[fallbackVar] ?? defaults[provider] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set([getModel(provider), ...extra]));
}

export async function providerChain(role: AiRole, userId?: string | null): Promise<ProviderName[]> {
  const settings = userId ? await db.userSettings.findUnique({ where: { userId } }) : null;
  const fromSettings = role === "analysis" ? settings?.analysisProvider : settings?.writingProvider;
  const fromEnv = role === "analysis" ? process.env.ANALYSIS_PROVIDER : process.env.WRITING_PROVIDER;
  const primary: ProviderName = isProvider(fromSettings) ? fromSettings : isProvider(fromEnv) ? fromEnv : "gemini";
  if (primary === "none") return [];
  const fallbackEnv = process.env.AI_FALLBACK_PROVIDER;
  const fallback: ProviderName = isProvider(fallbackEnv) ? fallbackEnv : "groq";
  const chain = [primary];
  if (fallback !== primary && fallback !== "none") chain.push(fallback);
  return chain;
}

export async function usageToday(provider: string) {
  const rows = await db.aiUsage.findMany({ where: { day: today(), provider } });
  return rows.reduce((n, r) => n + r.requests, 0);
}

async function recordUsage(provider: string, role: AiRole, inTok: number, outTok: number, failed = false) {
  const [pi, po] = PRICING[provider] ?? [0, 0];
  const cost = (inTok * pi + outTok * po) / 1_000_000;
  await db.aiUsage.upsert({
    where: { day_provider_role: { day: today(), provider, role } },
    create: { day: today(), provider, role, requests: failed ? 0 : 1, failures: failed ? 1 : 0, inputTokens: inTok, outputTokens: outTok, estCostUsd: cost },
    update: {
      requests: { increment: failed ? 0 : 1 },
      failures: { increment: failed ? 1 : 0 },
      inputTokens: { increment: inTok },
      outputTokens: { increment: outTok },
      estCostUsd: { increment: cost },
    },
  });
}

async function pace(provider: string) {
  const gap = MIN_INTERVAL_MS[provider] ?? 1000;
  const last = lastCall.get(provider) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall.set(provider, Date.now());
}

/** Is any AI configured for this role (key present)? */
export async function aiAvailable(role: AiRole, userId?: string | null) {
  for (const p of await providerChain(role, userId)) if (await getKey(p, userId)) return true;
  return false;
}

export async function aiStatus(userId?: string | null) {
  const out: { role: AiRole; chain: { provider: ProviderName; hasKey: boolean; used: number; limit: number; cooling: boolean }[] }[] = [];
  for (const role of ["analysis", "writing"] as AiRole[]) {
    const chain = await providerChain(role, userId);
    out.push({
      role,
      chain: await Promise.all(
        chain.map(async (p) => ({
          provider: p,
          hasKey: !!(await getKey(p, userId)),
          used: await usageToday(p),
          limit: dailyLimit(p),
          cooling: getModels(p).every((m) => (cooldownUntil.get(`${p}:${m}`) ?? 0) > Date.now()),
        })),
      ),
    });
  }
  return out;
}

/**
 * Run an AI task. Returns {ok:false} (never throws) so callers can fall back
 * to rules/templates.
 */
export async function runAI<T = string>(opts: {
  role: AiRole;
  task: string;
  input: CallInput;
  userId?: string | null;
  cache?: boolean;
  parse?: (text: string) => T;
}): Promise<AiResult<T>> {
  const chain = await providerChain(opts.role, opts.userId);
  if (!chain.length) return { ok: false, reason: "AI is turned off for this task – using rules and templates.", off: true };
  const parse = opts.parse ?? ((t: string) => (opts.input.json ? extractJson<T>(t) : (t.trim() as unknown as T)));
  const cacheKey = hashKey(opts.role, opts.task, PROMPT_VERSION, opts.input.system, opts.input.prompt);

  if (opts.cache !== false) {
    const hit = await db.aiCache.findUnique({ where: { key: cacheKey } });
    if (hit) {
      try {
        return { ok: true, data: parse(hit.result), provider: hit.provider as ProviderName, cached: true };
      } catch {
        /* corrupt cache – ignore */
      }
    }
  }

  let lastReason = "No AI provider has an API key – using rules and templates.";
  let anyKey = false;
  let allLimited = true;
  for (const provider of chain) {
    const key = await getKey(provider, opts.userId);
    if (!key) continue;
    anyKey = true;
    if ((await usageToday(provider)) >= dailyLimit(provider)) {
      lastReason = `Daily AI limit reached for ${PROVIDER_INFO[provider].label} (${dailyLimit(provider)} requests).`;
      continue;
    }
    allLimited = false;
    let providerUsable = false;
    for (const model of getModels(provider)) {
      const modelKey = `${provider}:${model}`;
      if ((cooldownUntil.get(modelKey) ?? 0) > Date.now()) continue;
      providerUsable = true;
      let nextModel = false;
      for (let attempt = 0; attempt < 2 && !nextModel; attempt++) {
        try {
          await pace(provider);
          const out = await callProvider(provider, key, model, opts.input);
          await recordUsage(provider, opts.role, out.inputTokens, out.outputTokens);
          const data = parse(out.text);
          if (opts.cache !== false) {
            await db.aiCache.upsert({
              where: { key: cacheKey },
              create: { key: cacheKey, role: opts.role, provider, result: out.text },
              update: { result: out.text, provider },
            });
          }
          return { ok: true, data, provider, cached: false };
        } catch (err) {
          const status = err instanceof ProviderError ? err.status : 0;
          const timeout = (err as Error).name === "TimeoutError" || /aborted|timeout/i.test((err as Error).message);
          if (err instanceof RateLimitError || status === 503 || timeout) {
            // Busy, rate-limited or slow: rest this model and move on straight away
            await recordUsage(provider, opts.role, 0, 0, true);
            const wait = err instanceof RateLimitError ? (err.retryAfterSec ?? 60) : 120;
            cooldownUntil.set(modelKey, Date.now() + wait * 1000);
            lastReason = `${PROVIDER_INFO[provider].label} (${model}) is ${err instanceof RateLimitError ? "rate limited" : timeout ? "too slow right now" : "overloaded"} – trying the fallback.`;
            nextModel = true;
            break;
          }
          lastReason = `${PROVIDER_INFO[provider].label} error: ${(err as Error).message.slice(0, 160)}`;
          if (status >= 400 && status < 500) {
            await recordUsage(provider, opts.role, 0, 0, true);
            nextModel = true; // bad request / unknown model – try the next model, don't retry
            break;
          }
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); // backoff for network/5xx errors
        }
      }
    }
    if (!providerUsable) lastReason = `${PROVIDER_INFO[provider].label} is cooling down after a rate limit.`;
  }
  if (!anyKey) return { ok: false, reason: lastReason, off: true };
  return { ok: false, reason: lastReason, paused: allLimited };
}

export { extractJson };
