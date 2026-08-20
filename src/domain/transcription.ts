import { z } from "zod";

export const transcriptSegmentSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
}).refine((segment) => segment.endSeconds > segment.startSeconds, "endSeconds must be greater than startSeconds");

export const transcriptSchema = z.object({
  version: z.literal(1),
  language: z.string().min(2),
  segments: z.array(transcriptSegmentSchema),
});

export const semanticSuggestionSchema = z.object({
  type: z.enum(["gospel", "sermon", "creed", "other"]),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
}).refine((segment) => segment.endSeconds > segment.startSeconds, "endSeconds must be greater than startSeconds");

export const transcriptionResultSchema = z.object({
  transcript: transcriptSchema,
  suggestions: z.array(semanticSuggestionSchema),
});

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type SemanticSuggestion = z.infer<typeof semanticSuggestionSchema>;
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;

export interface TranscriptionProvider {
  transcribe(inputPath: string, language?: string): Promise<TranscriptionResult>;
}
