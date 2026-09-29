import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTextProvider, createImageProvider, TextProviderConfig, ImageProviderConfig } from "./factory";

describe("factory", () => {
  describe("createTextProvider", () => {
    it("returns GeminiProvider for gemini provider", () => {
      const provider = createTextProvider({ provider: "gemini", apiKey: "test-key", model: "gemini-3.7-flash" });
      assert.equal(provider.constructor.name, "GeminiProvider");
    });

    it("returns OpenAICompatibleProvider for openai-compatible provider", () => {
      const provider = createTextProvider({ provider: "openai-compatible", apiKey: "sk-test", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3-5-sonnet" });
      assert.equal(provider.constructor.name, "OpenAICompatibleProvider");
    });

    it("throws for unknown text provider", () => {
      assert.throws(
        () => createTextProvider({ provider: "unknown", apiKey: "k", model: "m" } as TextProviderConfig),
        { message: /Unsupported text provider/ }
      );
    });
  });

  describe("createImageProvider", () => {
    it("returns GeminiProvider for gemini image provider", () => {
      const provider = createImageProvider({ provider: "gemini", apiKey: "test-key", model: "gemini-3.1-flash-image" });
      assert.equal(provider.constructor.name, "GeminiProvider");
    });

    it("returns OpenAICompatibleProvider for openai-compatible image provider", () => {
      const provider = createImageProvider({ provider: "openai-compatible", apiKey: "sk-test", baseUrl: "https://images.example.com/v1", model: "dall-e-3" });
      assert.equal(provider.constructor.name, "OpenAICompatibleProvider");
    });

    it("returns PollinationsProvider for pollinations image provider", () => {
      const provider = createImageProvider({ provider: "pollinations", apiKey: "", model: "" });
      assert.equal(provider.constructor.name, "PollinationsProvider");
    });

    it("throws for openai-compatible image provider without baseUrl", () => {
      assert.throws(
        () => createImageProvider({ provider: "openai-compatible", apiKey: "k", model: "m" } as ImageProviderConfig),
        { message: /requires baseUrl/ }
      );
    });

    it("throws for unsupported image provider", () => {
      assert.throws(
        () => createImageProvider({ provider: "other", apiKey: "k", model: "m" } as ImageProviderConfig),
        { message: /Unsupported image provider/ }
      );
    });
  });
});
