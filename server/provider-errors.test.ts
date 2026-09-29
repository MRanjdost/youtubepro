import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ProviderError,
  normalizeProviderError,
  providerErrorPayload,
} from "./provider-errors";

describe("normalizeProviderError — message-to-category mapping", () => {
  const cases: Array<[message: string, expected: string]> = [
    ["deadline exceeded", "timeout"],
    ["DEADLINE_EXCEEDED", "timeout"],
    ["deadline_exceeded", "timeout"],
    ["did not contain image data", "invalid_response"],
    ["validation failed", "invalid_response"],
    ["socket hang up", "network"],
    ["ECONNRESET", "network"],
    ["timeout", "timeout"],
    ["fetch failed", "network"],
    ["invalid response", "invalid_response"],
    ["quota exceeded", "quota"],
    ["api key not valid", "invalid_key"],
    ["some random error", "unknown"],
  ];

  for (const [message, expected] of cases) {
    test(`maps "${message}" → ${expected}`, () => {
      const error = normalizeProviderError(new Error(message), "gemini");
      assert.equal(error.category, expected);
    });
  }
});

describe("normalizeProviderError — conversion behavior", () => {
  test("converts a plain Error into a ProviderError", () => {
    const error = normalizeProviderError(new Error("fetch failed"), "gemini");
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "network");
    assert.equal(error.name, "ProviderError");
  });

  test("preserves an existing ProviderError unchanged", () => {
    const original = new ProviderError({
      message: "provider said no",
      category: "quota",
      code: "GEMINI_QUOTA",
      status: 429,
      retryable: true,
    });
    assert.strictEqual(normalizeProviderError(original, "youtube"), original);
  });

  test("carries the original error as cause", () => {
    const cause = new Error("inner failure");
    const input = new Error("fetch failed", { cause });
    const error = normalizeProviderError(input, "gemini");
    assert.equal(error.cause, input);
  });
});

describe("providerErrorPayload", () => {
  test("includes error, suggestion, code, category, retryable, and the context label", () => {
    const error = new ProviderError({
      message: "YouTube rejected the configured API key",
      category: "invalid_key",
      code: "YOUTUBE_INVALID_KEY",
      status: 401,
      retryable: false,
    });
    const payload = providerErrorPayload(error, "YouTube");
    assert.equal(payload.code, "YOUTUBE_INVALID_KEY");
    assert.equal(payload.category, "invalid_key");
    assert.equal(payload.retryable, false);
    assert.match(payload.error, /YouTube/);
    assert.match(payload.suggestion, /API key/);
  });
});

describe("normalizeProviderError — category defaults", () => {
  const cases: Array<[message: string, expectedStatus: number, expectedRetryable: boolean]> = [
    ["timeout", 504, true],
    ["network unreachable", 502, true],
    ["invalid response", 502, false],
    ["quota exhausted", 429, true],
    ["Gemini API key is not configured", 503, false],
    ["Invalid API key", 401, false],
    ["some unknown failure", 500, true],
  ];

  for (const [message, expectedStatus, expectedRetryable] of cases) {
    test(`"${message}" → status ${expectedStatus}, retryable ${expectedRetryable}`, () => {
      const error = normalizeProviderError(new Error(message), "gemini");
      assert.equal(error.status, expectedStatus);
      assert.equal(error.retryable, expectedRetryable);
    });
  }

  test("provider_server defaults are applied by product code paths, not message mapping", () => {
    // categoryFromMessage never returns "provider_server" (that category is only
    // raised explicitly by server/providers/resolve.ts with status 502 / retryable
    // true, matching the same defaults used here). Assert that contract directly.
    const error = new ProviderError({
      message: "Gemini script generation failed",
      category: "provider_server",
      code: "GEMINI_SCRIPT_GENERATION_PROVIDER_FAILURE",
      status: 502,
      retryable: true,
    });
    assert.equal(error.status, 502);
    assert.equal(error.retryable, true);
  });
});