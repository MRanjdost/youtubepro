import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { generateThumbnailWithProvider, resolveImageProvider } from "./resolve";
import { ProviderError } from "../provider-errors";
import { GeminiProvider } from "./gemini-provider";

let tempDir = "";
let prevEnvPath: string | undefined;
let savedFetch: typeof fetch | undefined;

function writeEnv(content: string) {
  writeFileSync(process.env.SETTINGS_ENV_PATH!, content, { encoding: "utf8", mode: 0o600 });
}

function setProcessEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function restoreFetch() {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
}

describe("resolveImageProvider (image provider path)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-thumb-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    restoreFetch();
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const config = {
    style: "bold" as const,
    mainText: "Compare",
    subText: "Test",
    textPosition: "bottom" as const,
    referenceImages: [] as { image: string; role: string }[],
  };

  it("T1: resolveImageProvider returns GeminiProvider when Gemini is configured", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    const res = resolveImageProvider();
    assert.strictEqual(res.provider.constructor.name, "GeminiProvider");
  });

  it("T2: generateThumbnailWithProvider throws GEMINI_IMAGE_GENERATION_PROVIDER_FAILURE when provider.generateImage throws (invalid SDK response, no image data)", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    savedFetch = globalThis.fetch;
    // Mock SDK-level fetch: returns GenAI candidate JSON but without inlineData (invalid image response)
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "no image data" }] } }],
      }),
    });
    try {
      await assert.rejects(
        generateThumbnailWithProvider("test", config as any),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError, "error must be a ProviderError");
          const pe = err as ProviderError;
          assert.strictEqual(pe.code, "GEMINI_IMAGE_GENERATION_PROVIDER_FAILURE");
          assert.strictEqual(pe.status, 502);
          assert.strictEqual(pe.category, "provider_server");
          assert.strictEqual(pe.retryable, true);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });

  it("T2b: generateThumbnailWithProvider maps a 'no image data' provider error to GEMINI_IMAGE_INVALID_RESPONSE (invalid_response, non-retryable)", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    const original = GeminiProvider.prototype.generateImage;
    GeminiProvider.prototype.generateImage = async function () {
      throw new Error("GeminiProvider.generateImage: response did not contain image data.");
    };
    try {
      await assert.rejects(
        generateThumbnailWithProvider("test", config as any),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError, "error must be a ProviderError");
          const pe = err as ProviderError;
          assert.strictEqual(pe.code, "GEMINI_IMAGE_INVALID_RESPONSE");
          assert.strictEqual(pe.status, 502);
          assert.strictEqual(pe.category, "invalid_response");
          assert.strictEqual(pe.retryable, false);
          return true;
        }
      );
    } finally {
      GeminiProvider.prototype.generateImage = original;
    }
  });

  it("T3: generateThumbnailWithProvider throws CUSTOM_IMAGE_GENERATION_PROVIDER_FAILURE with category network when openai-compatible image fetch fails", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_IMAGE_PROVIDER="openai-compatible"\nCUSTOM_IMAGE_BASE_URL="https://bad.example.com"\nCUSTOM_IMAGE_API_KEY="sk"\nCUSTOM_IMAGE_MODEL="img-model"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", CUSTOM_IMAGE_PROVIDER: "openai-compatible", CUSTOM_IMAGE_BASE_URL: "https://bad.example.com", CUSTOM_IMAGE_API_KEY: "sk", CUSTOM_IMAGE_MODEL: "img-model", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    try {
      await assert.rejects(
        generateThumbnailWithProvider("test", config as any),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError, "error must be a ProviderError");
          const pe = err as ProviderError;
          assert.strictEqual(pe.code, "CUSTOM_IMAGE_GENERATION_PROVIDER_FAILURE");
          assert.strictEqual(pe.status, 502);
          assert.strictEqual(pe.category, "network");
          assert.strictEqual(pe.retryable, true);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });
});
