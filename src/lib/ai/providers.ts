/**
 * Thin, dependency-free clients for each AI provider.
 * Keys are read from .env (or from encrypted Settings) – never hard-coded or logged.
 */
export const PROVIDERS = ["gemini", "groq", "openrouter", "anthropic", "none"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<ProviderName, { label: string; free: boolean; keyVar: string; modelVar: string; defaultModel: string; trainingNotice: boolean }> = {
  gemini: { label: "Google Gemini (Flash, free tier)", free: true, keyVar: "GEMINI_API_KEY", modelVar: "GEMINI_MODEL", defaultModel: "gemini-flash-latest", trainingNotice: true },
  groq: { label: "Groq (free tier)", free: true, keyVar: "GROQ_API_KEY", modelVar: "GROQ_MODEL", defaultModel: "openai/gpt-oss-120b", trainingNotice: true },
  openrouter: { label: "OpenRouter", free: false, keyVar: "OPENROUTER_API_KEY", modelVar: "OPENROUTER_MODEL", defaultModel: "meta-llama/llama-3.3-70b-instruct:free", trainingNotice: true },
  anthropic: { label: "Anthropic Claude (paid)", free: false, keyVar: "ANTHROPIC_API_KEY", modelVar: "ANTHROPIC_MODEL", defaultModel: "claude-haiku-5-5", trainingNotice: false },
  none: { label: "None (rules & templates only)", free: true, keyVar: "", modelVar: "", defaultModel: "", trainingNotice: false },
};

/** Rough USD per 1M tokens [input, output] – estimates only, used for the usage panel. */
export const PRICING: Record<string, [number, number]> = {
  anthropic: [1, 5],
  openrouter: [0, 0], // ":free" models; paid models vary – shown as estimate 0
  gemini: [0, 0],
  groq: [0, 0],
};

export class RateLimitError extends Error {
  constructor(public provider: string, public retryAfterSec?: number) {
    super(`${provider} rate limit reached`);
  }
}
export class ProviderError extends Error {
  constructor(public provider: string, public status: number, message: string) {
    super(message);
  }
}

export interface CallInput {
  system: string;
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}
export interface CallOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

function retryAfter(res: Response) {
  const v = res.headers.get("retry-after");
  return v ? Number(v) || undefined : undefined;
}

async function readError(res: Response) {
  try {
    const t = await res.text();
    // Strip anything that could contain a key echo; keep the message short
    return t.replace(/key=[^&\s"]+/gi, "key=***").slice(0, 300);
  } catch {
    return res.statusText;
  }
}

export async function callProvider(provider: ProviderName, apiKey: string, model: string, input: CallInput): Promise<CallOutput> {
  const signal = AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 30_000);
  const maxTokens = input.maxTokens ?? 2048;
  const temperature = input.temperature ?? 0.3;

  if (provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: Math.max(maxTokens, 4096),
          ...(input.json ? { responseMimeType: "application/json" } : {}),
          // Extraction/writing tasks don't need deep reasoning: keep "thinking" low for speed & quota
          ...(/gemini-(3|flash-latest)/.test(model) && !/lite/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
    });
    if (res.status === 503) throw new ProviderError(provider, 503, "Model overloaded");
    if (res.status === 429) throw new RateLimitError(provider, retryAfter(res));
    if (!res.ok) throw new ProviderError(provider, res.status, await readError(res));
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!text) throw new ProviderError(provider, 502, "Empty response from Gemini");
    return { text, inputTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0, model };
  }

  if (provider === "groq" || provider === "openrouter") {
    const url = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter" ? { "X-Title": "Local job assistant" } : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: Math.max(maxTokens, 4096),
        ...(input.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      }),
    });
    if (res.status === 429) throw new RateLimitError(provider, retryAfter(res));
    if (!res.ok) throw new ProviderError(provider, res.status, await readError(res));
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = j.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError(provider, 502, "Empty response");
    return { text, inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0, model };
  }

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: input.system + (input.json ? "\nRespond with a single JSON object only." : ""),
        messages: [{ role: "user", content: input.prompt }],
      }),
    });
    if (res.status === 429 || res.status === 529) throw new RateLimitError(provider, retryAfter(res));
    if (!res.ok) throw new ProviderError(provider, res.status, await readError(res));
    const j = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0, model };
  }

  throw new ProviderError(provider, 400, "AI provider is set to none");
}

/** Pull a JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("No JSON in AI response");
  return JSON.parse(body.slice(start, end + 1)) as T;
}
