import { z } from 'zod';
import { publicSettingsSchema, publicSettingsUpdateSchema } from './settings';
import { jobDraftSchema, scrapePayloadSchema } from './schemas';

export const extensionErrorCodeSchema = z.enum([
  'MESSAGE_INVALID',
  'MESSAGE_UNHANDLED',
  'TAB_NOT_FOUND',
  'DOMAIN_NOT_SUPPORTED',
  'EXTRACT_EMPTY',
  'EXTRACT_FAILED',
  'PAYLOAD_INVALID',
  'SETTINGS_INVALID',
  'API_UNCONFIGURED',
  'API_AUTH_FAILED',
  'API_VALIDATION_FAILED',
  'API_NETWORK_FAILED',
  'API_UNEXPECTED_RESPONSE',
  'OAUTH_FAILED',
  'SAVE_IN_PROGRESS',
]);

export const extensionErrorSchema = z.object({
  code: extensionErrorCodeSchema,
  message: z.string().min(1),
  details: z.string().optional(),
});

export const extractActiveTabRequestSchema = z.object({
  type: z.literal('EXTRACT_ACTIVE_TAB'),
});

export const saveJobRequestSchema = z.object({
  type: z.literal('SAVE_JOB'),
  draft: jobDraftSchema,
});

export const getSettingsRequestSchema = z.object({
  type: z.literal('GET_SETTINGS'),
});

export const saveSettingsRequestSchema = z.object({
  type: z.literal('SAVE_SETTINGS'),
  settings: publicSettingsUpdateSchema,
});

export const oauthSignInRequestSchema = z.object({
  type: z.literal('OAUTH_SIGN_IN'),
});

export const oauthSignOutRequestSchema = z.object({
  type: z.literal('OAUTH_SIGN_OUT'),
});

export const getAuthStatusRequestSchema = z.object({
  type: z.literal('GET_AUTH_STATUS'),
});

export const testConnectionRequestSchema = z.object({
  type: z.literal('TEST_CONNECTION'),
});

export const extractionCandidateSchema = z.object({
  value: z.unknown(),
  source: z.enum(['jsonld', 'dom', 'meta', 'visible-text', 'url']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const extractionCandidatesSchema = z.record(
  z.string(),
  z.array(extractionCandidateSchema).max(20),
);

export const extractActiveTabResponseSchema = z.object({
  type: z.literal('EXTRACT_ACTIVE_TAB_RESULT'),
  ok: z.literal(true),
  draft: jobDraftSchema,
  candidates: extractionCandidatesSchema.optional(),
});

export const saveJobResultSchema = z
  .object({
    action: z.enum(['created', 'updated', 'duplicate_skipped']).optional(),
    job_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    status: z.enum(['created', 'updated', 'duplicate']).optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const saveJobResponseSchema = z.object({
  type: z.literal('SAVE_JOB_RESULT'),
  ok: z.literal(true),
  payload: scrapePayloadSchema,
  result: saveJobResultSchema,
});

export const getSettingsResponseSchema = z.object({
  type: z.literal('GET_SETTINGS_RESULT'),
  ok: z.literal(true),
  settings: publicSettingsSchema,
});

export const saveSettingsResponseSchema = z.object({
  type: z.literal('SAVE_SETTINGS_RESULT'),
  ok: z.literal(true),
  settings: publicSettingsSchema,
});

export const oauthSignInResponseSchema = z.object({
  type: z.literal('OAUTH_SIGN_IN_RESULT'),
  ok: z.literal(true),
});

export const oauthSignOutResponseSchema = z.object({
  type: z.literal('OAUTH_SIGN_OUT_RESULT'),
  ok: z.literal(true),
});

export const testConnectionResponseSchema = z.object({
  type: z.literal('TEST_CONNECTION_RESULT'),
  ok: z.literal(true),
});

export const getAuthStatusResponseSchema = z.object({
  type: z.literal('GET_AUTH_STATUS_RESULT'),
  ok: z.literal(true),
  authenticated: z.boolean(),
});

export const extensionErrorResponseSchema = z.object({
  type: z.literal('ERROR'),
  ok: z.literal(false),
  error: extensionErrorSchema,
});

export const extensionMessageSchema = z.discriminatedUnion('type', [
  extractActiveTabRequestSchema,
  saveJobRequestSchema,
  getSettingsRequestSchema,
  saveSettingsRequestSchema,
  oauthSignInRequestSchema,
  oauthSignOutRequestSchema,
  getAuthStatusRequestSchema,
  testConnectionRequestSchema,
]);

export const extensionResponseSchema = z.union([
  extractActiveTabResponseSchema,
  saveJobResponseSchema,
  getSettingsResponseSchema,
  saveSettingsResponseSchema,
  oauthSignInResponseSchema,
  oauthSignOutResponseSchema,
  testConnectionResponseSchema,
  getAuthStatusResponseSchema,
  extensionErrorResponseSchema,
]);

export type ExtensionErrorCode = z.infer<typeof extensionErrorCodeSchema>;
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type ExtensionResponse = z.infer<typeof extensionResponseSchema>;
export type SaveJobResult = z.infer<typeof saveJobResultSchema>;
export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;
export type ExtractionCandidates = z.infer<typeof extractionCandidatesSchema>;
