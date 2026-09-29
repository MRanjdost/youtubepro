import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir = "";
let prevEnvPath: string | undefined;

import {
  saveApiKeySettings,
  getApiKeyStatus,
  type ApiKeySettings,
} from "./settings";

describe("settings I/O (isolated temp dir)", () => {
  before(async () => {
    prevEnvPath = process.env.SETTINGS_ENV_PATH;
    tempDir = await mkdtemp(path.join(tmpdir(), "yt-pro-settings-"));
    process.env.SETTINGS_ENV_PATH = path.join(tempDir, ".env");
  });

  after(async () => {
    if (prevEnvPath === undefined) {
      delete process.env.SETTINGS_ENV_PATH;
    } else {
      process.env.SETTINGS_ENV_PATH = prevEnvPath;
    }
    if (tempDir) {
      try { await rm(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("writes custom text settings to .env file and reads back", async () => {
    const input: ApiKeySettings = {
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://openrouter.ai/api/v1",
      customTextApiKey: "sk-testkey-12345678",
      customTextModel: "anthropic/claude-3-5-sonnet",
    };
    await saveApiKeySettings(input);
    const contents = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(contents.includes('CUSTOM_TEXT_PROVIDER="openai-compatible"'), "provider written");
    assert.ok(contents.includes('CUSTOM_TEXT_BASE_URL="https://openrouter.ai/api/v1"'), "baseUrl written");
    assert.ok(contents.includes('CUSTOM_TEXT_API_KEY="sk-testkey-12345678"'), "apiKey written");
    assert.ok(contents.includes('CUSTOM_TEXT_MODEL="anthropic/claude-3-5-sonnet"'), "model written");
  });

  it("getApiKeyStatus reports provider without exposing api key value", async () => {
    await saveApiKeySettings({
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://openrouter.ai/api/v1",
      customTextApiKey: "secret-key-12345678",
      customTextModel: "m",
    });
    const status = getApiKeyStatus();
    assert.equal(status.customTextProvider, "openai-compatible");
    assert.equal(typeof status.customTextApiKey, "boolean");
    assert.equal(status.customTextApiKey, true);
    const jsonStatus = JSON.stringify(status);
    assert.ok(!jsonStatus.includes("secret-key-12345678"), "real api key never exposed in status");
  });

  it("image provider settings saved independently of text settings", async () => {
    await saveApiKeySettings({
      customImageProvider: "gemini",
      customImageBaseUrl: "https://gemini.example",
      customImageApiKey: "img-key-12345678",
      customImageModel: "gemini-3.1",
    });
    const contents = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(contents.includes('CUSTOM_IMAGE_PROVIDER="gemini"'));
    assert.ok(contents.includes('CUSTOM_IMAGE_API_KEY="img-key-12345678"'));
  });

  it("behavior when no custom fields sent: existing CUSTOM_TEXT_* remain unchanged (no wipe)", async () => {
    await saveApiKeySettings({
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://a",
      customTextApiKey: "key-12345678",
      customTextModel: "m",
    });
    const afterFirst = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(afterFirst.includes('CUSTOM_TEXT_PROVIDER="openai-compatible"'), "text provider set");

    await saveApiKeySettings({ geminiApiKey: "GEM-NEWKEY-12345678" });
    const afterSecond = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");

    assert.ok(afterSecond.includes('CUSTOM_TEXT_PROVIDER="openai-compatible"'), "previous custom text provider kept");
    assert.ok(afterSecond.includes('CUSTOM_TEXT_API_KEY="key-12345678"'), "previous custom text key kept");
    assert.ok(afterSecond.includes('GEMINI_API_KEY="GEM-NEWKEY-12345678"'), "new gemini key set");
  });

  it("resetCustomText removes all custom text fields and sets provider to gemini", async () => {
    await saveApiKeySettings({
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://openrouter.ai/api/v1",
      customTextApiKey: "sk-key-to-be-deleted-123456",
      customTextModel: "anthropic/claude-3-5-sonnet",
    });
    const afterSetup = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(afterSetup.includes('CUSTOM_TEXT_PROVIDER="openai-compatible"'), "setup: custom provider set");

    await saveApiKeySettings({ resetCustomText: true });
    const afterReset = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");

    assert.ok(afterReset.includes('CUSTOM_TEXT_PROVIDER="gemini"'), "provider reverted to gemini");
    assert.ok(!afterReset.includes('CUSTOM_TEXT_BASE_URL'), "baseUrl removed");
    assert.ok(!afterReset.includes('CUSTOM_TEXT_API_KEY'), "apiKey removed");
    assert.ok(!afterReset.includes('CUSTOM_TEXT_MODEL'), "model removed");
  });

  it("resetCustomImage removes all custom image fields and sets provider to gemini", async () => {
    await saveApiKeySettings({
      customImageProvider: "openai-compatible",
      customImageBaseUrl: "https://custom.example",
      customImageApiKey: "img-key-to-be-deleted-123456",
      customImageModel: "custom-image-model-v1",
    });
    const afterSetup = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(afterSetup.includes('CUSTOM_IMAGE_PROVIDER="openai-compatible"'), "setup: custom image provider set");

    await saveApiKeySettings({ resetCustomImage: true });
    const afterReset = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");

    assert.ok(afterReset.includes('CUSTOM_IMAGE_PROVIDER="gemini"'), "image provider reverted to gemini");
    assert.ok(!afterReset.includes('CUSTOM_IMAGE_BASE_URL'), "image baseUrl removed");
    assert.ok(!afterReset.includes('CUSTOM_IMAGE_API_KEY'), "image apiKey removed");
    assert.ok(!afterReset.includes('CUSTOM_IMAGE_MODEL'), "image model removed");
  });

  it("reset flags can be combined with key-only save", async () => {
    await saveApiKeySettings({
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://a",
      customTextApiKey: "key-12345678",
      customTextModel: "m",
    });
    await saveApiKeySettings({ geminiApiKey: "NEWKEY-12345678", resetCustomText: true });
    const after = await readFile(process.env.SETTINGS_ENV_PATH!, "utf8");
    assert.ok(after.includes('CUSTOM_TEXT_PROVIDER="gemini"'), "resetCustomText worked alongside key save");
    assert.ok(after.includes('GEMINI_API_KEY="NEWKEY-12345678"'), "geminiApiKey written");
  });
});
