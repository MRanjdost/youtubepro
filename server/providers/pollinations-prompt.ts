import type { ThumbnailConfig } from "../gemini";
import type { TextAIProvider } from "./types";

/** Persian/Arabic script ranges: U+0600–U+06FF, U+FB50–U+FDFF, U+FE70–U+FEFF. */
const NON_LATIN_SCRIPT_RE = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// WHY: English and Persian tokens that imply a human subject must be detected so the negative
// prompt can forbid people when the video is about an object/device/software/concept instead.
const PERSON_REQUESTED_RE =
  /\b(person|people|man|woman|girl|boy|male|female|human|face|portrait|headshot|selfie|avatar|creator|influencer|vlogger|youtuber|actor|model|presenter|host|character)\b/i;
const PERSIAN_PERSON_RE = /(زن|مرد|دختر|پسر|چهره|صورت|انسان|شخص|آدم|ولاگر|بازیگر|مدل)/;

/** Detect an explicit request for a human/person subject in English or Persian. */
export function isPersonRequested(text: string): boolean {
  return PERSON_REQUESTED_RE.test(text) || PERSIAN_PERSON_RE.test(text);
}

/**
 * Detect Persian/Arabic (non-Latin) script in arbitrary user text.
 *
 * WHY: stable-diffusion-family models (flux/turbo) are trained almost entirely on English/Latin
 * image captions. They do not translate or transliterate other scripts — they treat them as noise
 * and fall back to a generic/default output, so this is a plausible contributor to wrong results.
 */
export function hasNonLatinScript(text: string): boolean {
  return NON_LATIN_SCRIPT_RE.test(text);
}

/** Warn once per non-Latin field without blocking generation or altering the prompt text. */
function warnNonLatinField(fieldName: string, text: string): void {
  // WHY: only detection + warning in this fix — translation is out of scope and must not silently
  // change user-facing text. The server log shows whether this contributes to a given test case.
  const preview = text.trim().slice(0, 100);
  console.warn(
    `[pollinations] non-Latin script detected in ${fieldName}, output quality may degrade — Pollinations flux/turbo only reliably understands English prompts. (${preview})`,
  );
}

/** Collapse a prompt into one line and cap it so the GET path stays within URL limits. */
export function sanitizePollinationsPrompt(prompt: string): string {
  // WHY: prompts that keep raw newlines/formatting can exceed the practical HTTP path length for a
  // GET request and make the upstream return HTTP 500. Replacing whitespace runs with single spaces
  // and truncating keeps the encoded path well short. Pollinations flux/turbo also fragment long
  // instructional text, so a single compact line is the safest shape.
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length > 800 ? cleaned.slice(0, 800) : cleaned;
}

/**
 * Translate a Persian/Arabic video topic into a concrete English visual subject.
 *
 * WHY: flux/turbo are trained almost entirely on English/Latin image captions and cannot read
 * non-Latin script at all, so Persian/Arabic input must be converted into an English object/scene
 * phrase before it reaches the image sampler. The translation prompt forces a specific physical
 * object/product/device/place — never a person — so the returned phrase is directly drawable.
 */
export async function translateToEnglishVisualSubject(
  topic: string,
  description: string | undefined,
  textAI: TextAIProvider,
  model: string,
): Promise<string> {
  // WHY: keep the per-field non-Latin warning so server logs still identify which input triggered the translation.
  if (hasNonLatinScript(topic)) warnNonLatinField("topic", topic);
  if (description && hasNonLatinScript(description)) warnNonLatinField("thumbnailDescription", description);

  const source = [topic, description].filter(Boolean).join("\n");
  
  // WHY: Completely merge the persona instructions directly into a single unified User prompt.
  // Passing a separate systemInstruction parameter causes the Gemini/OpenAI providers to wrap it in a
  // message with role: "system", which triggers a 400 Bad Request error ("Role 'system' is not supported")
  // on certain API endpoints. A single cohesive instruction string is 100% reliable across all models.
  const prompt = `You turn video topics into concrete English visual subjects for a text-to-image model.
Task: Translate the input into ONE short English phrase naming a specific physical object, product, device, screen, place, or scene that a photorealistic image generator can draw.

Rules:
1. Never include people, human figures, or faces.
2. Never add instructions, film vocabulary, quotes, or markdown.
3. Return only the subject phrase in under 15 words.

Video subject text to convert:
${source}

Visual Subject Phrase:`;

  try {
    const result = await textAI.generate({
      prompt,
      model,
      jsonMode: false,
    });
    const clean = result.text.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
    return clean.length > 0 ? clean.slice(0, 200) : topic.trim();
  } catch (error) {
    // WHY: a failed translation must not kill the generation — fall back to the raw topic so the
    // image path still gets a subject (buildPollinationsThumbnailPrompt never blocks on script).
    console.warn(
      `[pollinations] translation failed, using original subject: ${error instanceof Error ? error.message : String(error)}`,
    );
    return topic.trim();
  }
}

/**
 * Build a concise, subject-first, pure image-description prompt for Pollinations flux/turbo.
 *
 * Unlike Gemini, Pollinations flux/turbo are raw text-to-image diffusion models: they do NOT follow
 * instructions, rules, or few-shot examples, and they cannot read non-Latin script. Putting the
 * concrete English visual subject as the very first token prevents flux/turbo from defaulting to its
 * strongest cluster ("YouTube thumbnail with a young woman"), and a strict people-negative prompt
 * keeps humans out of object/device/software/concept thumbnails entirely.
 */
export function buildPollinationsThumbnailPrompt(visualSubject: string, config: ThumbnailConfig): string {
  const parts: string[] = [];
  // WHY: subject-first — the first token is the concrete object/scene itself, not a wrapper phrase,
  // so the sampler keys the whole composition off the real subject.
  parts.push(visualSubject.trim());

  // WHY: minimal product-shot environment plus the user's lighting/color choices; enough context for
  // a clean studio look without letting the sampler decide the mood on its own.
  parts.push(
    `clean studio background, product-focused scene, ${config.lighting} lighting, ${config.colorScheme} color scheme`,
  );

  // WHY: flux/turbo can only render Latin glyphs; non-Latin main text is dropped rather than emitted
  // as gibberish that destroys the rest of the composition.
  if (config.mainText && !hasNonLatinScript(config.mainText)) {
    parts.push(`with large bold readable text "${config.mainText.trim()}"`);
  }

  // WHY: thumbnail-specific quality descriptors keep the render in a professional, high-impact photo
  // register instead of a generic image-model look.
  parts.push(
    "modern high-impact YouTube thumbnail, photorealistic, hyperdetailed, sharp focus, cinematic contrast, rich colors, 16:9 landscape, centered composition",
  );

  // WHY: when the video is about an object/device/software/concept, a human figure is the dominant
  // default cluster for flux/turbo, so every people-related token is negated hard. When the subject
  // genuinely is a person, only people-safe style negatives remain (no anime/cartoon/painting/etc.).
  const mentionsPerson = isPersonRequested(`${visualSubject} ${config.thumbnailDescription || ""}`);
  parts.push(
    mentionsPerson
      ? "no anime, no cartoon, no illustration, no manga, no drawing, no painting, no hijab, no logo, no watermark, no text overlay artifacts, no blurry, no distorted face, no deformed, no low quality"
      : "no people, no person, no human, no man, no woman, no girl, no boy, no face, no facial features, no portrait, no headshot, no selfie, no avatar, no character, no anime, no cartoon, no illustration, no manga, no drawing, no painting, no hijab, no model, no influencer, no vlogger, no logo, no watermark, no text overlay artifacts, no blurry, no distorted face, no deformed, no low quality",
  );

  return sanitizePollinationsPrompt(parts.join(", "));
}