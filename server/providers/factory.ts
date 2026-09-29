import type { ImageAIProvider, TextAIProvider } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { PollinationsProvider } from "./pollinations-provider";

/**
 * Configuration passed from settings layer (server/settings.ts) to create a text provider.
 * Only the fields needed for instantiation are listed; server/settings.ts can map
 * from its internal shape to this.
 */
export interface TextProviderConfig {
  /** "gemini" or "openai-compatible" (or any future key) */
  provider: string;
  /** API key for the selected provider */
  apiKey: string;
  /** Base URL (only used for openai-compatible) */
  baseUrl?: string;
  /** Model id (e.g. "gemini-3.7-flash" or "anthropic/claude-3-5-sonnet") */
  model: string;
}

/**
 * Config passed from settings layer (server/settings.ts) to create an image provider.
 */
export interface ImageProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

/**
 * Create a TextAIProvider instance based on config.
 * Throws if provider key is unknown.
 */
export function createTextProvider(config: TextProviderConfig): TextAIProvider {
  switch (config.provider) {
    case "gemini":
      return new GeminiProvider({ apiKey: config.apiKey });
    case "openai-compatible":
      if (!config.baseUrl) {
        throw new Error("OpenAI-compatible text provider requires baseUrl in config.");
      }
      return new OpenAICompatibleProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      });
    default:
      throw new Error(
        `Unsupported text provider "${config.provider}". Supported: gemini, openai-compatible.`
      );
  }
}

/**
 * Create an ImageAIProvider instance based on config.
 * Throws if provider key is unknown.
 */
export function createImageProvider(config: ImageProviderConfig): ImageAIProvider {
  switch (config.provider) {
    case "gemini":
      return new GeminiProvider({ apiKey: config.apiKey });
    case "openai-compatible":
      if (!config.baseUrl) {
        throw new Error("OpenAI-compatible image provider requires baseUrl in config.");
      }
      return new OpenAICompatibleProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      });
    case "pollinations":
      return new PollinationsProvider();
    default:
      throw new Error(
        `Unsupported image provider "${config.provider}". Supported: gemini, openai-compatible, pollinations.`
      );
  }
}