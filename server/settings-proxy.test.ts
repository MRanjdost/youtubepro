import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apiKeySettingsSchema } from "./settings";

describe("proxy save regression", () => {
  test("accepts payload with only httpsProxy", () => {
    const r = apiKeySettingsSchema.safeParse({ httpsProxy: "http://127.0.0.1:10809" });
    assert.ok(r.success, "should accept httpsProxy");
    assert.equal((r.data as any).httpsProxy, "http://127.0.0.1:10809");
  });

  test("accepts payload with only resetProxy: true", () => {
    const r = apiKeySettingsSchema.safeParse({ resetProxy: true });
    assert.ok(r.success, "should accept resetProxy");
  });

  test("accepts full form payload with httpsProxy", () => {
    const r = apiKeySettingsSchema.safeParse({
      geminiTextModel: "gemini-3.7-flash",
      geminiImageModel: "gemini-3.1-flash-image",
      httpsProxy: "http://proxy.local:8080",
    });
    assert.ok(r.success, "full form payload should succeed");
  });

  test("accepts empty httpsProxy and transforms to undefined", () => {
    const r = apiKeySettingsSchema.safeParse({ httpsProxy: "" });
    assert.ok(r.success, "empty string should not error");
    assert.strictEqual((r.data as any).httpsProxy, undefined);
  });
});
