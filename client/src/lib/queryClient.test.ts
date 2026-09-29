import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { apiRequest, queryClient } from "./queryClient";

const originalFetch = globalThis.fetch;
let fetchCalls: { url: string; init?: RequestInit }[] = [];

function stubFetch(responseFactory: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return responseFactory(url, init);
  }) as typeof fetch;
}

before(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

beforeEach(() => {
  fetchCalls = [];
});

after(() => {
  globalThis.fetch = originalFetch;
  fetchCalls = [];
});

describe("apiRequest", () => {
  test("sends a GET request with credentials and parses JSON", async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const result = await apiRequest("GET", "/api/ping");

    assert.deepEqual(result, { ok: true });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init?.method, "GET");
    assert.equal(fetchCalls[0].init?.credentials, "include");
    assert.equal(fetchCalls[0].init?.headers?.["Content-Type"], undefined);
  });

  test("includes json content-type and serialized body for data payloads", async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ saved: true }), { status: 200 })));

    await apiRequest("POST", "/api/workflows", { id: "wf-1", title: "Demo" });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init?.method, "POST");
    assert.equal(fetchCalls[0].init?.headers?.["Content-Type"], "application/json");
    assert.equal(fetchCalls[0].init?.body, JSON.stringify({ id: "wf-1", title: "Demo" }));
  });

  test("throws with status and server text on a non-ok response", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("failure details", { status: 500, statusText: "Internal Server Error" }))
    );

    await assert.rejects(
      () => apiRequest("GET", "/api/broken"),
      (error: unknown) => {
        assert.equal((error as Error).message, "500: failure details");
        return true;
      }
    );
  });

  test("throws a typed error when the response body is not valid JSON", async () => {
    stubFetch(() => Promise.resolve(new Response("not json", { status: 200 })));

    await assert.rejects(
      () => apiRequest("GET", "/api/malformed"),
      (error: unknown) => {
        assert.equal((error as Error).message, "Server returned an invalid JSON response");
        assert.equal((error as { status?: number }).status, 200);
        return true;
      }
    );
  });
});

describe("queryClient defaults", () => {
  test("queries do not retry, refetch or stale", () => {
    const options = queryClient.getDefaultOptions().queries;
    assert.equal(options?.retry, false);
    assert.equal(options?.refetchInterval, false);
    assert.equal(options?.refetchOnWindowFocus, false);
    assert.equal(options?.staleTime, Infinity);
  });

  test("mutations do not retry", () => {
    const options = queryClient.getDefaultOptions().mutations;
    assert.equal(options?.retry, false);
  });

  test("default queryFn returns JSON for a success response", async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ list: [1, 2, 3] }), { status: 200 })));

    const queryFn = queryClient.getDefaultOptions().queries?.queryFn;
    const result = await queryFn?.({ queryKey: ["test"] } as never);

    assert.deepEqual(result, { list: [1, 2, 3] });
  });

  test("default queryFn preserves the query key segments in the fetch url", async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));

    const queryFn = queryClient.getDefaultOptions().queries?.queryFn;
    await queryFn?.({ queryKey: ["api", "videos", "abc"] } as never);

    assert.equal(fetchCalls[0].url, "api/videos/abc");
  });

  test("default queryFn throws a typed error for a 401 response", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 401, statusText: "Unauthorized" })));

    const queryFn = queryClient.getDefaultOptions().queries?.queryFn;
    await assert.rejects(
      () => queryFn?.({ queryKey: ["test"] } as never),
      /Unauthorized request/
    );
  });
});