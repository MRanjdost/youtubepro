/**
 * YouTube Data API v3 client: search, video/channel enrichment, snapshot
 * hashing, partial-stage probes, and normalized provider errors.
 */
import type { Video, SearchFilters, SearchResponse, ResearchWarning } from "@shared/schema";
import { UploadDateFilter, DurationFilter, SortBy, searchResponseSchema, videoSchema } from "@shared/schema";
import { createHash } from "node:crypto";
import { ProviderError } from "./provider-errors";

const BASE_URL = "https://www.googleapis.com/youtube/v3";

const YOUTUBE_MAX_ATTEMPTS = 2;
const YOUTUBE_RETRY_DELAY_MS = 1_000;

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function perRequestTimeoutMs(): number {
  return parseTimeoutMs(process.env.YOUTUBE_TIMEOUT_MS, 30_000);
}

function overallTimeoutMs(): number {
  return parseTimeoutMs(process.env.YOUTUBE_TOTAL_TIMEOUT_MS, 60_000);
}

if (!process.env.YOUTUBE_API_KEY) {
  console.warn("Warning: YOUTUBE_API_KEY is not set. YouTube search will not work.");
}

type YouTubeThumbnails = {
  maxres?: { url?: unknown };
  standard?: { url?: unknown };
  high?: { url?: unknown };
  medium?: { url?: unknown };
  default?: { url?: unknown };
};

type YouTubeSnippetSlim = {
  title?: unknown;
  channelTitle?: unknown;
  channelId?: unknown;
  publishedAt?: unknown;
  description?: unknown;
  thumbnails?: YouTubeThumbnails;
  tags?: unknown;
  categoryId?: unknown;
  defaultLanguage?: unknown;
  defaultAudioLanguage?: unknown;
  liveBroadcastContent?: unknown;
  country?: unknown;
  customUrl?: unknown;
};

type YouTubeSearchApiResponse = {
  items?: Array<{ id?: { videoId?: unknown } }>;
  pageInfo?: { totalResults?: unknown; resultsPerPage?: unknown };
  regionCode?: unknown;
  nextPageToken?: unknown;
  error?: { message?: unknown; errors?: Array<{ reason?: unknown; message?: unknown }> };
};

type YouTubeVideoDetailsItem = {
  id?: unknown;
  snippet?: YouTubeSnippetSlim;
  statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown };
  contentDetails?: {
    duration?: unknown;
    definition?: unknown;
    caption?: unknown;
    licensedContent?: unknown;
  };
  status?: { embeddable?: unknown; madeForKids?: unknown };
  topicDetails?: { topicCategories?: unknown };
  paidProductPlacementDetails?: { hasPaidProductPlacement?: unknown };
  liveStreamingDetails?: {
    actualStartTime?: unknown;
    actualEndTime?: unknown;
    scheduledStartTime?: unknown;
    concurrentViewers?: unknown;
  };
};

type YouTubeVideoDetailsResponse = {
  items?: YouTubeVideoDetailsItem[];
  error?: { message?: unknown; errors?: Array<{ reason?: unknown; message?: unknown }> };
};

type YouTubeChannelItem = {
  id?: unknown;
  snippet?: YouTubeSnippetSlim;
  statistics?: {
    subscriberCount?: unknown;
    hiddenSubscriberCount?: unknown;
    videoCount?: unknown;
    viewCount?: unknown;
  };
  brandingSettings?: { channel?: { defaultLanguage?: unknown; keywords?: unknown } };
  topicDetails?: { topicCategories?: unknown };
};

type YouTubeChannelResponse = {
  items?: YouTubeChannelItem[];
  error?: { message?: unknown; errors?: Array<{ reason?: unknown; message?: unknown }> };
};

function getPublishedAfter(uploadDate: UploadDateFilter): string | undefined {
  const now = new Date();

  switch (uploadDate) {
    case UploadDateFilter.HOUR:
      now.setHours(now.getHours() - 1);
      return now.toISOString();
    case UploadDateFilter.TODAY:
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    case UploadDateFilter.WEEK:
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    case UploadDateFilter.MONTH:
      now.setMonth(now.getMonth() - 1);
      return now.toISOString();
    case UploadDateFilter.YEAR:
      now.setFullYear(now.getFullYear() - 1);
      return now.toISOString();
    default:
      return undefined;
  }
}

function getVideoDuration(duration: DurationFilter): string | undefined {
  switch (duration) {
    case DurationFilter.SHORT:
      return "short";
    case DurationFilter.MEDIUM:
      return "medium";
    case DurationFilter.LONG:
      return "long";
    default:
      return undefined;
  }
}

function getOrderBy(sortBy: SortBy): string {
  switch (sortBy) {
    case SortBy.DATE:
      return "date";
    case SortBy.VIEW_COUNT:
      return "viewCount";
    case SortBy.RATING:
      return "rating";
    default:
      return "relevance";
  }
}

function parseOptionalCount(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getYouTubeErrorReason(body: unknown): string {
  const reasonParts: string[] = [];
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const errorEntry = error as { message?: unknown; errors?: unknown };
      if (typeof errorEntry.message === "string") reasonParts.push(errorEntry.message);
      if (Array.isArray(errorEntry.errors)) {
        for (const entry of errorEntry.errors) {
          if (entry && typeof entry === "object") {
            const detail = entry as { reason?: unknown; message?: unknown };
            if (typeof detail.reason === "string") reasonParts.push(detail.reason);
            if (typeof detail.message === "string") reasonParts.push(detail.message);
          }
        }
      }
    }
  }
  return reasonParts.join(" ");
}

function youtubeHttpError(status: number, body: unknown, stage: string): ProviderError {
  const reason = getYouTubeErrorReason(body).toLowerCase();
  const invalidKey = status === 401
    || reason.includes("keyinvalid")
    || reason.includes("api key not valid")
    || reason.includes("invalid api key");
  const quota = status === 429
    || reason.includes("quota")
    || reason.includes("dailylimit")
    || reason.includes("rate limit");
  const restricted = status === 403
    || reason.includes("forbidden")
    || reason.includes("ipblocked")
    || reason.includes("referer")
    || reason.includes("access not configured");

  if (invalidKey) {
    return new ProviderError({
      message: `YouTube rejected the API key during ${stage}.`,
      category: "invalid_key",
      code: "YOUTUBE_INVALID_KEY",
      status: 401,
      retryable: false,
    });
  }
  if (quota) {
    return new ProviderError({
      message: `YouTube API rejected the request: daily quota was exhausted during ${stage} (429).`,
      category: "quota",
      code: "YOUTUBE_QUOTA",
      status: 429,
      retryable: true,
    });
  }
  if (restricted) {
    return new ProviderError({
      message: `YouTube API access is restricted during ${stage} (403). ${reason ? `YouTube: ${reason}` : ""}`.trim(),
      category: "invalid_key",
      code: "YOUTUBE_REQUEST_REJECTED",
      status: 403,
      retryable: false,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      message: `YouTube returned a server error during ${stage}.`,
      category: "provider_server",
      code: "YOUTUBE_PROVIDER_SERVER",
      status: 502,
      retryable: true,
    });
  }
  return new ProviderError({
    message: `YouTube rejected the ${stage} request.`,
    category: "unknown",
    code: "YOUTUBE_REQUEST_REJECTED",
    status: 502,
    retryable: false,
  });
}

async function fetchYouTubeJson(url: string, stage: string, overallSignal?: AbortSignal): Promise<unknown> {
  for (let attempt = 1; attempt <= YOUTUBE_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), perRequestTimeoutMs());
    const signal = overallSignal ? AbortSignal.any([controller.signal, overallSignal]) : controller.signal;
    try {
      const response = await fetch(url, { signal });
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new ProviderError({
          message: `YouTube returned malformed JSON during ${stage}.`,
          category: "invalid_response",
          code: "YOUTUBE_INVALID_RESPONSE",
          status: 502,
          retryable: false,
          cause: error,
        });
      }
      if (!response.ok) {
        const bodyPreview = typeof body === "string"
          ? body.substring(0, 300)
          : JSON.stringify(body ?? null).substring(0, 300);
        console.error(`[youtube] ${stage} rejected with HTTP ${response.status}: ${bodyPreview}`);
        if ((response.status === 429 || response.status >= 500) && attempt < YOUTUBE_MAX_ATTEMPTS) {
          console.warn(`[youtube] Retry ${attempt}/${YOUTUBE_MAX_ATTEMPTS} for ${stage} after HTTP ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, YOUTUBE_RETRY_DELAY_MS));
          continue;
        }
        throw youtubeHttpError(response.status, body, stage);
      }
      return body;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError({
          message: `YouTube timed out during ${stage}.`,
          category: "timeout",
          code: "YOUTUBE_TIMEOUT",
          status: 504,
          retryable: true,
          cause: error,
        });
      }
      throw new ProviderError({
        message: `YouTube could not be reached during ${stage}.`,
        category: "network",
        code: "YOUTUBE_NETWORK",
        status: 502,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ProviderError({
    message: `YouTube could not be reached during ${stage}.`,
    category: "network",
    code: "YOUTUBE_NETWORK",
    status: 502,
    retryable: true,
  });
}

export function createSnapshotId(filters: SearchFilters, orderedVideoIds: string[]): string {
  const identity = JSON.stringify({
    query: filters.query.trim(),
    uploadDate: filters.uploadDate,
    duration: filters.duration,
    sortBy: filters.sortBy,
    maxResults: filters.maxResults,
    orderedVideoIds,
  });
  return `yt_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function validateSearchResponse(result: SearchResponse): SearchResponse {
  const parsed = searchResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new ProviderError({
      message: "YouTube returned a search response that failed the internal contract.",
      category: "invalid_response",
      code: "YOUTUBE_INVALID_RESPONSE",
      status: 502,
      retryable: false,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function successfulProvenance(filters: SearchFilters, orderedVideoIds: string[]): SearchResponse["provenance"] {
  return {
    provider: "youtube-data-api-v3",
    query: filters.query.trim(),
    filters: {
      uploadDate: filters.uploadDate,
      duration: filters.duration,
      sortBy: filters.sortBy,
      maxResults: filters.maxResults,
    },
    orderedVideoIds,
  };
}

function mapVideoFromDetails(
  item: YouTubeVideoDetailsItem,
  channelDetails: Map<string, YouTubeChannelItem>,
): unknown {
  const snippet = item.snippet ?? {};
  const channel = channelDetails.get(stringValue(channelIdOf(item)) ?? "") ?? undefined;
  const channelStats = channel?.statistics;
  const thumbnailUrl = stringValue(snippet.thumbnails?.maxres?.url)
    || stringValue(snippet.thumbnails?.standard?.url)
    || stringValue(snippet.thumbnails?.high?.url)
    || stringValue(snippet.thumbnails?.medium?.url)
    || stringValue(snippet.thumbnails?.default?.url);

  return {
    id: stringValue(item.id),
    title: stringValue(snippet.title),
    channelTitle: stringValue(snippet.channelTitle),
    channelId: channelIdOf(item),
    publishedAt: stringValue(snippet.publishedAt),
    thumbnailUrl,
    description: stringValue(snippet.description) ?? "",
    viewCount: parseOptionalCount(item.statistics?.viewCount),
    likeCount: parseOptionalCount(item.statistics?.likeCount),
    commentCount: parseOptionalCount(item.statistics?.commentCount),
    duration: stringValue(item.contentDetails?.duration),
    tags: Array.isArray(snippet.tags) ? snippet.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    categoryId: stringValue(snippet.categoryId),
    liveBroadcastContent: stringValue(snippet.liveBroadcastContent),
    defaultLanguage: stringValue(snippet.defaultLanguage),
    defaultAudioLanguage: stringValue(snippet.defaultAudioLanguage),
    definition: stringValue(item.contentDetails?.definition),
    hasCaptions: item.contentDetails?.caption === "true"
      ? true
      : item.contentDetails?.caption === "false"
        ? false
        : undefined,
    licensedContent: typeof item.contentDetails?.licensedContent === "boolean"
      ? item.contentDetails.licensedContent
      : undefined,
    embeddable: typeof item.status?.embeddable === "boolean" ? item.status.embeddable : undefined,
    madeForKids: typeof item.status?.madeForKids === "boolean" ? item.status.madeForKids : undefined,
    hasPaidProductPlacement: typeof item.paidProductPlacementDetails?.hasPaidProductPlacement === "boolean"
      ? item.paidProductPlacementDetails.hasPaidProductPlacement
      : undefined,
    topicCategories: Array.isArray(item.topicDetails?.topicCategories)
      ? item.topicDetails!.topicCategories.filter((topic): topic is string => typeof topic === "string")
      : undefined,
    liveStreamingDetails: item.liveStreamingDetails ? {
      actualStartTime: stringValue(item.liveStreamingDetails.actualStartTime),
      actualEndTime: stringValue(item.liveStreamingDetails.actualEndTime),
      scheduledStartTime: stringValue(item.liveStreamingDetails.scheduledStartTime),
      concurrentViewers: parseOptionalCount(item.liveStreamingDetails.concurrentViewers),
    } : undefined,
    channelStatistics: channel ? {
      subscriberCount: channelStats?.hiddenSubscriberCount
        ? undefined
        : parseOptionalCount(channelStats?.subscriberCount),
      hiddenSubscriberCount: Boolean(channelStats?.hiddenSubscriberCount),
      videoCount: parseOptionalCount(channelStats?.videoCount),
      viewCount: parseOptionalCount(channelStats?.viewCount),
      publishedAt: stringValue(channel.snippet?.publishedAt),
      country: stringValue(channel.snippet?.country),
      thumbnailUrl: stringValue(channel.snippet?.thumbnails?.default?.url),
      description: stringValue(channel.snippet?.description),
      customUrl: stringValue(channel.snippet?.customUrl),
      defaultLanguage: stringValue(channel.brandingSettings?.channel?.defaultLanguage),
      keywords: Array.isArray(channel.brandingSettings?.channel?.keywords)
        ? channel.brandingSettings!.channel!.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : undefined,
      topicCategories: Array.isArray(channel.topicDetails?.topicCategories)
        ? channel.topicDetails!.topicCategories.filter((topic): topic is string => typeof topic === "string")
        : undefined,
    } : undefined,
  };
}

function channelIdOf(item: { snippet?: { channelId?: unknown } }): string | undefined {
  return stringValue(item.snippet?.channelId);
}

export async function searchVideos(filters: SearchFilters): Promise<SearchResponse> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderError({
      message: "YouTube API key is not configured.",
      category: "missing_key",
      code: "YOUTUBE_MISSING_KEY",
      status: 503,
      retryable: false,
    });
  }

  const overallController = new AbortController();
  const overallTimer = setTimeout(() => overallController.abort(), overallTimeoutMs());
  try {
    const params = new URLSearchParams({
      part: "snippet",
      q: filters.query,
      type: "video",
      maxResults: String(filters.maxResults || 25),
      key: apiKey,
      order: getOrderBy(filters.sortBy),
    });

    const publishedAfter = getPublishedAfter(filters.uploadDate);
    if (publishedAfter) {
      params.set("publishedAfter", publishedAfter);
    }

    const videoDuration = getVideoDuration(filters.duration);
    if (videoDuration) {
      params.set("videoDuration", videoDuration);
    }

    const searchUrl = `${BASE_URL}/search?${params}`;
    const searchData = (await fetchYouTubeJson(searchUrl, "search", overallController.signal)) as YouTubeSearchApiResponse;
    const retrievedAt = new Date().toISOString();
    const warnings: ResearchWarning[] = [];
    if (!Array.isArray(searchData.items)) {
      throw new ProviderError({
        message: "YouTube returned an invalid search response.",
        category: "invalid_response",
        code: "YOUTUBE_INVALID_RESPONSE",
        status: 502,
        retryable: false,
      });
    }

    if (searchData.items.length === 0) {
      const orderedVideoIds: string[] = [];
      return validateSearchResponse({
        videos: [],
        totalResults: 0,
        resultsPerPage: 0,
        regionCode: stringValue(searchData.regionCode),
        snapshotId: createSnapshotId(filters, orderedVideoIds),
        retrievedAt,
        totalResultsIsApproximate: true,
        provenance: successfulProvenance(filters, orderedVideoIds),
        enrichment: {
          search: { status: "complete", requested: filters.maxResults, returned: 0 },
          videoDetails: { status: "skipped", requested: 0, returned: 0 },
          channels: { status: "skipped", requested: 0, returned: 0 },
        },
        warnings,
      });
    }

    let orderedVideoIds: string[] = [];
    for (const item of searchData.items) {
      const id = stringValue(item.id?.videoId);
      if (id) orderedVideoIds.push(id);
    }
    if (orderedVideoIds.length !== searchData.items.length) {
      warnings.push({
        code: "SEARCH_ITEMS_OMITTED",
        stage: "search",
        message: "Some search rows did not contain a public video identifier and were omitted.",
      });
    }
    orderedVideoIds = orderedVideoIds.slice(0, 50);
    if (orderedVideoIds.length === 0) {
      return validateSearchResponse({
        videos: [],
        totalResults: parseOptionalCount(searchData.pageInfo?.totalResults) ?? 0,
        resultsPerPage: parseOptionalCount(searchData.pageInfo?.resultsPerPage) ?? 0,
        regionCode: stringValue(searchData.regionCode),
        snapshotId: createSnapshotId(filters, orderedVideoIds),
        retrievedAt,
        totalResultsIsApproximate: true,
        provenance: successfulProvenance(filters, orderedVideoIds),
        enrichment: {
          search: { status: "partial", requested: filters.maxResults, returned: 0 },
          videoDetails: { status: "skipped", requested: 0, returned: 0 },
          channels: { status: "skipped", requested: 0, returned: 0 },
        },
        warnings,
      });
    }

    const detailsParams = new URLSearchParams({
      part: "snippet,statistics,contentDetails,status,topicDetails,paidProductPlacementDetails,liveStreamingDetails",
      id: orderedVideoIds.join(","),
      key: apiKey,
    });

    const detailsUrl = `${BASE_URL}/videos?${detailsParams}`;
    console.log(
      `[youtube] Video details request: ${orderedVideoIds.length} ids; part=${detailsParams.get("part")}; ids=${orderedVideoIds.join(",")}`
    );
    const detailsData = (await fetchYouTubeJson(detailsUrl, "video details", overallController.signal)) as YouTubeVideoDetailsResponse;
    if (!Array.isArray(detailsData.items)) {
      throw new ProviderError({
        message: "YouTube returned an invalid video-details response.",
        category: "invalid_response",
        code: "YOUTUBE_INVALID_RESPONSE",
        status: 502,
        retryable: false,
      });
    }
    if (detailsData.items.length !== orderedVideoIds.length) {
      warnings.push({
        code: "VIDEO_DETAILS_PARTIAL",
        stage: "video_details",
        message: "Some search results no longer had public video details and were omitted.",
      });
    }
    const channelIds = Array.from(new Set(
      detailsData.items
        .map((item) => channelIdOf(item))
        .filter((id): id is string => typeof id === "string"),
    ));

    const channelDetails = new Map<string, YouTubeChannelItem>();
    let channelStatus: "complete" | "partial" | "skipped" = channelIds.length > 0 ? "complete" : "skipped";
    if (channelIds.length > 0) {
      const channelParams = new URLSearchParams({
        part: "snippet,statistics,topicDetails,brandingSettings",
        id: channelIds.join(","),
        maxResults: "50",
        key: apiKey,
      });

      try {
        const channelData = (await fetchYouTubeJson(
          `${BASE_URL}/channels?${channelParams}`,
          "channel enrichment",
          overallController.signal,
        )) as YouTubeChannelResponse;
        for (const channel of Array.isArray(channelData.items) ? channelData.items : []) {
          const id = stringValue(channel.id);
          if (id) channelDetails.set(id, channel);
        }
        if (channelDetails.size !== channelIds.length) channelStatus = "partial";
      } catch {
        channelStatus = "partial";
      }
      if (channelStatus === "partial") {
        warnings.push({
          code: "CHANNEL_ENRICHMENT_PARTIAL",
          stage: "channel_enrichment",
          message: "Channel-level public metadata was unavailable for some or all videos.",
        });
      }
    }

    const detailsById = new Map<string, YouTubeVideoDetailsItem>();
    for (const item of detailsData.items) {
      const id = stringValue(item.id);
      if (id) detailsById.set(id, item);
    }

    const videos: Video[] = [];
    for (const id of orderedVideoIds) {
      const item = detailsById.get(id);
      if (!item) continue;
      try {
        const candidate = mapVideoFromDetails(item, channelDetails);
        const parsed = videoSchema.safeParse(candidate);
        if (!parsed.success) {
          warnings.push({
            code: "VIDEO_ITEM_INVALID",
            stage: "video_details",
            message: "A public video row could not be normalized and was omitted.",
          });
          continue;
        }
        videos.push(parsed.data);
      } catch {
        warnings.push({
          code: "VIDEO_ITEM_INVALID",
          stage: "video_details",
          message: "A public video row could not be normalized and was omitted.",
        });
      }
    }

    return validateSearchResponse({
      videos,
      totalResults: parseOptionalCount(searchData.pageInfo?.totalResults) || videos.length,
      nextPageToken: stringValue(searchData.nextPageToken),
      resultsPerPage: parseOptionalCount(searchData.pageInfo?.resultsPerPage) || videos.length,
      regionCode: stringValue(searchData.regionCode),
      snapshotId: createSnapshotId(filters, orderedVideoIds),
      retrievedAt,
      totalResultsIsApproximate: true,
      provenance: successfulProvenance(filters, orderedVideoIds),
      enrichment: {
        search: { status: "complete", requested: filters.maxResults, returned: orderedVideoIds.length },
        videoDetails: {
          status: detailsData.items.length === orderedVideoIds.length ? "complete" : "partial",
          requested: orderedVideoIds.length,
          returned: detailsData.items.length,
        },
        channels: {
          status: channelStatus,
          requested: channelIds.length,
          returned: channelDetails.size,
        },
      },
      warnings,
    });
  } finally {
    clearTimeout(overallTimer);
  }
}