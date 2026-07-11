import { z } from 'zod';

export const MAX_JOB_DESCRIPTION_LENGTH = 50_000;
export const MAX_FIELD_LENGTH = 2_000;
export const MAX_TAGS_PER_FIELD = 100;
export const MAX_TAG_LENGTH = 200;

const optionalText = z.string().min(1).max(MAX_FIELD_LENGTH).optional();
const optionalTags = z
  .array(z.string().min(1).max(MAX_TAG_LENGTH))
  .max(MAX_TAGS_PER_FIELD)
  .optional();

export const apiSourcePlatformSchema = z.enum([
  'linkedin',
  'indeed',
  'glassdoor',
  'dice',
  'lever',
  'greenhouse',
  'workday',
  'angellist',
  'direct',
  'other',
  'google',
]);

export const jobTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temp',
  'freelance',
]);

export const experienceLevelSchema = z.enum([
  'entry',
  'mid',
  'senior',
  'lead',
  'executive',
]);

export const salaryTypeSchema = z.enum(['annual', 'hourly']);

export const jobDraftSchema = z.object({
  source_platform: apiSourcePlatformSchema.default('other'),
  external_job_id: optionalText,
  company_name: optionalText,
  job_title: optionalText,
  job_link: z.string().max(MAX_FIELD_LENGTH).url().optional(),
  job_location: optionalText,
  is_remote: z.boolean().optional(),
  job_description: z.string().max(MAX_JOB_DESCRIPTION_LENGTH).optional(),
  date_posted: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  salary_text: optionalText,
  salary_type: salaryTypeSchema.optional(),
  salary_min: z.number().int().nonnegative().optional(),
  salary_max: z.number().int().nonnegative().optional(),
  hourly_rate_min: z.number().nonnegative().optional(),
  hourly_rate_max: z.number().nonnegative().optional(),
  job_type: jobTypeSchema.optional(),
  experience_level: experienceLevelSchema.optional(),
  security_clearance_req: z.boolean().optional(),
  skills: optionalTags,
  software: optionalTags,
  keywords: optionalTags,
  certifications: optionalTags,
  extraction_confidence: z.record(z.enum(['high', 'medium', 'low'])).optional(),
});

export const scrapePayloadSchema = jobDraftSchema
  .extend({
    source_platform: apiSourcePlatformSchema,
    external_job_id: z.string().min(1),
    company_name: z.string().min(1),
    job_title: z.string().min(1),
    job_link: z.string().url(),
  })
  .omit({ extraction_confidence: true });

export type ApiSourcePlatform = z.infer<typeof apiSourcePlatformSchema>;
export type JobDraft = z.infer<typeof jobDraftSchema>;
export type ScrapePayload = z.infer<typeof scrapePayloadSchema>;
