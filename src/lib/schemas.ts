import { z } from 'zod';

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

export const detectedPlatformSchema = apiSourcePlatformSchema;

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
  source_platform: detectedPlatformSchema.default('other'),
  external_job_id: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  job_title: z.string().min(1).optional(),
  job_link: z.string().url().optional(),
  job_location: z.string().min(1).optional(),
  is_remote: z.boolean().optional(),
  job_description: z.string().optional(),
  date_posted: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  salary_text: z.string().min(1).optional(),
  salary_type: salaryTypeSchema.optional(),
  salary_min: z.number().int().nonnegative().optional(),
  salary_max: z.number().int().nonnegative().optional(),
  hourly_rate_min: z.number().nonnegative().optional(),
  hourly_rate_max: z.number().nonnegative().optional(),
  job_type: jobTypeSchema.optional(),
  experience_level: experienceLevelSchema.optional(),
  security_clearance_req: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  software: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
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
export type DetectedPlatform = z.infer<typeof detectedPlatformSchema>;
export type JobDraft = z.infer<typeof jobDraftSchema>;
export type ScrapePayload = z.infer<typeof scrapePayloadSchema>;
