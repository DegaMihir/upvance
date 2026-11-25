import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { runAI, PROMPT_VERSION, today } from "@/lib/ai";
import { extractJson } from "@/lib/ai/providers";
import { hashKey } from "@/lib/text";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const input = { system: "sys", prompt: "analyse this job", json: true };

describe("AI layer", () => {
  it("returns a clean 'off' result when provider is none (app keeps working)", async () => {
    process.env.ANALYSIS_PROVIDER = "none";
    const r = await runAI({ role: "analysis", task: "t", input });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.off).toBe(true);
  });

  it("falls back to rules when no key is set", async () => {
    process.env.ANALYSIS_PROVIDER = "gemini";
    process.env.AI_FALLBACK_PROVIDER = "groq";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runAI({ role: "analysis", task: "t", input });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves cached results without calling the provider (same job never analysed twice)", async () => {
    process.env.ANALYSIS_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    const key = hashKey("analysis", "cache-test", PROMPT_VERSION, input.system, input.prompt);
    await db.aiCache.upsert({ where: { key }, create: { key, role: "analysis", provider: "gemini", result: '{"x":1}' }, update: {} });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runAI<{ x: number }>({ role: "analysis", task: "cache-test", input });
    expect(r.ok && r.cached && r.data.x === 1).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pauses gracefully when the daily limit is reached", async () => {
    process.env.ANALYSIS_PROVIDER = "gemini";
    process.env.AI_FALLBACK_PROVIDER = "none";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.AI_DAILY_LIMIT = "2";
    await db.aiUsage.upsert({
      where: { day_provider_role: { day: today(), provider: "gemini", role: "writing" } },
      create: { day: today(), provider: "gemini", role: "writing", requests: 2 },
      update: { requests: 2 },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runAI({ role: "analysis", task: "limit", input: { ...input, prompt: "new prompt" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.paused).toBe(true);
      expect(r.reason).toMatch(/Daily AI limit reached/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("switches to the fallback provider on a rate limit", async () => {
    process.env.ANALYSIS_PROVIDER = "gemini";
    process.env.AI_FALLBACK_PROVIDER = "groq";
    process.env.GEMINI_API_KEY = "g";
    process.env.GROQ_API_KEY = "q";
    process.env.AI_DAILY_LIMIT = "1000";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("generativelanguage")) return new Response("quota", { status: 429 });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    });
    const r = await runAI<{ ok: boolean }>({ role: "analysis", task: "fallback", input: { ...input, prompt: `fallback ${Date.now()}` } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("groq");
    expect(fetchSpy).toHaveBeenCalledTimes(3); // gemini main model, gemini fallback model, then groq
    expect(String(fetchSpy.mock.calls[2][0])).toContain("groq");
  });

  it("parses JSON from chatty replies", () => {
    expect(extractJson<{ a: number }>('Sure!\n```json\n{"a": 2}\n```')).toEqual({ a: 2 });
  });
});

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("my-app-password");
    expect(enc).not.toContain("my-app-password");
    expect(decryptSecret(enc)).toBe("my-app-password");
    expect(decryptSecret(enc.replace(/.$/, "A"))).toBeNull();
  });
});
