export const GEMINI_TEXT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export const GEMINI_IMAGE_MODELS = [
  {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2",
    description: "Recommended balance of image quality, speed, and cost.",
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    description: "Fastest, lowest-cost image option.",
  },
  {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    description: "Premium option for complex, high-precision thumbnails.",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana (legacy)",
    description: "Legacy image model retained for compatibility.",
  },
] as const;

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_IMAGE_MODEL = GEMINI_IMAGE_MODELS[0].id;

export type GeminiTextModel = (typeof GEMINI_TEXT_MODELS)[number];
export type GeminiImageModel = (typeof GEMINI_IMAGE_MODELS)[number]["id"];

export function isGeminiTextModel(value: string): value is GeminiTextModel {
  return GEMINI_TEXT_MODELS.includes(value as GeminiTextModel);
}

/**
 * Display metadata used to build the client-facing dropdown options. Kept
 * separate from GEMINI_TEXT_MODELS so the canonical list stays plain model IDs.
 */
export const GEMINI_TEXT_MODEL_META: Record<
  GeminiTextModel,
  { label: string; description: string }
> = {
  "gemini-3.6-flash": {
    label: "Gemini 3.6 Flash",
    description: "Recommended default for capable, fast research and writing.",
  },
  "gemini-3.7-flash": {
    label: "Gemini 3.7 Flash",
    description: "Latest-generation flash model with the most current knowledge.",
  },
  "gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    description: "Newest flash model, best available quality and speed.",
  },
  "gemini-3.5-flash": {
    label: "Gemini 3.5 Flash",
    description: "Stable general-purpose model.",
  },
  "gemini-3.5-flash-lite": {
    label: "Gemini 3.5 Flash-Lite",
    description: "Lower-cost choice for high-volume work.",
  },
  "gemini-3.1-flash-lite": {
    label: "Gemini 3.1 Flash-Lite",
    description: "Efficient earlier-generation model.",
  },
};

/**
 * Client-facing dropdown options (id/label/description) derived from the
 * canonical model ID list. Same shape as GEMINI_IMAGE_MODELS so the settings
 * status payload does not change its API contract.
 */
export function geminiTextModelOptions(): Array<{
  id: GeminiTextModel;
  label: string;
  description: string;
}> {
  return GEMINI_TEXT_MODELS.map((id) => ({
    id,
    label: GEMINI_TEXT_MODEL_META[id].label,
    description: GEMINI_TEXT_MODEL_META[id].description,
  }));
}

/**
 * Common spellings / display labels that appear in older .env files. Keys are
 * normalized (lowercase, single spaces). Values are real API model IDs and are
 * guaranteed to exist in GEMINI_TEXT_MODELS so resolved values always validate.
 */
const GEMINI_TEXT_MODEL_ALIASES: Record<string, string> = {
  "gemini 3.6 flash": "gemini-3.6-flash",
  "gemini 3.7 flash": "gemini-3.7-flash",
  "gemini 3.8 flash": "gemini-3.8-flash",
  "gemini 3.5 flash": "gemini-3.5-flash",
  "gemini 3.5 flash lite": "gemini-3.5-flash-lite",
  "gemini 3.1 flash lite": "gemini-3.1-flash-lite",
  "gemini 2.5 flash": "gemini-3.6-flash",
  "gemini-2.5-flash": "gemini-3.6-flash",
  "gemini 2.0 flash": "gemini-3.6-flash",
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini 1.5 flash": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
};

/**
 * Resolve a stored model value (exact ID or common display label) to a real
 * model ID from GEMINI_TEXT_MODELS. Unknown or empty values fall back to
 * DEFAULT_GEMINI_TEXT_MODEL ("gemini-3.6-flash") so callers always receive a
 * valid, sendable model ID.
 */
export function resolveGeminiTextModel(value: unknown): GeminiTextModel {
  if (typeof value !== "string") return DEFAULT_GEMINI_TEXT_MODEL;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_GEMINI_TEXT_MODEL;
  if (isGeminiTextModel(trimmed)) return trimmed;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  const mapped = GEMINI_TEXT_MODEL_ALIASES[key];
  if (mapped && isGeminiTextModel(mapped)) return mapped;
  return DEFAULT_GEMINI_TEXT_MODEL;
}

export function isGeminiImageModel(value: string): value is GeminiImageModel {
  return GEMINI_IMAGE_MODELS.some((model) => model.id === value);
}

export function getGeminiImageModelLabel(modelId: string): string {
  return GEMINI_IMAGE_MODELS.find((model) => model.id === modelId)?.label || modelId;
}
