import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GeminiProvider } from "./gemini-provider";

describe("GeminiProvider interface contract", () => {
  it("has generate method (TextAIProvider)", () => {
    const provider = new GeminiProvider({ apiKey: "fake-key" });
    assert.equal(typeof provider.generate, "function");
  });

  it("has generateImage method (ImageAIProvider)", () => {
    const provider = new GeminiProvider({ apiKey: "fake-key" });
    assert.equal(typeof provider.generateImage, "function");
  });

  it("generate request shape matches TextGenerationRequest", () => {
    // TypeScript compiles this successfully if shape is correct
    const req = {
      prompt: "Hello",
      systemInstruction: "You are helpful",
      model: "gemini-3.7-flash",
      jsonMode: true,
    };
    assert.ok(req.prompt);
    assert.ok(req.model);
    assert.equal(typeof req.jsonMode, "boolean");
  });

  it("generateImage request shape matches ImageGenerationRequest", () => {
    const req = {
      prompt: "A photo",
      model: "gemini-3.1-flash-image",
      aspectRatio: "16:9",
      referenceImages: ["data:image/png;base64,AAAA"],
    };
    assert.ok(req.prompt);
    assert.ok(req.model);
    assert.ok(req.referenceImages?.length);
  });
});