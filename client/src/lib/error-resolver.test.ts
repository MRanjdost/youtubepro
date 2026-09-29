import "./i18n.test-setup";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { resolveError } from "./error-resolver";
import i18n from "./i18n";

describe("error-resolver", () => {
  before(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  test("resolves a known YouTube error code", () => {
    const result = resolveError({ code: "YOUTUBE_API_KEY_INVALID" }, undefined, "en");
    assert.equal(result.title, "YouTube API Key Invalid");
    assert.ok(result.suggestion.length > 0, "suggestion should be non-empty");
  });

  test("resolves a code nested in response.data.error", () => {
    const result = resolveError(
      { response: { data: { error: { code: "GEMINI_QUOTA_EXCEEDED" } } } },
      undefined,
      "en"
    );
    assert.equal(result.title, "Gemini Quota Exceeded");
  });

  test("resolves a code nested in response.data", () => {
    const result = resolveError(
      { response: { data: { code: "THUMBNAIL_REQUEST_INVALID" } } },
      undefined,
      "en"
    );
    assert.equal(result.title, "Invalid Thumbnail Request");
  });

  test("resolves a custom provider error code", () => {
    const result = resolveError(
      { code: "CUSTOM_TEXT_SCRIPT_GENERATION_PROVIDER_FAILURE" },
      undefined,
      "en"
    );
    assert.equal(result.title, "Custom Provider Script Generation Failed");
  });

  test("falls back to a generic network error for a NetworkError TypeError", () => {
    const result = resolveError(new TypeError("NetworkError: network is down"), undefined, "en");
    assert.equal(result.title, i18n.t("errors:generic.network", { lng: "en" }));
    assert.equal(result.suggestion, i18n.t("errors:generic.description", { lng: "en" }));
  });

  test("categorizes a 401 Response as unauthorized", () => {
    const response = new Response(null, { status: 401, statusText: "Unauthorized" });
    const result = resolveError(response, undefined, "en");
    assert.equal(result.title, i18n.t("errors:generic.unauthorized", { lng: "en" }));
  });

  test("categorizes a message containing timeout as generic timeout", () => {
    const result = resolveError({ message: "request timed out" }, undefined, "en");
    assert.equal(result.title, i18n.t("errors:generic.timeout", { lng: "en" }));
  });

  test("uses the fallback context when no code or category matches", () => {
    const result = resolveError({ message: "boom" }, "Search", "en");
    assert.equal(result.title, "Search error");
    assert.equal(result.suggestion, "boom");
  });

  test("falls back to the generic title and description for unknown errors", () => {
    const result = resolveError({}, undefined, "en");
    assert.equal(result.title, i18n.t("errors:generic.title", { lng: "en" }));
    assert.equal(result.suggestion, i18n.t("errors:generic.description", { lng: "en" }));
  });

  test("handles a null or undefined error without throwing", () => {
    const result = resolveError(null, undefined, "en");
    assert.ok(result.title.length > 0, "title should be non-empty");
    assert.ok(result.suggestion.length > 0, "suggestion should be non-empty");
  });
});