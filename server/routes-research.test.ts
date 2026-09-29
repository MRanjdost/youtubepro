import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import supertest from "supertest";
import { createAppWithRoutes } from "./test-app";
import { resetRateLimit } from "./rate-limit";

let tempDir = "";
let prevEnvPath: string | undefined;
let app: any;

function writeEnv(content: string) {
  writeFileSync(process.env.SETTINGS_ENV_PATH!, content, { encoding: "utf8", mode: 0o600 });
}

function setProcessEnv(kv: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(kv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Matches researchInsightsRequestSchema exactly */
function validRequest(snapshotId = "snap-abc-1234", videoIds = ["v1"]) {
  return {
    query: "test query",
    videos: videoIds.map((id) => ({
      id,
      title: "Test Video Title",
      channelTitle: "Test Channel",
      channelId: "channel-test-1",
      publishedAt: "2024-01-01T00:00:00.000Z",
      thumbnailUrl: "https://example.com/thumb.jpg",
      description: "A test video description.",
      viewCount: 1000,
      likeCount: 50,
      commentCount: 10,
      duration: "PT1M",
      tags: ["test", "sample"],
      hasCaptions: true,
      definition: "hd",
      defaultAudioLanguage: "en",
      topicCategories: [],
      hasPaidProductPlacement: false,
      liveBroadcastContent: "none",
      liveStreamingDetails: {},
      channelStatistics: { subscriberCount: 5000, hiddenSubscriberCount: false, country: "US", description: "Test channel", thumbnailUrl: "https://example.com/ch.jpg", publishedAt: "2020-01-01T00:00:00.000Z" },
    })),
    snapshotId,
    retrievedAt: "2024-01-01T00:00:00.000Z",
    provenance: {
      provider: "youtube-data-api-v3" as const,
      query: "test query",
      filters: {
        uploadDate: "any" as const,
        duration: "any" as const,
        sortBy: "relevance" as const,
        maxResults: 25,
      },
      orderedVideoIds: videoIds,
    },
    analytics: {
      totalVideos: videoIds.length,
      totalViews: 1000,
      avgViews: 1000,
      medianViews: 1000,
      medianDailyViews: 100,
      avgEngagement: 0.05,
      uniqueChannels: 1,
      durationData: [],
      recencyData: [],
      topTags: [{ label: "test", count: 1 }],
      coverage: { views: 100, engagement: 80, subscribers: 60, captions: 50, tags: 70, hd: 90 },
    },
    enrichment: {
      search: { status: "complete" as const, requested: 25, returned: videoIds.length },
      videoDetails: { status: "complete" as const, requested: videoIds.length, returned: videoIds.length },
      channels: { status: "complete" as const, requested: 1, returned: 1 },
    },
    warnings: [],
  };
}

function makeValidResponse(snapshotId = "snap-abc-1234") {
  return JSON.stringify({
    summary: "The sample shows a clear review intent. Test one focused comparison.",
    queryIntent: {
      primaryIntent: "Compare cameras",
      viewerNeed: "Choose a camera",
      discoverySurface: "Search, based on the explicit comparison query",
      credibilityNote: "Demonstrate the tested setup",
    },
    evidenceSignals: {
      observed: ["Observed one", "Observed two", "Observed three"],
      inferred: ["Inference one", "Inference two", "Inference three"],
      requiresStudio: ["Studio one", "Studio two", "Studio three"],
    },
    evidenceClaims: Array.from({ length: 9 }, (_, index) => ({
      id: `claim-${index + 1}`,
      claim: `Evidence claim ${index + 1}`,
      evidenceClass: index < 3 ? "observed" : index < 6 ? "inferred" : "requires_studio",
      sourceVideoIds: index < 3 ? ["v1"] : [],
      confidence: index < 3 ? "high" : "medium",
      limitations: ["Limited to this public snapshot."],
      snapshotId,
    })),
    peopleAlsoAsk: Array.from({ length: 6 }, (_, index) => ({
      question: `Question ${index + 1}?`,
      answer: `Answer ${index + 1}`,
    })),
    targetAudience: {
      primaryDemographic: "Inferred camera buyers",
      ageRange: "Insufficient evidence",
      interests: ["Cameras"],
      painPoints: ["Comparing specifications"],
      contentPreferences: ["Direct demonstrations"],
    },
    nicheAnalysis: {
      competitionLevel: "Medium sample signal",
      growthTrend: "Insufficient evidence",
      bestPostingTimes: ["Insufficient evidence from this snapshot"],
      recommendedFormats: ["Comparison"],
      monetizationPotential: "Commercial-intent hypothesis only",
    },
    contentGaps: ["A controlled low-light comparison"],
    trendingSubtopics: ["Low-light video"],
    recommendedActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Experiment ${index + 1}`,
      rationale: "Validate the hypothesis with Studio impressions and retention.",
      format: "Comparison",
    })),
    methodology: {
      sampleSize: 1,
      basis: "Public YouTube Data API search-result metadata snapshot",
      limitations: ["Missing owner-only Analytics metrics"],
    },
  });
}

describe("POST /api/research/insights (integration via supertest + mkdtemp .env)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-http-research-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });
  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("H1: custom provider mock with valid JSON -> 200", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk-or-test-12345678"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1",
      CUSTOM_TEXT_API_KEY: "sk-or-test-12345678",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    const content = makeValidResponse();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    });

    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app)
        .post("/api/research/insights")
        .send(validRequest())
        .expect(200);
      assert.strictEqual(typeof res.body.summary, "string");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H2: custom provider network failure -> 502", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://bad.example.com"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://bad.example.com",
      CUSTOM_TEXT_API_KEY: "sk",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };

    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app)
        .post("/api/research/insights")
        .send(validRequest())
        .expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_TEXT_RESEARCH_INSIGHTS_PROVIDER_FAILURE");
      assert.strictEqual(res.body.category, "provider_server");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H3: custom provider malformed JSON -> 502 INVALID", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1",
      CUSTOM_TEXT_API_KEY: "sk",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "totally invalid not json" } }] }),
    });

    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app)
        .post("/api/research/insights")
        .send(validRequest())
        .expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_TEXT_RESEARCH_INSIGHTS_INVALID");
      assert.strictEqual(res.body.category, "invalid_response");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
