/**
 * Provider abstraction layer — text and image generation.
 * No Gemini-specific SDK details leak here (no thinkingConfig, no Modality, etc.).
 * GeminiProvider handles its own defaults internally.
 */

export interface TextGenerationRequest {
  /** Full prompt / user message. Provider treats this as opaque text. */
  prompt: string;
  /** Optional system-level instruction (standard across LLM APIs; not used today
   *  by gemini.ts but reserved for future compatibility). */
  systemInstruction?: string;
  /** Model identifier, e.g. "gemini-3.7-flash", "anthropic/claude-3-5-sonnet". */
  model: string;
  /** When true, provider should request structured JSON output. */
  jsonMode?: boolean;
}

export interface TextGenerationResult {
  /** Raw text returned by the model. Parsing / Zod validation happens OUTSIDE the provider. */
  text: string;
  /** Actual model id that produced the result (may differ from request if remapped). */
  model: string;
}

export interface TextAIProvider {
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface ImageGenerationRequest {
  /** The full prompt describing the image. */
  prompt: string;
  /** Model identifier, e.g. "gemini-3.1-flash-image". */
  model: string;
  /** Aspect ratio string, default "16:9". */
  aspectRatio?: string;
  /** Optional reference images as data-URI strings: "data:image/png;base64,..." */
  referenceImages?: string[];
}

export interface ImageGenerationResult {
  /** Base64-encoded image data WITHOUT the "data:..." prefix. */
  base64: string;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
  /** Actual model id that produced the result. */
  model: string;
}

export interface ImageAIProvider {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
