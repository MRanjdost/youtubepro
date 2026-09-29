import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type {
  ImageAIProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  TextAIProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "./types";
import { resolveGeminiTextModel } from "../gemini-models";

/**
 * Models for which GeminiProvider enables thinkingConfig (HIGH).
 * Single source of truth, shared with server/gemini.ts.
 */
export const HIGH_THINKING_MODELS = new Set<string>(["gemini-3.7-flash", "gemini-3.1-pro-preview"]);

// WHY: structured JSON generation (ideas, scripts) ships large request/response payloads that
// can exceed 60s over a slow domestic proxy channel, so the default text timeout is 120s. The
// value is used by withTimeout() and reapplied on every retry attempt.
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

export interface GeminiProviderOptions {
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Implements both TextAIProvider and ImageAIProvider using @google/genai.
 * This is a thin wrapper — it does NOT duplicate the prompting/validation logic
 * that lives in server/gemini.ts. Callers pass an already-assembled prompt and
 * receive raw text or base64 image; downstream code does the Zod parsing.
 */
export class GeminiProvider implements TextAIProvider, ImageAIProvider {
  private ai: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error("GeminiProvider requires a non-empty apiKey.");
    }
    this.ai = new GoogleGenAI({ apiKey: options.apiKey.trim() });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    // Normalize legacy/display labels to a real, sendable API model ID before
    // anything reaches @google/genai.
    const model = resolveGeminiTextModel(request.model);
    const config: GenerateContentConfig = {
      maxOutputTokens: 8192,
    };
    if (request.jsonMode) {
      config.responseMimeType = "application/json";
    }
    if (HIGH_THINKING_MODELS.has(model)) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    }

    const contents: Content[] = [];
    if (request.systemInstruction) {
      contents.push({ role: "system", parts: [{ text: request.systemInstruction }] });
    }
    contents.push({ role: "user", parts: [{ text: request.prompt }] });

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.withTimeout(
          this.ai.models.generateContent({
            model,
            contents,
            config,
          }),
        );
        const text = response?.text ?? "";
        return { text, model };
      } catch (error) {
        lastError = error;
        if (!this.isRetryableGeminiError(error) || attempt >= MAX_RETRIES) break;
        console.warn(
          `[gemini] Retry ${attempt}/${MAX_RETRIES} after ${error instanceof Error ? error.message : String(error)}`
        );
        const delayMs = RETRY_DELAY_MS * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (this.isQuotaError(lastError)) {
      const quotaModel = this.quotaModelFromError(lastError) || model;
      throw new Error(
        `Quota exceeded for model ${quotaModel}. سهمیه رایگان مدل ${quotaModel} تمام شده است؛ مدل دیگری را در تنظیمات انتخاب کنید.`
      );
    }
    if (this.isHighDemandError(lastError)) {
      throw new Error(
        "مدل انتخابی در حال حاضر تحت بار ترافیکی سنگین گوگل است (503 High Demand). لطفاً مدل را در تنظیمات به Gemini 3.5 Flash-Lite تغییر دهید."
      );
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(String(lastError));
  }

  /**
   * Detect a Google-side 503 / high-demand (UNAVAILABLE) failure after retries
   * are exhausted, walking the error cause chain so both @google/genai ApiError
   * and wrapped fetch failures are recognized.
   */
  private isHighDemandError(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current:
      | {
          status?: number | string;
          name?: string;
          message?: string;
          code?: unknown;
          cause?: unknown;
        }
      | undefined = error as {
      status?: number | string;
      name?: string;
      message?: string;
      code?: unknown;
      cause?: unknown;
    };
    for (let depth = 0; depth < 4 && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const status = Number(current.status) || 0;
      const name = current.name || "";
      const message = current.message || "";
      const code = typeof current.code === "string" ? current.code : "";
      if (status === 503 || /high demand|unavailable|\b503\b/i.test(`${name} ${message} ${code}`)) {
        return true;
      }
      current = current.cause as
        | {
            status?: number | string;
            name?: string;
            message?: string;
            code?: unknown;
            cause?: unknown;
          }
        | undefined;
    }
    return false;
  }

  /**
   * Retry transport-level failures and transient API status codes (429 quota,
   * 503 unavailable). Skipped for aborted (timeout) requests handled inline and
   * for genuine 4xx validation errors.
   */
  private isRetryableGeminiError(error: unknown): boolean {
    if (error instanceof Error && error.message.startsWith("Request timed out after")) {
      return false;
    }
    const seen = new Set<unknown>();
    let current:
      | {
          status?: number | string;
          name?: string;
          message?: string;
          code?: unknown;
          cause?: unknown;
        }
      | undefined = error as {
      status?: number | string;
      name?: string;
      message?: string;
      code?: unknown;
      cause?: unknown;
    };
    for (let depth = 0; depth < 4 && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const status = Number(current.status) || 0;
      if (status === 429 || status === 503) return true;
      const name = current.name || "";
      const message = current.message || "";
      const code = typeof current.code === "string" ? current.code : "";
      if (
        name === "EmptyResponseError" ||
        name === "ConnectTimeoutError" ||
        /UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|ERR_TLS_CERT_ALTNAME_INVALID|fetch failed|TypeError/i.test(
          `${name} ${message} ${code}`
        )
      ) {
        return true;
      }
      current = current.cause as
        | {
            status?: number | string;
            name?: string;
            message?: string;
            code?: unknown;
            cause?: unknown;
          }
        | undefined;
    }
    this.logNotRetryableGeminiError(error);
    return false;
  }

  private logNotRetryableGeminiError(error: unknown): void {
    const primary = error as { name?: unknown; message?: unknown; code?: unknown };
    const cause = (error as { cause?: unknown }).cause as
      | { name?: unknown; message?: unknown; code?: unknown }
      | undefined;
    console.warn("[gemini] Not retrying, error not matched:", {
      name: primary.name,
      message: primary.message,
      code: primary.code,
      causeName: cause?.name,
      causeMessage: cause?.message,
      causeCode: cause?.code,
    });
  }

  /**
   * Detect a quota failure (429 / RESOURCE_EXHAUSTED / API-embedded quota text)
   * walking the error cause chain so both @google/genai ApiError and wrapped
   * fetch failures are recognized.
   */
  private isQuotaError(error: unknown): boolean {
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

  private quotaModelFromError(error: unknown): string | null {
    const seen = new Set<unknown>();
    let current: { message?: string; cause?: unknown } | undefined = error as {
      message?: string;
      cause?: unknown;
    };
    for (let depth = 0; depth < 4 && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const match = /model['"]?\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i.exec(`${current.message || ""}`);
      if (match) return match[1];
      current = current.cause as { message?: string; cause?: unknown } | undefined;
    }
    return null;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const aspectRatio = request.aspectRatio || "16:9";

    // Build content parts: one inlineData per reference image, then the prompt.
    const contentParts: Part[] = [];
    for (const reference of request.referenceImages ?? []) {
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(reference);
      if (!match) continue;
      contentParts.push({
        inlineData: { mimeType: match[1], data: match[2] },
      });
    }
    contentParts.push({ text: request.prompt });

    const response = await this.withTimeout(
      this.ai.models.generateContent({
        model: request.model,
        contents: [{ role: "user", parts: contentParts }],
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          imageConfig: { aspectRatio },
        },
      }),
    );

    // Find the first part that carries inlineData.
    const imagePart = response?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error("GeminiProvider.generateImage: response did not contain image data.");
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    return {
      base64: imagePart.inlineData.data,
      mimeType,
      model: request.model,
    };
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}