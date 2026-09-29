/**
 * Unit tests for extractNarrationTextWithProvider in server/providers/resolve.ts
 *
 * Uses a mkdtemp isolated .env (SETTINGS_ENV_PATH) so they never touch
 * the real project .env file.
 */
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { extractNarrationTextWithProvider } from "./resolve";
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

describe("extractNarrationTextWithProvider (custom provider path)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-narration-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("custom provider mock returns valid plain text narration → trimmed string returned", async () => {
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
        json: async () => ({
          choices: [{ message: { content: "Welcome to this video. Today we explore AI tools." } }],
        }),
      }) as any;

    try {
      const result = await extractNarrationTextWithProvider("Hello world script");
      assert.strictEqual(result, "Welcome to this video. Today we explore AI tools.");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider network failure → CUSTOM_TEXT_NARRATION_EXTRACTION_PROVIDER_FAILURE", async () => {
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
      await extractNarrationTextWithProvider("test");
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as ProviderError;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_NARRATION_EXTRACTION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider returns [No narration content] sentinel → assert returned value is exactly '[No narration content]'", async () => {
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
        json: async () => ({
          choices: [{ message: { content: "[No narration content]" } }],
        }),
      }) as any;

    try {
      const result = await extractNarrationTextWithProvider("no speakable content");
      assert.strictEqual(result, "[No narration content]");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});