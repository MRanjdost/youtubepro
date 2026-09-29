/**
 * Local Settings: loopback-only status/key persistence to .env (or
 * SETTINGS_ENV_PATH), provider status aggregation, and model configuration.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import { z } from "zod";
import { configureGeminiApiKey, configureGeminiModels } from "./gemini";
import { applyGlobalProxy } from "./proxy";
import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_MODELS,
  geminiTextModelOptions,
  isGeminiImageModel,
  isGeminiTextModel,
  resolveGeminiTextModel,
  type GeminiImageModel,
} from "./gemini-models";

function getEnvPath() {
  return process.env.SETTINGS_ENV_PATH ? path.resolve(process.env.SETTINGS_ENV_PATH) : path.resolve(process.cwd(), ".env");
}
function getEnvTempPath() {
  return process.env.SETTINGS_ENV_PATH ? path.resolve(process.env.SETTINGS_ENV_PATH + ".tmp") : path.resolve(process.cwd(), ".env.tmp");
}
const SUPPORTED_KEYS = [
  "YOUTUBE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "GEMINI_IMAGE_MODEL",
  "CUSTOM_TEXT_PROVIDER",
  "CUSTOM_TEXT_BASE_URL",
  "CUSTOM_TEXT_API_KEY",
  "CUSTOM_TEXT_MODEL",
  "CUSTOM_IMAGE_PROVIDER",
  "CUSTOM_IMAGE_BASE_URL",
  "CUSTOM_IMAGE_API_KEY",
  "CUSTOM_IMAGE_MODEL",
  "HTTPS_PROXY",
] as const;

type SupportedKey = (typeof SUPPORTED_KEYS)[number];

export interface ApiKeySettings {
  youtubeApiKey?: string;
  geminiApiKey?: string;
  geminiTextModel?: string;
  geminiImageModel?: string;
  customTextProvider?: string;
  customTextBaseUrl?: string;
  customTextApiKey?: string;
  customTextModel?: string;
  customImageProvider?: string;
  customImageBaseUrl?: string;
  customImageApiKey?: string;
  customImageModel?: string;
  resetCustomText?: boolean;
  resetCustomImage?: boolean;
  httpsProxy?: string;
  resetProxy?: boolean;
}

export const apiKeySettingsSchema = z.object({
  youtubeApiKey: z.string().trim().min(8).max(512).optional(),
  geminiApiKey: z.string().trim().min(8).max(512).optional(),
  geminiTextModel: z.string().refine(isGeminiTextModel, "Select a supported Gemini text model.").optional(),
  geminiImageModel: z.string().refine(isGeminiImageModel, "Select a supported Gemini image model.").optional(),
  customTextProvider: z.enum(["gemini", "openai-compatible"]).optional(),
  customTextBaseUrl: z.string().trim().max(2_048).optional(),
  customTextApiKey: z.string().trim().min(8).max(512).optional(),
  customTextModel: z.string().trim().min(1).max(256).optional(),
  customImageProvider: z.enum(["gemini", "openai-compatible", "pollinations"]).optional(),
  customImageBaseUrl: z.string().trim().max(2_048).optional(),
  customImageApiKey: z.string().trim().min(8).max(512).optional(),
  customImageModel: z.string().trim().min(1).max(256).optional(),
  resetCustomText: z.boolean().optional(),
  resetCustomImage: z.boolean().optional(),
  httpsProxy: z.string().trim().max(2048).optional().transform((v) => (v === "" ? undefined : v)),
  resetProxy: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.customTextProvider && data.customTextProvider !== "gemini") {
    if (!data.customTextBaseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTextBaseUrl"],
        message: "Custom text base URL is required when provider is not gemini.",
      });
    } else {
      try {
        new URL(data.customTextBaseUrl);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customTextBaseUrl"],
          message: "Custom text base URL must be a valid URL.",
        });
      }
    }
    if (!data.customTextApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTextApiKey"],
        message: "Custom text API key is required when provider is not gemini.",
      });
    }
    if (!data.customTextModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTextModel"],
        message: "Custom text model is required when provider is not gemini.",
      });
    }
  }
  if (data.customImageProvider && data.customImageProvider !== "gemini" && data.customImageProvider !== "pollinations") {
    if (!data.customImageBaseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customImageBaseUrl"],
        message: "Custom image base URL is required when provider is not gemini.",
      });
    } else {
      try {
        new URL(data.customImageBaseUrl);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customImageBaseUrl"],
          message: "Custom image base URL must be a valid URL.",
        });
      }
    }
    if (!data.customImageApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customImageApiKey"],
        message: "Custom image API key is required when provider is not gemini.",
      });
    }
    if (!data.customImageModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customImageModel"],
        message: "Custom image model is required when provider is not gemini.",
      });
    }
  }
  if (data.httpsProxy !== undefined && data.httpsProxy.trim().length > 0) {
    try {
      new URL(data.httpsProxy);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["httpsProxy"],
        message: "Proxy URL must be a valid URL (e.g. http://127.0.0.1:10809).",
      });
    }
  } else if (data.httpsProxy !== undefined) {
    // whitespace-only is not a valid URL
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["httpsProxy"],
      message: "Proxy URL must be a valid URL (e.g. http://127.0.0.1:10809).",
    });
  }
});

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1"
    || address === "::1"
    || address.startsWith("::ffff:127.");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export interface LocalSettingsRequestMetadata {
  remoteAddress?: string;
  host?: string;
  origin?: string;
  forwarded?: string;
  xForwardedFor?: string;
  xForwardedHost?: string;
  xForwardedProto?: string;
  via?: string;
  secFetchSite?: string;
}

export function isTrustedLocalSettingsMetadata(input: LocalSettingsRequestMetadata): boolean {
  if (!isLoopbackAddress(input.remoteAddress)) return false;
  if (
    input.forwarded
    || input.xForwardedFor
    || input.xForwardedHost
    || input.xForwardedProto
    || input.via
  ) return false;

  if (!input.host) return false;
  if (/[@/\\\s%]/.test(input.host)) return false;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${input.host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;

  if (input.origin) {
    try {
      const origin = new URL(input.origin);
      if (
        !["http:", "https:"].includes(origin.protocol)
        || !isLoopbackHostname(origin.hostname)
        || origin.host !== hostUrl.host
      ) return false;
    } catch {
      return false;
    }
  }

  return !input.secFetchSite || input.secFetchSite === "same-origin" || input.secFetchSite === "none";
}

export function isLocalSettingsRequest(req: Request): boolean {
  return isTrustedLocalSettingsMetadata({
    remoteAddress: req.socket.remoteAddress,
    host: req.get("host"),
    origin: req.get("origin"),
    forwarded: req.get("forwarded"),
    xForwardedFor: req.get("x-forwarded-for"),
    xForwardedHost: req.get("x-forwarded-host"),
    xForwardedProto: req.get("x-forwarded-proto"),
    via: req.get("via"),
    secFetchSite: req.get("sec-fetch-site"),
  });
}

// Legacy env files used "openrouter" before the provider key was unified to
// "openai-compatible". Normalize once at the env entry point so the rest of
// the app only ever sees the canonical key.
function normalizeLegacyProviderKey(value: string | undefined): string | undefined {
  return value === "openrouter" ? "openai-compatible" : value;
}

export function getApiKeyStatus() {
  const textModel = resolveGeminiTextModel(process.env.GEMINI_TEXT_MODEL);
  const imageModel = isGeminiImageModel(process.env.GEMINI_IMAGE_MODEL || "")
    ? process.env.GEMINI_IMAGE_MODEL as GeminiImageModel
    : DEFAULT_GEMINI_IMAGE_MODEL;

  return {
    youtube: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    customTextProvider: normalizeLegacyProviderKey(process.env.CUSTOM_TEXT_PROVIDER),
    customTextBaseUrl: process.env.CUSTOM_TEXT_BASE_URL || undefined,
    customTextApiKey: Boolean(process.env.CUSTOM_TEXT_API_KEY?.trim()),
    customTextModel: process.env.CUSTOM_TEXT_MODEL || undefined,
    customImageProvider: normalizeLegacyProviderKey(process.env.CUSTOM_IMAGE_PROVIDER),
    customImageBaseUrl: process.env.CUSTOM_IMAGE_BASE_URL || undefined,
    customImageApiKey: Boolean(process.env.CUSTOM_IMAGE_API_KEY?.trim()),
    customImageModel: process.env.CUSTOM_IMAGE_MODEL || undefined,
    httpsProxy: process.env.HTTPS_PROXY || undefined,
    hasProxy: Boolean(process.env.HTTPS_PROXY?.trim()),
    models: {
      text: textModel,
      image: imageModel,
      textOptions: geminiTextModelOptions(),
      imageOptions: GEMINI_IMAGE_MODELS,
    },
  };
}

function validateApiKey(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length < 8 || trimmed.length > 512) {
    throw new Error(`${label} must be between 8 and 512 characters.`);
  }
  if (/\r|\n|\0/.test(trimmed)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return trimmed;
}

function removeEnvKey(contents: string, key: string): string {
  return contents.split(/\r?\n/).filter((line) => !line.startsWith(`${key}=`)).join("\n").replace(/\n+$/, "") + "\n";
}

function setEnvValue(contents: string, key: SupportedKey, value: string): string {
  const assignment = `${key}=${JSON.stringify(value)}`;
  const lines = contents.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (lineIndex >= 0) {
    lines[lineIndex] = assignment;
  } else {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(assignment);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

let saveMutex: Promise<unknown> = Promise.resolve();

export function saveApiKeySettings(input: ApiKeySettings): ReturnType<typeof saveApiKeySettingsUnlocked> {
  const run = saveMutex.then(() => saveApiKeySettingsUnlocked(input));
  saveMutex = run.catch(() => undefined);
  return run;
}

async function saveApiKeySettingsUnlocked(input: ApiKeySettings) {
  const youtubeApiKey = validateApiKey(input.youtubeApiKey, "YouTube API key");
  const geminiApiKey = validateApiKey(input.geminiApiKey, "Gemini API key");
  const customTextApiKey = validateApiKey(input.customTextApiKey, "Custom text API key");
  const customImageApiKey = validateApiKey(input.customImageApiKey, "Custom image API key");
  const currentStatus = getApiKeyStatus();
  const textModel = input.geminiTextModel !== undefined
    ? resolveGeminiTextModel(input.geminiTextModel)
    : currentStatus.models.text;
  const imageModel = input.geminiImageModel ?? currentStatus.models.image;

  const resetText = input.resetCustomText === true;
  const resetImage = input.resetCustomImage === true;
  const resetProxy = input.resetProxy === true;

  if (resetText) {
    input.customTextProvider = "gemini";
    input.customTextBaseUrl = undefined;
    input.customTextApiKey = undefined;
    input.customTextModel = undefined;
  }
  if (resetImage) {
    input.customImageProvider = "gemini";
    input.customImageBaseUrl = undefined;
    input.customImageApiKey = undefined;
    input.customImageModel = undefined;
  }

  const hasNewCustomText = input.customTextProvider !== undefined || input.customTextBaseUrl !== undefined || input.customTextApiKey !== undefined || input.customTextModel !== undefined;
  const hasNewCustomImage = input.customImageProvider !== undefined || input.customImageBaseUrl !== undefined || input.customImageApiKey !== undefined || input.customImageModel !== undefined;

  const hasAnyCustom = input.customTextProvider || input.customImageProvider || customTextApiKey || customImageApiKey;

  if (!youtubeApiKey && !geminiApiKey && !hasAnyCustom
    && input.geminiTextModel === undefined && input.geminiImageModel === undefined
    && !hasNewCustomText && !hasNewCustomImage
    && !resetText && !resetImage && !resetProxy && input.httpsProxy === undefined) {
    throw new Error("Enter a replacement key or select a model to save.");
  }

  if (!textModel || !isGeminiTextModel(textModel)) {
    throw new Error("Select a supported Gemini text model.");
  }
  if (!isGeminiImageModel(imageModel)) {
    throw new Error("Select a supported Gemini image model.");
  }

  const envPath = getEnvPath();
  const envTempPath = getEnvTempPath();
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (youtubeApiKey) {
    contents = setEnvValue(contents, "YOUTUBE_API_KEY", youtubeApiKey);
  }
  if (geminiApiKey) {
    contents = setEnvValue(contents, "GEMINI_API_KEY", geminiApiKey);
  }
  if (resetText) {
    contents = removeEnvKey(contents, "CUSTOM_TEXT_PROVIDER");
    contents = removeEnvKey(contents, "CUSTOM_TEXT_BASE_URL");
    contents = removeEnvKey(contents, "CUSTOM_TEXT_API_KEY");
    contents = removeEnvKey(contents, "CUSTOM_TEXT_MODEL");
    contents = setEnvValue(contents, "CUSTOM_TEXT_PROVIDER", "gemini");
  }
  if (resetImage) {
    contents = removeEnvKey(contents, "CUSTOM_IMAGE_PROVIDER");
    contents = removeEnvKey(contents, "CUSTOM_IMAGE_BASE_URL");
    contents = removeEnvKey(contents, "CUSTOM_IMAGE_API_KEY");
    contents = removeEnvKey(contents, "CUSTOM_IMAGE_MODEL");
    contents = setEnvValue(contents, "CUSTOM_IMAGE_PROVIDER" as SupportedKey, "gemini");
  }
  if (textModel !== undefined) {
    contents = setEnvValue(contents, "GEMINI_TEXT_MODEL", textModel);
  }
  if (imageModel !== undefined) {
    contents = setEnvValue(contents, "GEMINI_IMAGE_MODEL", imageModel);
  }

  if (input.customTextProvider !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_TEXT_PROVIDER", input.customTextProvider);
  }
  if (input.customTextBaseUrl !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_TEXT_BASE_URL", input.customTextBaseUrl);
  }
  if (customTextApiKey) {
    contents = setEnvValue(contents, "CUSTOM_TEXT_API_KEY", customTextApiKey);
  }
  if (input.customTextModel !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_TEXT_MODEL", input.customTextModel);
  }

  if (input.customImageProvider !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_IMAGE_PROVIDER", input.customImageProvider);
  }
  if (input.customImageBaseUrl !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_IMAGE_BASE_URL", input.customImageBaseUrl);
  }
  if (customImageApiKey) {
    contents = setEnvValue(contents, "CUSTOM_IMAGE_API_KEY", customImageApiKey);
  }
  if (input.customImageModel !== undefined) {
    contents = setEnvValue(contents, "CUSTOM_IMAGE_MODEL", input.customImageModel);
  }

  if (resetProxy) {
    contents = removeEnvKey(contents, "HTTPS_PROXY");
  } else if (input.httpsProxy !== undefined) {
    contents = setEnvValue(contents, "HTTPS_PROXY" as SupportedKey, input.httpsProxy.trim());
  }

  await writeFile(envTempPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(envTempPath, envPath);

  if (youtubeApiKey) process.env.YOUTUBE_API_KEY = youtubeApiKey;
  if (geminiApiKey) configureGeminiApiKey(geminiApiKey);
  configureGeminiModels(textModel, imageModel);

  if (input.customTextProvider !== undefined) process.env.CUSTOM_TEXT_PROVIDER = input.customTextProvider;
  if (input.customTextBaseUrl !== undefined) process.env.CUSTOM_TEXT_BASE_URL = input.customTextBaseUrl;
  if (customTextApiKey) process.env.CUSTOM_TEXT_API_KEY = customTextApiKey;
  if (input.customTextModel !== undefined) process.env.CUSTOM_TEXT_MODEL = input.customTextModel;
  if (input.customImageProvider !== undefined) process.env.CUSTOM_IMAGE_PROVIDER = input.customImageProvider;
  if (input.customImageBaseUrl !== undefined) process.env.CUSTOM_IMAGE_BASE_URL = input.customImageBaseUrl;
  if (customImageApiKey) process.env.CUSTOM_IMAGE_API_KEY = customImageApiKey;
  if (input.customImageModel !== undefined) process.env.CUSTOM_IMAGE_MODEL = input.customImageModel;

  // Hot-reload the global fetch dispatcher on proxy change so the next
  // outbound YouTube / Gemini request uses the new route.
  if (resetProxy) {
    process.env.HTTPS_PROXY = "";
    applyGlobalProxy(undefined);
  } else if (input.httpsProxy !== undefined) {
    const trimmed = input.httpsProxy.trim();
    process.env.HTTPS_PROXY = trimmed;
    applyGlobalProxy(trimmed);
  }

  return getApiKeyStatus();
}
