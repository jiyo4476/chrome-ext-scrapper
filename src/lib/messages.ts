import { z } from 'zod';
import { jobDraftSchema } from './schemas';

export const extractActiveTabRequestSchema = z.object({
  type: z.literal('EXTRACT_ACTIVE_TAB'),
});

export const extractActiveTabResponseSchema = z.object({
  ok: z.literal(true),
  draft: jobDraftSchema,
});

export const extensionErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const extensionMessageSchema = extractActiveTabRequestSchema;
export const extensionResponseSchema = z.union([
  extractActiveTabResponseSchema,
  extensionErrorResponseSchema,
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type ExtensionResponse = z.infer<typeof extensionResponseSchema>;
