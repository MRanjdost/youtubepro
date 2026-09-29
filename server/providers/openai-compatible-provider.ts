import type {
  ImageAIProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  TextAIProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "./types";

export interface OpenAICompatibleProviderOptions {
  /** Base URL, e.g. "https://openrouter.ai/api/v1" */
  baseUrl: string;
  /** API key for Authorization: Bearer <key> */
  apiKey: string;
  /** Model id, e.g. "anthropic/claude-3-5-sonnet" */
  model: string;
  /** Timeout for the fetch call in milliseconds (default 60s). */
  timeoutMs?: number;
}

/** Classified provider error: carries category + status for resolve.ts wrapping. */
export interface ClassifiedImageError extends Error {
  /** Route-facing category used by generateThumbnailWithProvider. */
  category?: "quota" | "network" | "provider_server" | "timeout";
  /** HTTP status when the upstream returned one. */
  status?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

/** Carries classification metadata so resolve.ts can map the error precisely. */
function classifiedImageError(message: string, category: ClassifiedImageError["category"], status: number): ClassifiedImageError {
  const error = new Error(message) as ClassifiedImageError;
  error.category = category;
  error.status = status;
  return error;
}

/**
 * Minimal OpenAI-compatible provider (text chat completions + image generations).
 * Does NOT validate or transform responses—caller does Zod parsing.
 * Throws on HTTP error or non-JSON body when jsonMode=true.
 */
export class OpenAICompatibleProvider implements TextAIProvider, ImageAIProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseUrl) throw new Error("OpenAICompatibleProvider requires baseUrl.");
    if (!options.apiKey) throw new Error("OpenAICompatibleProvider requires apiKey.");
    if (!options.model) throw new Error("OpenAICompatibleProvider requires model.");

    // Normalize: remove trailing slash so we can always append /chat/completions
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Single fetch attempt to the OpenAI-compatible chat completions endpoint.
   * Transport-level retries (including empty responses) live in generate(),
   * which re-invokes this method. The timeout is enforced with an abort
   * controller so a slow/hung proxy connection cannot stall the request.
   */
  private async fetchChatCompletions(
    url: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Retry only transport-level failures (proxy egress instability, TLS
   * interception, connect timeouts) and empty/mid-response drops
   * (EmptyResponseError). HTTP-level errors (4xx/5xx from the API) are
   * returned by fetch and handled outside this method, so they are never
   * retried here. Matches are checked on name, message AND code because Node.js
   * net errors (e.g. ECONNRESET) often carry the identifier only in the `code`
   * field.
   */
  private isRetryableNetworkError(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current:
      | { name?: string; message?: string; code?: unknown; cause?: unknown }
      | undefined = error as {
      name?: string;
      message?: string;
      code?: unknown;
      cause?: unknown;
    };
    for (let depth = 0; depth < 4 && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
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
        | { name?: string; message?: string; code?: unknown; cause?: unknown }
        | undefined;
    }
    this.logNotRetryable(error);
    return false;
  }

  private logNotRetryable(error: unknown): void {
    const primary = error as { name?: unknown; message?: unknown; code?: unknown };
    const cause = (error as { cause?: unknown }).cause as
      | { name?: unknown; message?: unknown; code?: unknown }
      | undefined;
    console.warn("[openai-compat] Not retrying, error not matched:", {
      name: primary.name,
      message: primary.message,
      code: primary.code,
      causeName: cause?.name,
      causeMessage: cause?.message,
      causeCode: cause?.code,
    });
  }

  private emptyContentError(): Error {
    const error = new Error(
      `OpenAICompatibleProvider (model: ${this.model}) returned an empty content string. This usually means the provider dropped the connection mid-response or the model returned no output.`
    );
    error.name = "EmptyResponseError";
    return error;
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const url = `${this.baseUrl}/chat/completions`;

    // Build messages array
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemInstruction) {
      messages.push({ role: "system", content: request.systemInstruction });
    }
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
    };

    if (request.jsonMode) {
      // OpenAI-compatible: {"type":"json_object"} tells model to output JSON only.
      body.response_format = { type: "json_object" };
    }

    // Retry the WHOLE attempt (fetch + body parse + empty-content check) for
    // transport failures (ECONNRESET, TLS interception, connect timeouts) and
    // for EmptyResponseError (provider dropped the connection mid-response).
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.completeChatCompletions(url, body);
      } catch (error) {
        if (!this.isRetryableNetworkError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < MAX_RETRIES) {
          console.warn(
            `[openai-compat] Retry ${attempt}/${MAX_RETRIES} after ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          const delayMs = RETRY_DELAY_MS * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(String(lastError));
  }

  private async completeChatCompletions(
    url: string,
    body: Record<string, unknown>,
  ): Promise<TextGenerationResult> {
    const response = await this.fetchChatCompletions(url, body);

    if (!response.ok) {
      // Defensive body read for the error message: prefer json() (works for
      // the API and for minimal test mocks), fall back to text() when the
      // response is not JSON (e.g. an HTML error page).
      let errorBody: string | undefined;
      try {
        const body = await response.json();
        errorBody = typeof body === "string" ? body : JSON.stringify(body);
      } catch {
        if (typeof (response as { text?: unknown }).text === "function") {
          errorBody = await response.text().catch(() => undefined);
        }
      }
      throw new Error(
        `OpenAICompatibleProvider (model: ${
          this.model
        }) HTTP ${response.status}: ${response.statusText}. Body: ${(
          errorBody ?? "<unreadable>"
        ).substring(0, 200)}`
      );
    }

    // Capture a raw preview BEFORE consuming the body so we can report a useful
    // snippet if response.json() fails. Undici Response supports clone();
    // minimal test mocks usually expose neither clone() nor text().
    let rawPreview: string | undefined;
    if (typeof response.clone === "function") {
      try {
        rawPreview = await response.clone().text();
      } catch {
        rawPreview = undefined;
      }
    }

    let json: { choices?: Array<{ message?: { content?: unknown } }> } | null = null;
    try {
      const parsed = await response.json();
      if (parsed === null || typeof parsed !== "object") {
        rawPreview = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      } else {
        json = parsed as { choices?: Array<{ message?: { content?: unknown } }> };
      }
    } catch (e) {
      // Empty body (e.g. "Unexpected end of JSON input") means the connection
      // dropped mid-response — treat it as retryable instead of a hard error.
      if (!rawPreview || rawPreview.trim().length === 0) {
        throw this.emptyContentError();
      }
      throw new Error(
        `OpenAICompatibleProvider (model: ${
          this.model
        }) returned non-JSON body: ${(rawPreview ?? "<unreadable>").substring(0, 200)}`
      );
    }

    // OpenAI chat.completions shape: { choices: [{ message: { content: string } }] }
    const content = json?.choices?.[0]?.message?.content ?? "";
    if (typeof content !== "string") {
      throw new Error(
        `OpenAICompatibleProvider (model: ${this.model}) expected string content in choices[0].message.content, got: ${typeof content}`
      );
    }
    if (content.trim().length === 0) {
      throw this.emptyContentError();
    }

    return { text: content, model: this.model };
  }

  /**
   * Generates an image via the OpenAI-compatible /images/generations endpoint.
   * Requests b64_json output; falls back to downloading data[0].url when a
   * provider returns a URL instead of inline bytes. Transport-level retries
   * (proxy egress instability, TLS interception, connect timeouts) live here;
   * HTTP-level errors (4xx/5xx, 429) are classified and thrown immediately.
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const url = `${this.baseUrl}/images/generations`;

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: request.prompt,
      n: 1,
      response_format: "b64_json",
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.completeImageGeneration(url, body);
      } catch (error) {
        if (!this.isRetryableNetworkError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < MAX_RETRIES) {
          console.warn(
            `[openai-compat] Image retry ${attempt}/${MAX_RETRIES} after ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          const delayMs = RETRY_DELAY_MS * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(String(lastError));
  }

  private async completeImageGeneration(
    url: string,
    body: Record<string, unknown>,
  ): Promise<ImageGenerationResult> {
    const response = await this.fetchImageGenerations(url, body);

    if (!response.ok) {
      let errorBody: string | undefined;
      try {
        const jsonBody = await response.json();
        errorBody = typeof jsonBody === "string" ? jsonBody : JSON.stringify(jsonBody);
      } catch {
        if (typeof (response as { text?: unknown }).text === "function") {
          errorBody = await response.text().catch(() => undefined);
        }
      }
      const message = `OpenAICompatibleProvider (model: ${
        this.model
      }) image generation HTTP ${response.status}: ${response.statusText}. Body: ${(
        errorBody ?? "<unreadable>"
      ).substring(0, 200)}`;
      throw classifiedImageError(message, response.status === 429 ? "quota" : "provider_server", response.status);
    }

    let json: { data?: Array<{ b64_json?: unknown; url?: unknown }> } | null = null;
    try {
      const parsed = await response.json();
      if (parsed !== null && typeof parsed === "object") {
        json = parsed as { data?: Array<{ b64_json?: unknown; url?: unknown }> };
      }
    } catch {
      json = null;
    }

    const item = json?.data?.[0];
    if (!item) {
      throw new Error(
        `OpenAICompatibleProvider (model: ${this.model}) image generation did not contain image data. Expected { data: [{ b64_json | url }] }. Got: ${JSON.stringify(json).substring(0, 200)}`
      );
    }

    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return { base64: item.b64_json, mimeType: sniffImageMimeType(item.b64_json), model: this.model };
    }

    if (typeof item.url === "string" && item.url.length > 0) {
      const downloaded = await this.fetchImageByUrl(item.url);
      return { base64: downloaded.base64, mimeType: downloaded.mimeType, model: this.model };
    }

    throw new Error(
      `OpenAICompatibleProvider (model: ${this.model}) image generation did not contain image data. Expected b64_json or url in data[0]. Got: ${JSON.stringify(item).substring(0, 200)}`
    );
  }

  /**
   * Downloads a generated image referenced by a URL. Uses the native global
   * dispatcher (configured by server/proxy.ts), so corporate proxies/TLS
   * interception applies to the download too.
   */
  private async fetchImageByUrl(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(imageUrl, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = `OpenAICompatibleProvider (model: ${this.model}) failed to download generated image: HTTP ${response.status}: ${response.statusText}`;
        throw classifiedImageError(message, "provider_server", response.status);
      }
      const contentType =
        typeof (response.headers as { get?: unknown })?.get === "function"
          ? response.headers.get("content-type")
          : undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = (contentType && contentType.split(";")[0].trim()) || sniffImageMimeType(buffer.toString("base64"));
      return { base64: buffer.toString("base64"), mimeType };
    } catch (error) {
      if (controller.signal.aborted) {
        throw classifiedImageError(
          `OpenAICompatibleProvider (model: ${this.model}) timed out downloading generated image after ${this.timeoutMs}ms`,
          "network",
          502,
        );
      }
      if (error instanceof Error && (error as ClassifiedImageError).category) {
        throw error;
      }
      throw classifiedImageError(
        `OpenAICompatibleProvider (model: ${this.model}) failed to download generated image: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "network",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Single fetch attempt to the OpenAI-compatible image generations endpoint.
   * Uses the native global dispatcher (configured via setGlobalDispatcher by
   * server/proxy.ts), matching the text completions fetches. Timeouts and other
   * transport failures are classified as network errors.
   */
  private async fetchImageGenerations(
    url: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw classifiedImageError(
          `OpenAICompatibleProvider (model: ${this.model}) image generation timed out after ${this.timeoutMs}ms`,
          "network",
          502,
        );
      }
      if (error instanceof Error && (error as ClassifiedImageError).category) {
        throw error;
      }
      throw classifiedImageError(
        `OpenAICompatibleProvider (model: ${this.model}) image generation request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "network",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Sniff a MIME type from base64 magic bytes (data URLs from providers).
 */
function sniffImageMimeType(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/png";
}