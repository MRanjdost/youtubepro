import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { generateIdeasWithProvider } from "./resolve";
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

describe("generateIdeasWithProvider (custom provider path)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-ideas-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const validResponse = JSON.stringify({
    ideas: Array.from({ length: 6 }, (_, i) => ({
      title: `Idea ${i}`,
      description: "Test",
      keywords: ["kw"],
      format: "Tutorial/How-to",
      difficulty: "Easy",
      honestPromise: "Promise",
      discoverySurface: "search",
      payoff: "Payoff",
      thumbnailConcept: "Thumb",
      studioMetric: "Metric",
      experimentRule: "Rule",
      evidenceClaims: [{
        id: "c1",
        claim: "Claim",
        evidenceClass: "observed",
        sourceVideoIds: ["v1"],
        confidence: "high",
        limitations: ["lim"],
        snapshotId: "snap-abc-1234",
      }],
    })),
  });

  it("T1: custom provider mock with valid JSON adhering to evidence contract → validated ideas object", async () => {
    writeEnv(
      `GEMINI_API_KEY="dummy"\n` +
      `CUSTOM_TEXT_PROVIDER="openai-compatible"\n` +
      `CUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\n` +
      `CUSTOM_TEXT_API_KEY="sk-or-test-12345678"\n` +
      `CUSTOM_TEXT_MODEL="m"\n`
    );
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1",
      CUSTOM_TEXT_API_KEY: "sk-or-test-12345678",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: validResponse } }] }),
      }) as any;

    try {
      const result = await generateIdeasWithProvider({
        niche: "test niche",
        keywords: "test",
        audience: "general",
        researchContext: {
          query: "q",
          snapshotId: "snap-abc-1234",
          sourceVideoIds: ["v1"],
          evidenceClaims: [{
            id: "c1",
            claim: "Claim",
            evidenceClass: "observed",
            sourceVideoIds: ["v1"],
            confidence: "high",
            limitations: ["lim"],
            snapshotId: "snap-abc-1234",
          }],
        },
      });
      assert.strictEqual(result.ideas.length, 6);
      assert.strictEqual(result.niche, "test niche");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T2: custom provider network failure → CUSTOM_TEXT_IDEA_GENERATION_PROVIDER_FAILURE", async () => {
    writeEnv(
      `GEMINI_API_KEY="dummy"\n` +
      `CUSTOM_TEXT_PROVIDER="openai-compatible"\n` +
      `CUSTOM_TEXT_BASE_URL="https://bad.example.com"\n` +
      `CUSTOM_TEXT_API_KEY="sk-or-test-12345678"\n` +
      `CUSTOM_TEXT_MODEL="m"\n`
    );
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://bad.example.com",
      CUSTOM_TEXT_API_KEY: "sk-or-test-12345678",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };

    try {
      await generateIdeasWithProvider({
        niche: "n",
        keywords: "",
        audience: "",
        researchContext: {
          query: "q",
          snapshotId: "snap-abc-1234",
          sourceVideoIds: ["v1"],
          evidenceClaims: [{
            id: "c1",
            claim: "C",
            evidenceClass: "observed",
            sourceVideoIds: ["v1"],
            confidence: "high",
            limitations: ["l"],
            snapshotId: "snap-abc-1234",
          }],
        },
      });
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_IDEA_GENERATION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T3: custom provider malformed JSON violating evidence contract → CUSTOM_TEXT_IDEA_GENERATION_INVALID", async () => {
    writeEnv(
      `GEMINI_API_KEY="dummy"\n` +
      `CUSTOM_TEXT_PROVIDER="openai-compatible"\n` +
      `CUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\n` +
      `CUSTOM_TEXT_API_KEY="sk-or-test-12345678"\n` +
      `CUSTOM_TEXT_MODEL="m"\n`
    );
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1",
      CUSTOM_TEXT_API_KEY: "sk-or-test-12345678",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "not json" } }] }),
      }) as any;

    try {
      await generateIdeasWithProvider({
        niche: "n",
        keywords: "",
        audience: "",
        researchContext: {
          query: "q",
          snapshotId: "snap-abc-1234",
          sourceVideoIds: ["v1"],
          evidenceClaims: [{
            id: "c1",
            claim: "C",
            evidenceClass: "observed",
            sourceVideoIds: ["v1"],
            confidence: "high",
            limitations: ["l"],
            snapshotId: "snap-abc-1234",
          }],
        },
      });
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "invalid_response");
      assert.strictEqual(err.code, "CUSTOM_TEXT_IDEA_GENERATION_INVALID");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
