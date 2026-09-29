import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { generateResearchInsightsWithProvider } from "./resolve";
import { ProviderError } from "../provider-errors";

let tempDir = "";
let prevEnvPath: string | undefined;

function writeEnv(content: string) {
  writeFileSync(process.env.SETTINGS_ENV_PATH!, content, { encoding: "utf8", mode: 0o600 });
}

function setProcessEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("generateResearchInsightsWithProvider (custom provider path)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-research-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const validRequest = {
    query: "test query",
    videos: [{
      id: "v1", title: "T", channelTitle: "C", publishedAt: "2024-01-01",
      duration: "PT1M", viewCount: 100, likeCount: 10, commentCount: 5,
      description: "D", tags: ["t"],
      channelStatistics: { subscriberCount: 10, country: "US", description: "desc", topicCategories: ["top"], publishedAt: "2024-01-01" },
      hasCaptions: false, definition: "sd", defaultAudioLanguage: "en",
      topicCategories: ["cat"], hasPaidProductPlacement: false,
      liveBroadcastContent: "none", liveStreamingDetails: {},
    }],
    snapshotId: "snap-abc-1234",
    provenance: { orderedVideoIds: ["v1"] },
    analytics: {},
    enrichment: {},
    warnings: [],
    retrievedAt: new Date().toISOString(),
  };

  const makeValidResponse = () => JSON.stringify({
    summary: "Pattern found.",
    queryIntent: { primaryIntent: "Learn", viewerNeed: "Know", discoverySurface: "Search", credibilityNote: "Standard" },
    evidenceSignals: { observed: ["A", "B", "C"], inferred: ["A", "B", "C"], requiresStudio: ["Q1", "Q2", "Q3"] },
    evidenceClaims: [
      { id: "c1", claim: "Claim 1", evidenceClass: "observed", sourceVideoIds: ["v1"], confidence: "high", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c2", claim: "Claim 2", evidenceClass: "inferred", sourceVideoIds: [], confidence: "medium", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c3", claim: "Claim 3", evidenceClass: "requires_studio", sourceVideoIds: [], confidence: "low", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c4", claim: "Claim 4", evidenceClass: "observed", sourceVideoIds: ["v1"], confidence: "high", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c5", claim: "Claim 5", evidenceClass: "inferred", sourceVideoIds: [], confidence: "medium", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c6", claim: "Claim 6", evidenceClass: "requires_studio", sourceVideoIds: [], confidence: "low", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c7", claim: "Claim 7", evidenceClass: "observed", sourceVideoIds: ["v1"], confidence: "high", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c8", claim: "Claim 8", evidenceClass: "inferred", sourceVideoIds: [], confidence: "medium", limitations: ["l"], snapshotId: "snap-abc-1234" },
      { id: "c9", claim: "Claim 9", evidenceClass: "requires_studio", sourceVideoIds: [], confidence: "low", limitations: ["l"], snapshotId: "snap-abc-1234" },
    ],
    peopleAlsoAsk: [{ question: "Q1?", answer: "A1." }, { question: "Q2?", answer: "A2." }, { question: "Q3?", answer: "A3." }, { question: "Q4?", answer: "A4." }, { question: "Q5?", answer: "A5." }, { question: "Q6?", answer: "A6." }],
    targetAudience: { primaryDemographic: "General", ageRange: "18-34", interests: ["A", "B", "C", "D"], painPoints: ["P1", "P2", "P3"], contentPreferences: ["Pref1", "Pref2", "Pref3"] },
    nicheAnalysis: { competitionLevel: "Medium", growthTrend: "Stable", bestPostingTimes: ["UTC 10:00"], recommendedFormats: ["Short", "Tutorial"], monetizationPotential: "Moderate" },
    contentGaps: ["Gap 1", "Gap 2", "Gap 3", "Gap 4"],
    trendingSubtopics: ["T1", "T2", "T3", "T4", "T5"],
    recommendedActions: [{ title: "A1", rationale: "R1", format: "Video" }, { title: "A2", rationale: "R2", format: "Video" }, { title: "A3", rationale: "R3", format: "Video" }],
    methodology: { sampleSize: 1, basis: "Public snapshot", limitations: ["Limited"] },
  });

  it("T1: custom provider mock with valid JSON adhering to evidence contract → validated ResearchInsightsResponse", async () => {
    writeEnv(`GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk-or-test-12345678"\nCUSTOM_TEXT_MODEL="m"\n`);
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk-or-test-12345678", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: makeValidResponse() } }] }) }) as any;
    try {
      const result = await generateResearchInsightsWithProvider(validRequest as any);
      assert.strictEqual(result.summary, "Pattern found.");
      assert.strictEqual(result.methodology.sampleSize, 1);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T2: custom provider network failure → CUSTOM_TEXT_RESEARCH_INSIGHTS_PROVIDER_FAILURE", async () => {
    writeEnv(`GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://bad.example.com"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n`);
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://bad.example.com", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("down"); };
    try {
      await generateResearchInsightsWithProvider(validRequest as any);
      assert.fail("should throw");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_RESEARCH_INSIGHTS_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T3: custom provider malformed JSON violating contract → CUSTOM_TEXT_RESEARCH_INSIGHTS_INVALID", async () => {
    writeEnv(`GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n`);
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "bad" } }] }) }) as any;
    try {
      await generateResearchInsightsWithProvider(validRequest as any);
      assert.fail("should throw");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "invalid_response");
      assert.strictEqual(err.code, "CUSTOM_TEXT_RESEARCH_INSIGHTS_INVALID");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});