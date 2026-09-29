import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiKeySettingsSchema } from "./settings";

describe("apiKeySettingsSchema (schema-level, no I/O)", () => {
  it("stores and reads custom text provider settings", () => {
    const parsed = apiKeySettingsSchema.parse({
      customTextProvider: "openai-compatible",
      customTextBaseUrl: "https://openrouter.ai/api/v1",
      customTextApiKey: "sk-testkey-12345678",
      customTextModel: "anthropic/claude-3-5-sonnet",
    });
    assert.equal(parsed.customTextProvider, "openai-compatible");
    assert.equal(parsed.customTextBaseUrl, "https://openrouter.ai/api/v1");
  });

  it("stores and reads custom image provider settings independently", () => {
    const parsed = apiKeySettingsSchema.parse({
      customImageProvider: "gemini",
      customImageBaseUrl: "https://gemini.example",
      customImageApiKey: "img-key-12345678",
      customImageModel: "gemini-3.1",
    });
    assert.equal(parsed.customImageProvider, "gemini");
  });

  it("allows gemini text provider without baseUrl/apiKey/model", () => {
    const parsed = apiKeySettingsSchema.parse({
      customTextProvider: "gemini",
    });
    assert.equal(parsed.customTextProvider, "gemini");
    assert.strictEqual(parsed.customTextBaseUrl, undefined);
    assert.strictEqual(parsed.customTextApiKey, undefined);
    assert.strictEqual(parsed.customTextModel, undefined);
  });

  it("rejects non-gemini text provider when baseUrl missing", () => {
    assert.throws(
      () => apiKeySettingsSchema.parse({
        customTextProvider: "openai-compatible",
        customTextApiKey: "sk-test",
        customTextModel: "m",
      }),
      /base URL is required/
    );
  });

  it("rejects non-gemini text provider when apiKey missing", () => {
    assert.throws(
      () => apiKeySettingsSchema.parse({
        customTextProvider: "openai-compatible",
        customTextBaseUrl: "https://example.com",
        customTextModel: "m",
      }),
      /API key is required/
    );
  });

  it("rejects non-gemini image provider when baseUrl missing", () => {
    assert.throws(
      () => apiKeySettingsSchema.parse({
        customImageProvider: "openai-compatible",
        customImageApiKey: "sk-test",
        customImageModel: "m",
      }),
      /base URL is required/
    );
  });

  it("reads old settings without custom fields (regression)", () => {
    const parsed = apiKeySettingsSchema.parse({
      geminiApiKey: "AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000",
      geminiTextModel: "gemini-3.7-flash",
      geminiImageModel: "gemini-3.1-flash-image",
      youtubeApiKey: "AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_11111111",
    });
    assert.strictEqual(parsed.customTextProvider, undefined);
    assert.strictEqual(parsed.customImageProvider, undefined);
    assert.equal(parsed.geminiApiKey, "AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000");
  });

  it("accepts resetCustomText to signal reverting to Gemini", () => {
    const parsed = apiKeySettingsSchema.parse({ resetCustomText: true });
    assert.strictEqual(parsed.resetCustomText, true);
    assert.strictEqual(parsed.customTextProvider, undefined);
    assert.strictEqual(parsed.customImageProvider, undefined);
  });

  it("accepts resetCustomImage to signal reverting to Gemini", () => {
    const parsed = apiKeySettingsSchema.parse({ resetCustomImage: true });
    assert.strictEqual(parsed.resetCustomImage, true);
  });

  it("accepts both reset flags together", () => {
    const parsed = apiKeySettingsSchema.parse({ resetCustomText: true, resetCustomImage: true });
    assert.strictEqual(parsed.resetCustomText, true);
    assert.strictEqual(parsed.resetCustomImage, true);
  });
});
