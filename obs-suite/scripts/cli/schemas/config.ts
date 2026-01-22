/**
 * Zod schemas for CLI configuration validation
 */

import { z } from 'zod';

/** Whisper model options */
export const WhisperModelSchema = z.enum([
  'tiny',
  'base',
  'small',
  'medium',
  'large',
  'large-v2',
  'large-v3',
]);

export type WhisperModel = z.infer<typeof WhisperModelSchema>;

/** Language options */
export const LanguageSchema = z.enum(['auto', 'en', 'fr']);

export type Language = z.infer<typeof LanguageSchema>;

/** Diarization configuration */
export const DiarizationConfigSchema = z.object({
  model: WhisperModelSchema.default('large-v3'),
  language: LanguageSchema.default('auto'),
  minSpeakers: z.number().int().min(1).optional(),
  maxSpeakers: z.number().int().min(1).optional(),
}).refine(
  data => !data.minSpeakers || !data.maxSpeakers || data.minSpeakers <= data.maxSpeakers,
  { message: 'minSpeakers must be <= maxSpeakers' }
);

export type DiarizationConfig = z.infer<typeof DiarizationConfigSchema>;

/** Process command options */
export const ProcessOptionsSchema = z.object({
  force: z.boolean().default(false),
  skipVocalRemoval: z.boolean().default(false),
  vocalsOnly: z.boolean().default(false),
  all: z.boolean().default(false),
}).refine(
  data => !(data.skipVocalRemoval && data.vocalsOnly),
  { message: 'Cannot use --skip-vocal-removal and --vocals-only together' }
);

export type ProcessOptions = z.infer<typeof ProcessOptionsSchema>;

/** Finalize command options */
export const FinalizeOptionsSchema = z.object({
  force: z.boolean().default(false),
  all: z.boolean().default(false),
});

export type FinalizeOptions = z.infer<typeof FinalizeOptionsSchema>;
