/**
 * Provider resolution layer: picks Gemini or OpenAI-compatible providers from
 * settings and wraps every AI operation with normalized ProviderError codes.
 */
import { createTextProvider, createImageProvider } from "./factory";
import type { TextAIProvider, ImageAIProvider } from "./types";
import { getApiKeyStatus } from "../settings";
import { ProviderError } from "../provider-errors";
import type {
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  ResearchInsightsRequest,
  ResearchInsightsResponse,
  TargetAudience,
  ScriptEvidenceContext,
  ScriptInput,
  ScriptResult,
} from "@shared/schema";
import { VideoFormat } from "@shared/schema";
import type { ScriptRegenerationOutput } from "../script-regeneration-contract";
import { parseScriptRegenerationOutput } from "../script-regeneration-contract";
import {
  buildThumbnailSuggestionsPrompt,
  parseThumbnailSuggestions,
  buildTitleRegenerationPrompt,
  parseTitleRegeneration,
  buildNarrationExtractionPrompt,
  buildIdeaGenerationPrompt,
  parseIdeaGenerationOutput,
  buildResearchInsightsPrompt,
  parseResearchInsightsResponse,
  buildScriptGenerationPrompt,
  parseScriptGenerationOutput,
} from "../gemini";
import { buildThumbnailPrompt } from "../gemini";
import { buildPollinationsThumbnailPrompt, hasNonLatinScript, translateToEnglishVisualSubject } from "./pollinations-prompt";
import type { ThumbnailConfig, ThumbnailResult } from "../gemini";

export function resolveTextProvider(): { provider: TextAIProvider; model: string } {
  const status = getApiKeyStatus();
  const hasCustom = Boolean(status.customTextProvider) && status.customTextProvider !== "gemini";

  if (hasCustom) {
    if (!status.customTextBaseUrl) {
      throw new Error("Custom text base URL is required when provider is not gemini.");
    }
    if (!status.customTextApiKey) {
      throw new Error("Custom text API key is required when provider is not gemini.");
    }
    const model = status.customTextModel || status.models.text;
    return {
      provider: createTextProvider({
        provider: "openai-compatible",
        baseUrl: status.customTextBaseUrl,
        apiKey: (process.env.CUSTOM_TEXT_API_KEY || "").trim(),
        model,
      }),
      model,
    };
  }

  if (!status.gemini) {
    throw new Error("Gemini API key is not configured");
  }
  const model = status.models.text;
  return {
    provider: createTextProvider({
      provider: "gemini",
      apiKey: (process.env.GEMINI_API_KEY || "").trim(),
      model,
    }),
    model,
  };
}

function isCustomTextProvider(): boolean {
  const value = process.env.CUSTOM_TEXT_PROVIDER;
  return Boolean(value) && value !== "gemini";
}

/**
 * Walks the error cause chain looking for a quota failure (429,
 * RESOURCE_EXHAUSTED, or quota/rate-limit text). Shared by the text and image
 * paths so genuine quota failures surface as 429 + category "quota" while the
 * fixed error codes are preserved.
 */
function isQuotaError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: { status?: number | string; message?: string; cause?: unknown } | undefined = error as {
    status?: number | string;
    message?: string;
    cause?: unknown;
  };
  for (let depth = 0; depth < 4 && current; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const status = Number(current.status) || 0;
    const message = `${current.message || ""}`;
    if (status === 429 || /429|quota|resource_exhausted|rate.?limit/i.test(message)) {
      return true;
    }
    current = current.cause as { status?: number | string; message?: string; cause?: unknown } | undefined;
  }
  return false;
}

interface CallTextProviderAndParseOptions<T> {
  provider: TextAIProvider;
  prompt: string;
  model: string;
  providerName: "gemini" | "custom";
  contextLabel: string;
  errorCodes: {
    providerFailure: string;
    invalidResponse: string;
  };
  parse: (text: string) => T;
  jsonMode?: boolean;
}

/**
 * Shared generate-then-parse pipeline for every text endpoint in this file.
 * Provider-side errors become ProviderError{provider_server, retryable:true};
 * parse failures become ProviderError{invalid_response, retryable:false}.
 * Existing error codes are preserved unchanged.
 */
async function callTextProviderAndParse<T>(options: CallTextProviderAndParseOptions<T>): Promise<T> {
  const { provider, prompt, model, providerName, contextLabel, errorCodes, parse, jsonMode } = options;
  const isGemini = providerName === "gemini";

  let text: string;
  try {
    const response = await provider.generate({ prompt, model, ...(jsonMode ? { jsonMode } : {}) });
    text = response.text || "";
  } catch (error: unknown) {
    if (error instanceof ProviderError) throw error;
    const quota = isQuotaError(error);
    throw new ProviderError({
      message: quota
        ? error instanceof Error ? error.message : "Quota exceeded for the provider"
        : isGemini
          ? `Gemini ${contextLabel} failed`
          : "Custom text provider failed",
      category: quota ? "quota" : "provider_server",
      code: errorCodes.providerFailure,
      status: quota ? 429 : 502,
      retryable: true,
      cause: error,
    });
  }

  try {
    return parse(text);
  } catch (error: unknown) {
    throw new ProviderError({
      message: isGemini
        ? `Gemini ${contextLabel} returned an invalid response`
        : "Custom text provider returned an invalid response",
      category: "invalid_response",
      code: errorCodes.invalidResponse,
      status: 502,
      retryable: false,
      cause: error,
    });
  }
}

export async function generateThumbnailSuggestionsWithProvider(
  request: { topic: string; ideaContext?: string },
): Promise<string[]> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildThumbnailSuggestionsPrompt(request);
  const isGemini = !isCustomTextProvider();

  return callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "thumbnail suggestions",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_THUMBNAIL_SUGGESTIONS_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_THUMBNAIL_SUGGESTIONS_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_THUMBNAIL_SUGGESTIONS_INVALID"
        : "CUSTOM_TEXT_THUMBNAIL_SUGGESTIONS_INVALID",
    },
    parse: (text) => parseThumbnailSuggestions(text),
  });
}

interface TitleRegenerationRequest {
  topic: string;
  format: VideoFormat;
  audience: TargetAudience;
  evidenceContext?: ScriptEvidenceContext;
}

export async function regenerateTitlesWithProvider(
  request: TitleRegenerationRequest,
): Promise<string[]> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildTitleRegenerationPrompt({
    topic: request.topic,
    format: request.format,
    audience: request.audience,
    evidenceContext: request.evidenceContext,
  });
  const isGemini = !isCustomTextProvider();

  return callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "title regeneration",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_TITLE_REGENERATION_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_TITLE_REGENERATION_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_TITLE_REGENERATION_INVALID"
        : "CUSTOM_TEXT_TITLE_REGENERATION_INVALID",
    },
    parse: (text) => parseTitleRegeneration(text),
  });
}

interface RegenerateScriptContentRequest {
  prompt: string;
  evidenceContext?: ScriptEvidenceContext;
}

/**
 * پارامتری‌شده مشترک برای regenerate-section و regenerate-paragraph.
 * caller خودش prompt را می‌سازد (چون section و paragraph prompt متفاوتند)،
 * اما provider resolution و parse/wrap خطا مشترک است.
 */
export async function regenerateScriptContentWithProvider(
  request: RegenerateScriptContentRequest,
  endpointLabel: "section" | "paragraph",
): Promise<ScriptRegenerationOutput> {
  const { provider, model } = resolveTextProvider();
  const prefix = endpointLabel === "section" ? "SECTION" : "PARAGRAPH";
  const isGemini = !isCustomTextProvider();

  return callTextProviderAndParse({
    provider,
    prompt: request.prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: `${endpointLabel} regeneration`,
    errorCodes: {
      providerFailure: isGemini
        ? `GEMINI_${prefix}_REGENERATION_PROVIDER_FAILURE`
        : `CUSTOM_TEXT_${prefix}_REGENERATION_PROVIDER_FAILURE`,
      invalidResponse: isGemini
        ? `GEMINI_${prefix}_REGENERATION_INVALID`
        : `CUSTOM_TEXT_${prefix}_REGENERATION_INVALID`,
    },
    parse: (text) => parseScriptRegenerationOutput(text, request.evidenceContext),
  });
}

export async function extractNarrationTextWithProvider(
  scriptContent: string,
): Promise<string> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildNarrationExtractionPrompt(scriptContent);
  const isGemini = !isCustomTextProvider();

  return callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "narration extraction",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_NARRATION_EXTRACTION_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_NARRATION_EXTRACTION_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_NARRATION_EXTRACTION_INVALID"
        : "CUSTOM_TEXT_NARRATION_EXTRACTION_INVALID",
    },
    parse: (text) => text.trim(),
  });
}

export async function generateIdeasWithProvider(
  request: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildIdeaGenerationPrompt(request);
  const isGemini = !isCustomTextProvider();

  const parsed = await callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "idea generation",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_IDEA_GENERATION_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_IDEA_GENERATION_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_IDEA_GENERATION_INVALID"
        : "CUSTOM_TEXT_IDEA_GENERATION_INVALID",
    },
    parse: (text) => parseIdeaGenerationOutput(text, request),
    jsonMode: true,
  });

  return {
    ideas: parsed.ideas,
    niche: request.niche,
    generatedAt: new Date().toISOString(),
    snapshotId: request.researchContext.snapshotId,
  };
}

export async function generateResearchInsightsWithProvider(
  request: ResearchInsightsRequest,
): Promise<ResearchInsightsResponse> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildResearchInsightsPrompt(request);
  const isGemini = !isCustomTextProvider();

  return callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "research insights",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_RESEARCH_INSIGHTS_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_RESEARCH_INSIGHTS_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_RESEARCH_INSIGHTS_INVALID"
        : "CUSTOM_TEXT_RESEARCH_INSIGHTS_INVALID",
    },
    parse: (text) => parseResearchInsightsResponse(
      text,
      request.snapshotId,
      request.videos.length,
      new Date().toISOString(),
      request.provenance?.orderedVideoIds,
    ),
    jsonMode: true,
  });
}

export async function generateScriptWithProvider(input: ScriptInput): Promise<ScriptResult> {
  const { provider, model } = resolveTextProvider();
  const prompt = buildScriptGenerationPrompt(input);
  const isGemini = !isCustomTextProvider();

  const parsed = await callTextProviderAndParse({
    provider,
    prompt,
    model,
    providerName: isGemini ? "gemini" : "custom",
    contextLabel: "script generation",
    errorCodes: {
      providerFailure: isGemini
        ? "GEMINI_SCRIPT_GENERATION_PROVIDER_FAILURE"
        : "CUSTOM_TEXT_SCRIPT_GENERATION_PROVIDER_FAILURE",
      invalidResponse: isGemini
        ? "GEMINI_SCRIPT_GENERATION_INVALID"
        : "CUSTOM_TEXT_SCRIPT_GENERATION_INVALID",
    },
    parse: (text) => parseScriptGenerationOutput(text),
    jsonMode: true,
  });

  const scriptContent = parsed.script;
  const wordCount = scriptContent.split(/\s+/).length;
  const wordsPerMinute = input.format === VideoFormat.SHORT ? 180 : 150;
  const minutes = Math.round(wordCount / wordsPerMinute);
  let estimatedDuration: string;
  if (minutes < 1) estimatedDuration = "Under 1 minute";
  else if (minutes === 1) estimatedDuration = "~1 minute";
  else estimatedDuration = `~${minutes} minutes`;

  return {
    ...parsed,
    metadata: {
      wordCount,
      estimatedDuration,
      generatedAt: new Date().toISOString(),
    },
    evidenceContext: input.evidenceContext,
  };
}

export function resolveImageProvider(
  status: ReturnType<typeof getApiKeyStatus> = getApiKeyStatus(),
): { provider: ImageAIProvider; model: string } {
  const hasCustom = Boolean(status.customImageProvider) && status.customImageProvider !== "gemini";
  if (hasCustom) {
    const isPollinations = status.customImageProvider === "pollinations";
    if (!isPollinations) {
      if (!status.customImageBaseUrl) throw new Error("Custom image base URL is required when provider is not gemini.");
      if (!status.customImageApiKey) throw new Error("Custom image API key is required when provider is not gemini.");
    }
    const model = status.customImageModel || status.models.image;
    return {
      provider: createImageProvider({
        provider: status.customImageProvider || "gemini",
        baseUrl: isPollinations ? undefined : status.customImageBaseUrl || undefined,
        apiKey: isPollinations ? "" : (process.env.CUSTOM_IMAGE_API_KEY || "").trim(),
        model,
      }),
      model,
    };
  }
  if (!status.gemini) throw new Error("Gemini API key is not configured");
  const model = status.models.image;
  return {
    provider: createImageProvider({
      provider: "gemini",
      apiKey: (process.env.GEMINI_API_KEY || "").trim(),
      model,
    }),
    model,
  };
}

export async function generateThumbnailWithProvider(
  topic: string,
  config: ThumbnailConfig,
  providerOverride?: string,
): Promise<ThumbnailResult> {
  const status = getApiKeyStatus();
  const isCustom = providerOverride === "pollinations"
    || (Boolean(status.customImageProvider) && status.customImageProvider !== "gemini");
  // WHY: Pollinations flux/turbo are raw text-to-image models and cannot follow the long Gemini
  // instruction/rule template (which also gets truncated and produces anime-styled outputs). Whenever
  // Pollinations is the effective provider (request-level override or saved Settings provider), a
  // pure subject-first English description is built instead, with Persian/Arabic input translated
  // into a concrete English visual subject first because flux/turbo can only understand Latin script.
  // The Gemini path stays untouched.
  const willUsePollinations = providerOverride === "pollinations" || status.customImageProvider === "pollinations";
  let prompt: string;
  if (willUsePollinations) {
    const usesNonLatin = hasNonLatinScript(topic)
      || (Boolean(config.thumbnailDescription) && hasNonLatinScript(config.thumbnailDescription));
    let visualSubject: string;
    if (usesNonLatin) {
      // WHY: force an English concrete visual subject for Pollinations regardless of user language.
      try {
        const textProvider = resolveTextProvider();
        visualSubject = await translateToEnglishVisualSubject(
          topic,
          config.thumbnailDescription,
          textProvider.provider,
          textProvider.model,
        );
      } catch (error) {
        // WHY: if no text provider is configured the translation cannot run — fall back to the raw
        // topic so Pollinations generation still proceeds instead of failing the whole request.
        visualSubject = topic.trim();
        console.warn(`[pollinations] text provider unavailable, using original subject: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      visualSubject = topic.trim();
    }
    prompt = buildPollinationsThumbnailPrompt(visualSubject, config);
  } else {
    prompt = buildThumbnailPrompt(topic, config);
  }

  try {
    // WHY: the browser cannot reach image.pollinations.ai directly from restricted networks, so the
    // thumbnail page asks the backend to generate with Pollinations via provider:"pollinations".
    // Here we build that provider explicitly instead of reading the saved Settings image provider.
    const { provider, model } = providerOverride === "pollinations"
      ? {
          provider: createImageProvider({ provider: "pollinations", apiKey: "", model: "pollinations" }),
          model: "pollinations",
        }
      : resolveImageProvider(status);
    const referenceImages = config.referenceImages?.map((r) => r.image) ?? [];
    const res = await provider.generateImage({ prompt, model, aspectRatio: "16:9", referenceImages });
    return {
      imageData: `data:${res.mimeType};base64,${res.base64}`,
      prompt,
      model: res.model,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("did not contain image data")) {
      throw new ProviderError({
        message: isCustom
          ? "Custom image provider returned an invalid response"
          : "Gemini thumbnail generation returned an invalid response",
        category: "invalid_response",
        code: isCustom ? "CUSTOM_IMAGE_GENERATION_INVALID" : "GEMINI_IMAGE_INVALID_RESPONSE",
        status: 502,
        retryable: false,
        cause: error,
      });
    }
    const quota = isQuotaError(error);
    const classifiedCategory = (error as { category?: string }).category;
    const network = !quota && (classifiedCategory === "network" || classifiedCategory === "timeout" || classifiedCategory === "provider_server");
    throw new ProviderError({
      message: quota
        ? "Quota exceeded for the image provider"
        : network
          ? "Connection to the image provider failed"
          : isCustom ? "Custom image provider failed for thumbnail generation" : "Gemini thumbnail generation failed",
      category: quota ? "quota" : network ? "network" : "provider_server",
      code: isCustom ? "CUSTOM_IMAGE_GENERATION_PROVIDER_FAILURE" : "GEMINI_IMAGE_GENERATION_PROVIDER_FAILURE",
      status: quota ? 429 : 502,
      retryable: true,
      cause: error,
    });
  }
}