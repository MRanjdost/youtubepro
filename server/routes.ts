/**
 * HTTP layer: registers every /api endpoint with rate limiting, Zod request
 * validation, and normalized provider-error responses.
 */
import type { Express } from "express";
import type { Server } from "http";
import { searchVideos } from "./youtube";
import { buildSectionRegenerationPrompt, buildParagraphRegenerationPrompt } from "./gemini";
import { generateThumbnailSuggestionsWithProvider, regenerateTitlesWithProvider, regenerateScriptContentWithProvider, extractNarrationTextWithProvider, generateIdeasWithProvider, generateResearchInsightsWithProvider, generateScriptWithProvider, generateThumbnailWithProvider } from "./providers/resolve";
import { ideaGenerationRequestSchema, researchInsightsRequestSchema, searchFiltersSchema, scriptInputSchema } from "@shared/schema";
import { z } from "zod";
import { apiKeySettingsSchema, getApiKeyStatus, isLocalSettingsRequest, saveApiKeySettings } from "./settings";
import { normalizeProviderError, providerErrorPayload } from "./provider-errors";
import { thumbnailGenerationRequestSchema, thumbnailSuggestionsRequestSchema } from "./thumbnail-contract";
import {
  paragraphRegenerationRequestSchema,
  sectionRegenerationRequestSchema,
} from "./script-regeneration-contract";
import {
  narrationExtractionRequestSchema,
  titleRegenerationRequestSchema,
} from "./api-contracts";
import { createRateLimiter } from "./rate-limit";

const { middleware: rateLimit } = createRateLimiter();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/settings/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLocalSettingsRequest(req)) {
      return res.status(403).json({ error: "Settings are available only from this machine." });
    }
    return res.json(getApiKeyStatus());
  });

  app.put("/api/settings/api-keys", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLocalSettingsRequest(req)) {
      return res.status(403).json({ error: "Settings are available only from this machine." });
    }

    try {
      const input = apiKeySettingsSchema.parse(req.body);
      const status = await saveApiKeySettings(input);
      return res.json({ success: true, status });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid API settings", details: error.errors });
      }
      console.error("Failed to save API keys:", error);
      return res.status(500).json({ error: "Failed to save API keys" });
    }
  });

  app.get("/api/youtube/search", rateLimit, async (req, res) => {
    try {
      const { query, uploadDate, duration, sortBy, maxResults } = req.query;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      const filters = searchFiltersSchema.parse({
        query,
        uploadDate: uploadDate || "any",
        duration: duration || "any",
        sortBy: sortBy || "relevance",
        maxResults: maxResults ? parseInt(maxResults as string, 10) : 25,
      });

      const result = await searchVideos(filters);
      res.json(result);
    } catch (error: unknown) {
      console.error("YouTube search error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid search parameters", details: error.errors });
      }
      const providerError = normalizeProviderError(error, "youtube");
      res.status(providerError.status).json(providerErrorPayload(providerError, "YouTube Data API"));
    }
  });

  app.post("/api/script/generate", rateLimit, async (req, res) => {
    try {
      const input = scriptInputSchema.parse(req.body);
      const result = await generateScriptWithProvider(input);
      res.json(result);
    } catch (error: unknown) {
      console.error("Script generation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid script input", details: error.errors });
      }
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Script generation"));
    }
  });

  app.post("/api/script/extract-narration", rateLimit, async (req, res) => {
    try {
      const { scriptContent } = narrationExtractionRequestSchema.parse(req.body);
      const narration = await extractNarrationTextWithProvider(scriptContent);
      res.json({ narration });
    } catch (error: unknown) {
      console.error("Narration extraction error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid narration extraction request", details: error.errors });
      }
      const providerError = normalizeProviderError(error, "gemini");
      res.status(providerError.status).json(providerErrorPayload(providerError, "Gemini narration extraction"));
    }
  });

  app.post("/api/ideas/generate", rateLimit, async (req, res) => {
    try {
      const parsed = ideaGenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid grounded idea request", details: parsed.error.errors });
      }

      const result = await generateIdeasWithProvider(parsed.data);
      res.json(result);
    } catch (error: unknown) {
      console.error("Ideas generation error:", error);
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Gemini Ideas"));
    }
  });

  app.post("/api/research/insights", rateLimit, async (req, res) => {
    try {
      const parsed = researchInsightsRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "A query and between 1 and 50 valid videos are required.",
          code: "RESEARCH_REQUEST_INVALID",
          details: parsed.error.errors,
        });
      }

      const result = await generateResearchInsightsWithProvider(parsed.data);
      res.json(result);
    } catch (error: unknown) {
      console.error("Research insights error:", error);
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Gemini research"));
    }
  });

  app.post("/api/script/regenerate-titles", rateLimit, async (req, res) => {
    try {
      const { topic, format, audience, evidenceContext } = titleRegenerationRequestSchema.parse(req.body);
      const titles = await regenerateTitlesWithProvider({
        topic,
        format,
        audience,
        evidenceContext,
      });
      res.json({ titles });
    } catch (error: unknown) {
      console.error("Title regeneration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid title regeneration request", details: error.errors });
      }
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Title regeneration"));
    }
  });

  app.post("/api/script/regenerate-section", rateLimit, async (req, res) => {
    try {
      const parsed = sectionRegenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid section regeneration request",
          code: "SCRIPT_SECTION_REGENERATION_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Keep the current section and review its topic, format, audience, and evidence context.",
          details: parsed.error.flatten(),
        });
      }

      const result = await regenerateScriptContentWithProvider({
        prompt: buildSectionRegenerationPrompt(parsed.data),
        evidenceContext: parsed.data.evidenceContext,
      }, "section");
      res.json(result);
    } catch (error: unknown) {
      console.error("Section regeneration error:", error);
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Gemini section regeneration"));
    }
  });

  app.post("/api/script/regenerate-paragraph", rateLimit, async (req, res) => {
    try {
      const parsed = paragraphRegenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid paragraph regeneration request",
          code: "SCRIPT_PARAGRAPH_REGENERATION_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Keep the current paragraph and review its section, topic, format, audience, and evidence context.",
          details: parsed.error.flatten(),
        });
      }

      const result = await regenerateScriptContentWithProvider({
        prompt: buildParagraphRegenerationPrompt(parsed.data),
        evidenceContext: parsed.data.evidenceContext,
      }, "paragraph");
      res.json(result);
    } catch (error: unknown) {
      console.error("Paragraph regeneration error:", error);
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Gemini paragraph regeneration"));
    }
  });

  app.post("/api/thumbnail/generate", rateLimit, async (req, res) => {
    try {
      const parsed = thumbnailGenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid thumbnail generation request",
          code: "THUMBNAIL_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Review the thumbnail fields and reference image requirements, then try again.",
          details: parsed.error.flatten(),
        });
      }

      const { topic, provider, ...config } = parsed.data;
      const result = await generateThumbnailWithProvider(topic, config, provider);
      res.json(result);
    } catch (error: unknown) {
      console.error("Thumbnail generation error:", error);
      const normalized = normalizeProviderError(error, "gemini");
      return res.status(normalized.status).json(providerErrorPayload(normalized, "Gemini image generation"));
    }
  });

  app.post("/api/thumbnail/suggestions", rateLimit, async (req, res) => {
    try {
      const parsed = thumbnailSuggestionsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid thumbnail suggestions request",
          code: "THUMBNAIL_SUGGESTIONS_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Add a valid topic and shorten any supplied idea context.",
          details: parsed.error.flatten(),
        });
      }

      const suggestions = await generateThumbnailSuggestionsWithProvider(parsed.data);
      res.json({ suggestions });
    } catch (error: unknown) {
      console.error("Thumbnail suggestions error:", error);
      const providerError = normalizeProviderError(error, "gemini");
      res.status(providerError.status).json(providerErrorPayload(providerError, "Gemini thumbnail suggestions"));
    }
  });

  return httpServer;
}
