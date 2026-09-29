import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import supertest from "supertest";
import { createAppWithRoutes } from "./test-app";
import { resetRateLimit } from "./rate-limit";
import { VideoFormat, TargetAudience, CreatorPersona } from "@shared/schema";

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

describe("POST /api/script/generate (integration via supertest + mkdtemp .env)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-script-http-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  function makeValidResponse() {
    return JSON.stringify({
      titles: ["T1", "T2", "T3"],
      hook: "Hook",
      structure: [
        { section: "S1", purpose: "P1", evidenceClaimIds: [] },
        { section: "S2", purpose: "P2", evidenceClaimIds: [] },
      ],
      script: "Script text.",
      payoff: "Payoff",
      primaryCta: "CTA",
      studioValidation: "Studio",
    });
  }

  const validPayload = {
    topic: "Camera comparison",
    format: VideoFormat.REVIEW,
    audience: TargetAudience.GENERAL,
    persona: CreatorPersona.NONE,
  };

  it("H1: custom provider mock with valid JSON → 200", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk-or-test-12345678"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk-or-test-12345678", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: makeValidResponse() } }] }),
    });
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/script/generate").send(validPayload).expect(200);
      assert.strictEqual(typeof res.body.script, "string");
      assert.strictEqual(Array.isArray(res.body.titles), true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H2: custom provider network failure → 502 PROVIDER_FAILURE", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://bad.example.com"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://bad.example.com", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/script/generate").send(validPayload).expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_TEXT_SCRIPT_GENERATION_PROVIDER_FAILURE");
      assert.strictEqual(res.body.category, "provider_server");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H3: custom provider malformed JSON → 502 INVALID", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_TEXT_PROVIDER="openai-compatible"\nCUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"\nCUSTOM_TEXT_API_KEY="sk"\nCUSTOM_TEXT_MODEL="m"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_TEXT_MODEL: "gemini-3.7-flash", CUSTOM_TEXT_PROVIDER: "openai-compatible", CUSTOM_TEXT_BASE_URL: "https://openrouter.ai/api/v1", CUSTOM_TEXT_API_KEY: "sk", CUSTOM_TEXT_MODEL: "m" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) });
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/script/generate").send(validPayload).expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_TEXT_SCRIPT_GENERATION_INVALID");
      assert.strictEqual(res.body.category, "invalid_response");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
