import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { searchResponseSchema, UploadDateFilter, DurationFilter, SortBy, type SearchFilters } from "@shared/schema";
import { ProviderError } from "./provider-errors";
import { createSnapshotId, searchVideos } from "./youtube";

const filters: SearchFilters = {
  query: "camera review",
  uploadDate: UploadDateFilter.ANY,
  duration: DurationFilter.ANY,
  sortBy: SortBy.RELEVANCE,
  maxResults: 25,
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.YOUTUBE_API_KEY;
const originalTimeout = process.env.YOUTUBE_TIMEOUT_MS;
const originalTotalTimeout = process.env.YOUTUBE_TOTAL_TIMEOUT_MS;

function validDetails(id: string): object {
  return {
    id,
    snippet: {
      title: "Camera review",
      channelTitle: "Example Channel",
      channelId: "channel-a",
      publishedAt: "2026-08-20T10:00:00Z",
      thumbnails: { high: { url: "https://example.test/thumb.jpg" } },
      description: "A public description",
    },
    statistics: { viewCount: "123" },
    contentDetails: { duration: "PT5M" },
    status: { embeddable: true },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalKey;
  if (originalTimeout === undefined) delete process.env.YOUTUBE_TIMEOUT_MS;
  else process.env.YOUTUBE_TIMEOUT_MS = originalTimeout;
  if (originalTotalTimeout === undefined) delete process.env.YOUTUBE_TOTAL_TIMEOUT_MS;
  else process.env.YOUTUBE_TOTAL_TIMEOUT_MS = originalTotalTimeout;
});

describe("YouTube research snapshots", () => {
  test("snapshot IDs are deterministic for identical provenance", () => {
    const first = createSnapshotId(filters, ["video-a", "video-b"]);
    const second = createSnapshotId(filters, ["video-a", "video-b"]);
    const reordered = createSnapshotId(filters, ["video-b", "video-a"]);

    assert.equal(first, second);
    assert.notEqual(first, reordered);
    assert.match(first, /^yt_[a-f0-9]{32}$/);
  });

  test("returns provenance and marks failed channel enrichment as partial", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Response.json({
          items: [{ id: { videoId: "video-a" } }],
          pageInfo: { totalResults: 12, resultsPerPage: 1 },
          regionCode: "US",
        });
      }
      if (url.includes("/videos?")) {
        return Response.json({
          items: [{
            id: "video-a",
            snippet: {
              title: "Camera review",
              channelTitle: "Example Channel",
              channelId: "channel-a",
              publishedAt: "2026-08-20T10:00:00Z",
              thumbnails: { high: { url: "https://example.test/thumb.jpg" } },
              description: "A public description",
            },
            statistics: { viewCount: "123" },
            contentDetails: { duration: "PT5M" },
            status: { embeddable: true },
          }],
        });
      }
      if (url.includes("/channels?")) {
        return Response.json({ error: { message: "temporary" } }, { status: 503 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }) as typeof fetch;

    const result = await searchVideos(filters);

    assert.equal(result.provenance.query, "camera review");
    assert.deepEqual(result.provenance.orderedVideoIds, ["video-a"]);
    assert.equal(result.enrichment.videoDetails.status, "complete");
    assert.equal(result.enrichment.channels.status, "partial");
    assert.equal(result.warnings[0]?.code, "CHANNEL_ENRICHMENT_PARTIAL");
    assert.equal(result.videos[0]?.viewCount, 123);
    assert.equal(result.videos[0]?.likeCount, undefined);
    assert.equal(result.videos[0]?.hasCaptions, undefined);
    assert.doesNotThrow(() => searchResponseSchema.parse(result));
  });

  test("distinguishes an invalid API key response", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async () => Response.json({
      error: { errors: [{ reason: "keyInvalid" }], message: "API key not valid" },
    }, { status: 400 })) as typeof fetch;

    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError
        && error.category === "invalid_key"
        && error.status === 401,
    );
  });

  test("distinguishes quota exhaustion", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async () => Response.json({
      error: { errors: [{ reason: "quotaExceeded" }], message: "Quota exceeded" },
    }, { status: 403 })) as typeof fetch;

    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError
        && error.category === "quota"
        && error.status === 429
        && error.retryable,
    );
  });

  test("distinguishes a missing key", async () => {
    delete process.env.YOUTUBE_API_KEY;
    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError
        && error.category === "missing_key"
        && error.status === 503
        && !error.retryable,
    );
  });

  test("distinguishes timeout and network failures", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as typeof fetch;
    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError && error.category === "timeout",
    );

    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError && error.category === "network",
    );
  });

  test("distinguishes provider server failures", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async () => Response.json({ error: { message: "temporary" } }, { status: 503 })) as typeof fetch;

    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError
        && error.category === "provider_server"
        && error.status === 502,
    );
  });

  test("omits search items without videoId and adds warning", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Response.json({
          items: [
            { id: { videoId: "video-a" } },
            { id: { videoId: "video-b" } },
            { id: {} },
          ],
          pageInfo: { totalResults: 3, resultsPerPage: 3 },
          regionCode: "US",
        });
      }
      if (url.includes("/videos?")) {
        return Response.json({ items: [validDetails("video-a"), validDetails("video-b")] });
      }
      if (url.includes("/channels?")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }) as typeof fetch;

    const result = await searchVideos(filters);
    assert.equal(result.videos.length, 2);
    assert.ok(
      result.warnings.some((warning) => warning.code === "SEARCH_ITEMS_OMITTED"),
      "expected SEARCH_ITEMS_OMITTED warning",
    );
  });

  test("handles partial video details gracefully", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Response.json({
          items: [
            { id: { videoId: "video-a" } },
            { id: { videoId: "video-b" } },
            { id: { videoId: "video-c" } },
          ],
          pageInfo: { totalResults: 3, resultsPerPage: 3 },
          regionCode: "US",
        });
      }
      if (url.includes("/videos?")) {
        return Response.json({ items: [validDetails("video-a"), validDetails("video-b")] });
      }
      if (url.includes("/channels?")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }) as typeof fetch;

    const result = await searchVideos(filters);
    assert.equal(result.videos.length, 2);
    assert.ok(
      result.warnings.some((warning) => warning.code === "VIDEO_DETAILS_PARTIAL"),
      "expected VIDEO_DETAILS_PARTIAL warning",
    );
  });

  test("skips invalid video items and adds warning", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Response.json({
          items: [
            { id: { videoId: "video-a" } },
            { id: { videoId: "video-b" } },
          ],
          pageInfo: { totalResults: 2, resultsPerPage: 2 },
          regionCode: "US",
        });
      }
      if (url.includes("/videos?")) {
        return Response.json({
          items: [
            validDetails("video-a"),
            { id: "video-b", snippet: { title: "No channel title or thumbnail" } },
          ],
        });
      }
      if (url.includes("/channels?")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    }) as typeof fetch;

    const result = await searchVideos(filters);
    assert.equal(result.videos.length, 1);
    assert.ok(
      result.warnings.some((warning) => warning.code === "VIDEO_ITEM_INVALID"),
      "expected VIDEO_ITEM_INVALID warning",
    );
  });

  test("returns YOUTUBE_INVALID_RESPONSE on malformed top-level JSON", async () => {
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    globalThis.fetch = (async () =>
      new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;

    await assert.rejects(
      searchVideos(filters),
      (error: unknown) => error instanceof ProviderError
        && error.code === "YOUTUBE_INVALID_RESPONSE"
        && error.category === "invalid_response",
    );
  });

  test("aborts with YOUTUBE_TIMEOUT when overall wall clock expires", async () => {
    // The overall budget (60s by default) is shorter than the cumulative
    // per-request budget (30s x N), but if the FIRST request never resolves it
    // is the overall timer that fires first. Overriding the overall timeout to
    // a tiny value makes this deterministic and instant while keeping the test
    // on the real overall-timer code path (youtube.ts: perRequestTimeoutMs()).
    process.env.YOUTUBE_API_KEY = "test-key"; // pragma: allowlist secret, test fixture
    process.env.YOUTUBE_TOTAL_TIMEOUT_MS = "50";
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) => {
      // Never resolves on its own — only the overall AbortSignal can settle it.
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        const abort = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch;

    const pending = searchVideos(filters);
    // Attach the rejection handler BEFORE advancing fake time so the aborting
    // promise is observed as an expected rejection, not an unhandled one.
    const rejection = assert.rejects(
      pending,
      (error: unknown) => error instanceof ProviderError
        && error.code === "YOUTUBE_TIMEOUT"
        && error.category === "timeout"
        && error.status === 504
        && error.retryable,
    );
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    await mock.timers.tick(51);
    await flush();
    await rejection;
    mock.timers.reset();
  });
});
