/**
 * HTTP-level integration test for POST /api/script/extract-narration.
 * Uses mkdtemp isolation (SETTINGS_ENV_PATH) and resetRateLimit().
 */
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

describe("POST /api/script/extract-narration (integration via supertest + mkdtemp .env)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-http-narration-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("H1: custom provider path with mocked successful fetch → 200 with narration text", async () => {
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
          choices: [{ message: { content: "Clean spoken narration." } }],
        }),
      }) as any;

    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app)
        .post("/api/script/extract-narration")
        .send({ scriptContent: "Hello world" })
        .expect(200);
      assert.strictEqual(res.body.narration, "Clean spoken narration.");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H2: custom provider path with mocked failing fetch → 502 with CUSTOM_TEXT_NARRATION_EXTRACTION_PROVIDER_FAILURE", async () => {
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

    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app)
        .post("/api/script/extract-narration")
        .send({ scriptContent: "fail" })
        .expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_TEXT_NARRATION_EXTRACTION_PROVIDER_FAILURE");
      assert.strictEqual(res.body.category, "provider_server");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
