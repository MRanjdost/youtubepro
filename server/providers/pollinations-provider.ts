import type {
  ImageAIProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "./types";
import { sanitizePollinationsPrompt } from "./pollinations-prompt";

export interface PollinationsProviderOptions {
  /** Per-attempt timeout for the fetch call in milliseconds (default 45s — Pollinations is slow). */
  timeoutMs?: number;
}

/** Classified provider error: carries category + status for resolve.ts wrapping. */
export interface ClassifiedImageError extends Error {
  /** Route-facing category used by generateThumbnailWithProvider. */
  category?: "quota" | "network" | "provider_server" | "timeout";
  /** HTTP status when the upstream returned one. */
  status?: number;
}

// WHY: each model attempt gets its own 45s budget so a hung model yields to the next candidate.
const DEFAULT_TIMEOUT_MS = 45_000;

// WHY: proxy tunnel resets can last a sub-second; waiting 2s between attempts/models gives the
// tunnel time to recover so a retry does not race itself.
const RETRY_BACKOFF_MS = 2_000;

// Candidate backend models, tried in order: flux first, then the faster turbo fallback.
const POLLINATIONS_MODELS = ["flux", "turbo"];

/** Carries classification metadata so resolve.ts can map the error precisely. */
function classifiedImageError(message: string, category: ClassifiedImageError["category"], status: number): ClassifiedImageError {
  const error = new Error(message) as ClassifiedImageError;
  error.category = category;
  error.status = status;
  return error;
}

/**
 * Pollinations.ai image provider — free, no API key, no signup.
 * A single GET request to https://image.pollinations.ai/prompt/<encoded>
 * returns the generated image directly (JPEG). HTTP status errors are thrown
 * as provider_server failures; transport/timeout failures as network failures.
 * Uses the native global dispatcher (configured by server/proxy.ts), the same
 * way the OpenAI-compatible provider does.
 */
export class PollinationsProvider implements ImageAIProvider {
  private readonly timeoutMs: number;

  constructor(options: PollinationsProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const cleanPrompt = sanitizePollinationsPrompt(request.prompt);
    // WHY: debug aid — lets the user verify in server logs exactly which prompt text (first 300
    // chars) was actually sent to Pollinations when output looks wrong.
    console.log(`[pollinations] prompt (${cleanPrompt.length} chars): ${cleanPrompt.slice(0, 300)}`);
    // WHY: a 13-digit Date.now() timestamp overflows the uint32 seed Pollinations' Diffusers
    // backend expects and can trigger an HTTP 500; a small random seed stays safely in range.
    const seed = Math.floor(Math.random() * 1_000_000);

    // WHY: proxy tunnels can drop/reset for a sub-second, so each candidate model is attempted up to
    // twice and a 2s backoff between attempts/models gives the tunnel time to recover. flux is tried
    // first, then the faster turbo fallback, and a 4xx/request-level error aborts immediately.
    let lastError: ClassifiedImageError | null = null;
    for (const model of POLLINATIONS_MODELS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        // WHY: enhance=false keeps Pollinations from rewriting the prompt with their LLM — that
        // rewriter hallucinates an unrelated anime/hijab-girl scene when fed Persian or ambiguous
        // text. Leaving it off forces flux/turbo to render YouTubePro's literal prompt.
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1280&height=720&nologo=true&private=true&seed=${seed}&enhance=false&model=${model}`;
        const controller = new AbortController();
        // WHY: a 45s per-attempt budget keeps a hung model from stalling the whole generation while
        // still letting the retry/fallback sequence complete within a reasonable total time.
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            // WHY: Cloudflare fronts image.pollinations.ai and blocks requests whose User-Agent is not a
            // real browser (Node's native fetch sends no UA), returning HTTP 403. Sending browser-like
            // headers (UA, Accept, Accept-Language, Cache-Control, Pragma) makes the proxied request look
            // like a normal browser navigation so the bot-detection lets it through.
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
            },
          });
          if (response.ok) {
            const contentType =
              typeof (response.headers as { get?: unknown })?.get === "function"
                ? response.headers.get("content-type")
                : undefined;
            const buffer = Buffer.from(await response.arrayBuffer());
            const mimeType = (contentType && contentType.split(";")[0].trim()) || "image/jpeg";
            return { base64: buffer.toString("base64"), mimeType, model };
          }
          // WHY: both 5xx (backend/model down) and 4xx (request-level) are classified here;
          // the catch decides whether a retry or a model switch can help.
          throw classifiedImageError(
            `PollinationsProvider image generation HTTP ${response.status} (model: ${model}): ${response.statusText}`,
            "provider_server",
            response.status,
          );
        } catch (error) {
          lastError = error as ClassifiedImageError;
          if (controller.signal.aborted) {
            lastError = classifiedImageError(
              `PollinationsProvider image generation timed out after ${this.timeoutMs}ms (model: ${model})`,
              "network",
              502,
            );
          } else if (
            Number((error as ClassifiedImageError).status) >= 400 &&
            Number((error as ClassifiedImageError).status) < 500 &&
            Number((error as ClassifiedImageError).status) !== 403 &&
            Number((error as ClassifiedImageError).status) !== 429
          ) {
            // WHY: only request-level errors a retry or model switch can never fix surface
            // immediately. Cloudflare can return a transient 403 (bot/UA check) or 429 (per-model
            // rate limit) that clears a moment later, so those fall through to the warn + backoff +
            // next attempt/model path instead of aborting the whole generation.
            throw error;
          }
          const detail = lastError instanceof Error ? lastError.message : String(lastError);
          console.warn(`[pollinations] Model ${model} attempt ${attempt} failed: ${detail}`);
          // WHY: give the proxy tunnel a 2s recovery window before the next attempt or before
          // switching models, so a temporary reset does not doom every attempt back-to-back.
          if (attempt < 2 || model !== POLLINATIONS_MODELS[POLLINATIONS_MODELS.length - 1]) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
          }
        } finally {
          clearTimeout(timer);
        }
      }
    }
    // WHY: every attempt across all candidate models failed — surface the most representative
    // failure, wrapping bare transport errors so resolve.ts still gets a classified code.
    if (lastError && (lastError.category || lastError.status)) throw lastError;
    throw classifiedImageError(
      `PollinationsProvider image generation failed: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      "network",
      502,
    );
  }
}