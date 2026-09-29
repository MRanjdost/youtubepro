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

describe("POST /api/thumbnail/generate (integration via supertest + mkdtemp .env)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-thumb-http-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) delete process.env.SETTINGS_ENV_PATH;
    else process.env.SETTINGS_ENV_PATH = prevEnvPath;
    if (tempDir) try { await rm(tempDir, { recursive: true, force: true }); } catch {}
  });

  const validPayload = {
    topic: "Best camera for beginners",
    style: "bold",
    mainText: "Compare",
    subText: "Test",
    textPosition: "bottom",
    referenceImages: [] as { image: string; role: string }[],
  };

  it("H1: gemini image mock with valid base64 → 200", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
        entries: () => [["content-type", "application/json"]][Symbol.iterator](),
        [Symbol.iterator]: () => [["content-type", "application/json"]][Symbol.iterator](),
      } as any,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            }],
          },
        }],
      }),
    });
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/thumbnail/generate").send(validPayload).expect(200);
      assert.strictEqual(typeof res.body.imageData, "string");
      assert.ok(res.body.imageData.startsWith("data:image/png;base64,"));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H2: openai-compatible custom image provider network failure → 502 PROVIDER_FAILURE", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\nCUSTOM_IMAGE_PROVIDER="openai-compatible"\nCUSTOM_IMAGE_BASE_URL="https://bad.example.com"\nCUSTOM_IMAGE_API_KEY="sk"\nCUSTOM_IMAGE_MODEL="img-model"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", CUSTOM_IMAGE_PROVIDER: "openai-compatible", CUSTOM_IMAGE_BASE_URL: "https://bad.example.com", CUSTOM_IMAGE_API_KEY: "sk", CUSTOM_IMAGE_MODEL: "img-model", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/thumbnail/generate").send(validPayload).expect(502);
      assert.strictEqual(res.body.code, "CUSTOM_IMAGE_GENERATION_PROVIDER_FAILURE");
      assert.strictEqual(res.body.category, "network");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("H3: bad request payload → 400 THUMBNAIL_REQUEST_INVALID", async () => {
    writeEnv('GEMINI_API_KEY="dummy"\n');
    setProcessEnv({ GEMINI_API_KEY: "dummy", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    resetRateLimit();
    app = await createAppWithRoutes();
    try {
      const res = await supertest(app).post("/api/thumbnail/generate").send({}).expect(400);
      assert.strictEqual(res.body.code, "THUMBNAIL_REQUEST_INVALID");
    } finally {}
  });
});
