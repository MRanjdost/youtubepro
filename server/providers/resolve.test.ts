/**
 * Unit tests for server/providers/resolve.ts
 *
 * All tests use a mkdtemp isolated .env (SETTINGS_ENV_PATH) so they never
 * touch the real project .env file.
 */
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { resolveTextProvider, generateThumbnailSuggestionsWithProvider, regenerateTitlesWithProvider, regenerateScriptContentWithProvider } from "./resolve";
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

describe("resolveTextProvider", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-resolve-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) {
      delete process.env.SETTINGS_ENV_PATH;
    } else {
      process.env.SETTINGS_ENV_PATH = prevEnvPath;
    }
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("returns gemini provider with correct model when customTextProvider is not set", () => {
    writeEnv(`GEMINI_API_KEY="AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000"\nGEMINI_TEXT_MODEL="gemini-3.7-flash"\n`);
    setProcessEnv({
      GEMINI_API_KEY: "AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: undefined,
      CUSTOM_TEXT_BASE_URL: undefined,
      CUSTOM_TEXT_API_KEY: undefined,
      CUSTOM_TEXT_MODEL: undefined,
    });

    const result = resolveTextProvider();
    assert.strictEqual(result.model, "gemini-3.7-flash");
    assert.strictEqual(typeof result.provider.generate, "function");
  });

  it("returns gemini provider when customTextProvider=gemini", () => {
    writeEnv(`GEMINI_API_KEY="AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000"\nGEMINI_TEXT_MODEL="gemini-3.7-flash"\nCUSTOM_TEXT_PROVIDER="gemini"\n`);
    setProcessEnv({
      GEMINI_API_KEY: "AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "gemini",
    });

    const result = resolveTextProvider();
    assert.strictEqual(result.model, "gemini-3.7-flash");
    assert.strictEqual(typeof result.provider.generate, "function");
  });

  it("returns openai-compatible provider with correct baseUrl/apiKey/model", () => {
    writeEnv(
      `GEMINI_API_KEY="dummy"\n` +
      `CUSTOM_TEXT_PROVIDER="openai-compatible"\n` +
      `CUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\n` +
      `CUSTOM_TEXT_API_KEY="sk-or-testkey-1234567890abcdef"\n` +
      `CUSTOM_TEXT_MODEL="anthropic/claude-3-5-sonnet"\n`
    );
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1",
      CUSTOM_TEXT_API_KEY: "sk-or-testkey-1234567890abcdef",
      CUSTOM_TEXT_MODEL: "anthropic/claude-3-5-sonnet",
    });

    const result = resolveTextProvider();
    assert.strictEqual(result.model, "anthropic/claude-3-5-sonnet");
    assert.strictEqual(typeof result.provider.generate, "function");
  });

  it("throws clear error when custom provider=openai-compatible but baseUrl is missing", () => {
    writeEnv(`CUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_API_KEY="sk-test"\n`);
    setProcessEnv({
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_API_KEY: "sk-test",
      CUSTOM_TEXT_BASE_URL: undefined,
    });

    assert.throws(
      () => resolveTextProvider(),
      /Custom text base URL is required/,
    );
  });

  it("throws when custom provider=openai-compatible but apiKey is missing", () => {
    writeEnv(`CUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://example.com"\n`);
    setProcessEnv({
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://example.com",
      CUSTOM_TEXT_API_KEY: undefined,
    });

    assert.throws(
      () => resolveTextProvider(),
      /Custom text API key is required/,
    );
  });
});

// ─── generateThumbnailSuggestionsWithProvider ─────────────────────────────────

describe("generateThumbnailSuggestionsWithProvider", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-resolve2-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) {
      delete process.env.SETTINGS_ENV_PATH;
    } else {
      process.env.SETTINGS_ENV_PATH = prevEnvPath;
    }
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("mock fetch returns valid JSON → parsed string[] without falling back to Gemini", async () => {
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
          choices: [{ message: { content: JSON.stringify(["thumb1", "thumb2", "thumb3", "thumb4", "thumb5"]) } }],
        }),
      }) as any;

    try {
      const result = await generateThumbnailSuggestionsWithProvider({ topic: "cooking tips" });
      assert.deepStrictEqual(result, ["thumb1", "thumb2", "thumb3", "thumb4", "thumb5"]);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("mock fetch returns non-JSON content → ProviderError (category=invalid_response, status=502)", async () => {
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
        json: async () => ({ choices: [{ message: { content: "not-json-at-all" } }] }),
      }) as any;

    try {
      await generateThumbnailSuggestionsWithProvider({ topic: "test" });
      assert.fail("should have thrown ProviderError");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.category, "invalid_response");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.code, "CUSTOM_TEXT_THUMBNAIL_SUGGESTIONS_INVALID");
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("mock fetch throws (network failure) → ProviderError (category=provider_server, status=502, code=CUSTOM_TEXT_THUMBNAIL_SUGGESTIONS_PROVIDER_FAILURE)", async () => {
    writeEnv(
      `GEMINI_API_KEY="dummy"\n` +
      `CUSTOM_TEXT_PROVIDER="openai-compatible"\n` +
      `CUSTOM_TEXT_BASE_URL="https://unreachable.example.com"\n` +
      `CUSTOM_TEXT_API_KEY="sk-or-test-12345678"\n` +
      `CUSTOM_TEXT_MODEL="m"\n`
    );
    setProcessEnv({
      GEMINI_API_KEY: "dummy",
      GEMINI_TEXT_MODEL: "gemini-3.7-flash",
      CUSTOM_TEXT_PROVIDER: "openai-compatible",
      CUSTOM_TEXT_BASE_URL: "https://unreachable.example.com",
      CUSTOM_TEXT_API_KEY: "sk-or-test-12345678",
      CUSTOM_TEXT_MODEL: "m",
    });

    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network failure simulated");
    };

    try {
      await generateThumbnailSuggestionsWithProvider({ topic: "test" });
      assert.fail("should have thrown ProviderError");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.code, "CUSTOM_TEXT_THUMBNAIL_SUGGESTIONS_PROVIDER_FAILURE");
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

// ─── regenerateTitlesWithProvider ─────────────────────────────────

describe("regenerateTitlesWithProvider", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-resolve-titles-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("custom provider mock returns 5 valid titles → parsed string[]", async () => {
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
          choices: [{ message: { content: JSON.stringify({ titles: ["T1", "T2", "T3", "T4", "T5"] }) } }],
        }),
      }) as any;

    try {
      const result = await regenerateTitlesWithProvider({
        topic: "AI tools",
        format: "Long-form Video (8-15 min)" as any,
        audience: "General Audience" as any,
      });
      assert.strictEqual(result.length, 5);
      assert.deepStrictEqual(result, ["T1", "T2", "T3", "T4", "T5"]);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider invalid JSON → CUSTOM_TEXT_TITLE_REGENERATION_INVALID (not GEMINI)", async () => {
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
        json: async () => ({ choices: [{ message: { content: "not-json" } }] }),
      }) as any;

    try {
      await regenerateTitlesWithProvider({
        topic: "bad",
        format: "YouTube Short (< 60 sec)" as any,
        audience: "General Audience" as any,
      });
      assert.fail("should have thrown ProviderError");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.code, "CUSTOM_TEXT_TITLE_REGENERATION_INVALID");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider network failure → CUSTOM_TEXT_TITLE_REGENERATION_PROVIDER_FAILURE", async () => {
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
    globalThis.fetch = async () => {
      throw new Error("network down");
    };

    try {
      await regenerateTitlesWithProvider({
        topic: "fail",
        format: "Long-form Video (8-15 min)" as any,
        audience: "General Audience" as any,
      });
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_TITLE_REGENERATION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

// ─── regenerateScriptContentWithProvider ─────────────────────────────────

describe("regenerateScriptContentWithProvider (section endpoint)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-resolve-section-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("custom provider mock returns valid JSON → parsed ScriptRegenerationOutput", async () => {
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
          choices: [{
            message: {
              content: JSON.stringify({
                content: "Rewritten section content",
                evidenceClaimIds: [],
              }),
            },
          }],
        }),
      }) as any;

    try {
      const result = await regenerateScriptContentWithProvider({ prompt: "rewrite section" }, "section");
      assert.strictEqual(result.content, "Rewritten section content");
      assert.deepStrictEqual(result.evidenceClaimIds, []);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider invalid JSON → CUSTOM_TEXT_SECTION_REGENERATION_INVALID", async () => {
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
        json: async () => ({ choices: [{ message: { content: "not-json" } }] }),
      }) as any;

    try {
      await regenerateScriptContentWithProvider({ prompt: "x" }, "section");
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.code, "CUSTOM_TEXT_SECTION_REGENERATION_INVALID");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider network failure → CUSTOM_TEXT_SECTION_REGENERATION_PROVIDER_FAILURE", async () => {
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
      await regenerateScriptContentWithProvider({ prompt: "x" }, "section");
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.category, "provider_server");
      assert.strictEqual(err.code, "CUSTOM_TEXT_SECTION_REGENERATION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

describe("regenerateScriptContentWithProvider (paragraph endpoint)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-resolve-paragraph-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("custom provider valid mock → 200 with { content, evidenceClaimIds: [] }", async () => {
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
          choices: [{ message: { content: JSON.stringify({ content: "P", evidenceClaimIds: [] }) } }],
        }),
      }) as any;

    try {
      const result = await regenerateScriptContentWithProvider({ prompt: "x" }, "paragraph");
      assert.strictEqual(result.content, "P");
      assert.deepStrictEqual(result.evidenceClaimIds, []);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider invalid JSON → CUSTOM_TEXT_PARAGRAPH_REGENERATION_INVALID", async () => {
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
      ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "garbage" } }] }) }) as any;

    try {
      await regenerateScriptContentWithProvider({ prompt: "x" }, "paragraph");
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.code, "CUSTOM_TEXT_PARAGRAPH_REGENERATION_INVALID");
      assert.strictEqual(err.status, 502);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("custom provider network failure → CUSTOM_TEXT_PARAGRAPH_REGENERATION_PROVIDER_FAILURE", async () => {
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
    globalThis.fetch = async () => { throw new Error("net down"); };

    try {
      await regenerateScriptContentWithProvider({ prompt: "x" }, "paragraph");
      assert.fail("should have thrown");
    } catch (e: unknown) {
      const err = e as any;
      assert.strictEqual(err.code, "CUSTOM_TEXT_PARAGRAPH_REGENERATION_PROVIDER_FAILURE");
      assert.strictEqual(err.status, 502);
      assert.strictEqual(err.retryable, true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
