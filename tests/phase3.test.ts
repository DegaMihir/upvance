import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { applicationsCsv, distributions, funnel, responseRateTrend, scoreVsResponse, timeToResponse } from "@/lib/analytics";
import { applySuggestion, refreshSuggestions, suggestWeights } from "@/lib/insights";
import { parseJson } from "@/lib/utils";

let userId: string;
beforeAll(async () => {
  ({ userId } = await seedDemo());
});

describe("advanced analytics", () => {
  it("funnel is monotonic where it should be and counts outcomes", async () => {
    const f = await funnel(userId);
    const v = Object.fromEntries(f.map((s) => [s.label, s.value]));
    expect(v["Jobs discovered"]).toBeGreaterThanOrEqual(v["Eligible matches"]);
    expect(v["Eligible matches"]).toBeGreaterThanOrEqual(v["Good+ matches"]);
    expect(v["Submitted"]).toBe(12);
    expect(v["Responses"]).toBe(4); // recruiter response, assessment, interview, offer
    expect(v["Interviews"]).toBe(2); // interview + offer
    expect(v["Offers"]).toBe(1);
  });

  it("response-rate trend ends at the overall rate", async () => {
    const t = await responseRateTrend(userId, 10);
    expect(t).toHaveLength(10);
    expect(t[t.length - 1].rate).toBe(Math.round((4 / 12) * 100));
    expect(t[0].submitted).toBeLessThanOrEqual(t[t.length - 1].submitted);
  });

  it("time to response uses outcome events", async () => {
    const r = await timeToResponse(userId);
    expect(r.count).toBeGreaterThan(0);
    expect(r.median).toBe(6); // demo outcomes arrive 6 days after submission
  });

  it("score bands and distributions add up", async () => {
    const svr = await scoreVsResponse(userId);
    expect(svr.reduce((n, r) => n + r.applied, 0)).toBe(12);
    const d = await distributions(userId);
    const total = d.sponsorship.reduce((n, x) => n + x.value, 0);
    expect(total).toBe(d.remote.reduce((n, x) => n + x.value, 0));
    expect(d.sponsorship.map((x) => x.label)).toEqual(expect.arrayContaining(["Confirmed", "No Sponsorship", "Unknown"]));
  });

  it("exports applications as CSV with escaping", async () => {
    const csv = await applicationsCsv(userId);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("created,submitted,status,company,title,location,sponsorship,remote,resume_profile,origin,apply_url");
    expect(lines).toHaveLength(13);
    expect(csv).toContain('"London, United Kingdom"');
  });
});

describe("continuous optimisation", () => {
  it("suggests weight changes only with enough data, and applying them is explicit", async () => {
    const w = await suggestWeights(userId);
    if (w) {
      expect(w.kind).toBe("weights");
      const total = Object.values(w.payload.weights as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(90);
    }
    const before = (await db.userSettings.findUniqueOrThrow({ where: { userId } })).scoringWeights;
    await refreshSuggestions(userId);
    const open = await db.suggestion.findMany({ where: { userId, status: "open" } });
    // nothing changes until the user applies a suggestion
    expect((await db.userSettings.findUniqueOrThrow({ where: { userId } })).scoringWeights).toBe(before);
    // refreshing again doesn't duplicate suggestions
    await refreshSuggestions(userId);
    expect(await db.suggestion.count({ where: { userId, status: "open" } })).toBe(open.length);

    const weights = open.find((s) => s.kind === "weights");
    if (weights) {
      await applySuggestion(userId, weights.id);
      const after = parseJson<Record<string, number>>((await db.userSettings.findUniqueOrThrow({ where: { userId } })).scoringWeights, {});
      expect(after).toEqual(parseJson(weights.payload, {} as { weights: Record<string, number> }).weights);
    }
    const search = open.find((s) => s.kind === "search" && s.payload.includes("includeKeywords"));
    if (search) {
      const n = await db.savedSearch.count({ where: { userId } });
      await applySuggestion(userId, search.id);
      const created = await db.savedSearch.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
      expect(await db.savedSearch.count({ where: { userId } })).toBe(n + 1);
      expect(created.enabled).toBe(false); // created paused for review
    }
  });
});
