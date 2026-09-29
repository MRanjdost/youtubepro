import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { generateScriptWithProvider } from "./resolve";
import { ProviderError } from "../provider-errors";
import { VideoFormat, TargetAudience, CreatorPersona } from "@shared/schema";

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

describe("generateScriptWithProvider (custom provider path)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-script-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const validInput = {
    topic: "Camera comparison",
    format: VideoFormat.REVIEW,
    audience: TargetAudience.GENERAL,
    persona: CreatorPersona.NONE,
  };

  function makeValidResponse() {
    return JSON.stringify({
      titles: ["Compare lights", "Low light test", "Best cheap setup"],
      hook: "We tested two cameras in the dark.",
      structure: [
        { section: "Hook", purpose: "Confirm promise", evidenceClaimIds: [] },
        { section: "Body", purpose: "Compare", evidenceClaimIds: [] },
        { section: "Payoff", purpose: "Deliver", evidenceClaimIds: [] },
      ],
      script: "Hook: We tested two cameras in the dark.\nBody: Compare.\nPayoff: Choose.",
      payoff: "Choose the best.",
      primaryCta: "Subscribe.",
      studioValidation: "Validate with retention.",
    });
  }

  it("T1: custom provider mock with valid JSON fulfilling script contract → validated ScriptResult", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk-or-test"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk-or-test", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: makeValidResponse() } }] }) }) as any;
    try {
      const result = await generateScriptWithProvider(validInput);
      assert.strictEqual(typeof result.script, "string");
      assert.strictEqual(Array.isArray(result.titles), true);
      assert.strictEqual(result.titles!.length, 3);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T2: custom provider network failure → CUSTOM_TEXT_SCRIPT_GENERATION_PROVIDER_FAILURE", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://bad.example.com"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://bad.example.com", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    try {
      await generateScriptWithProvider(validInput);
      assert.fail("should throw");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_SCRIPT_GENERATION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("T3: custom provider malformed JSON → CUSTOM_TEXT_SCRIPT_GENERATION_INVALID", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }) as any;
    try {
      await generateScriptWithProvider(validInput);
      assert.fail("should throw");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "invalid_response");
      assert.strictEqual(err.code, "CUSTOM_TEXT_SCRIPT_GENERATION_INVALID");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
