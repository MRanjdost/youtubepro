import { z } from "zod";
import {
  scriptEvidenceContextSchema,
  TargetAudience,
  VideoFormat,
} from "@shared/schema";

export const narrationExtractionRequestSchema = z.object({
  scriptContent: z.string().trim().min(1).max(80_000),
}).strict();

export const titleRegenerationRequestSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  format: z.nativeEnum(VideoFormat),
  audience: z.nativeEnum(TargetAudience),
  evidenceContext: scriptEvidenceContextSchema.optional(),
}).strict();
