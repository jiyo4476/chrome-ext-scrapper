import { describe, expect, it } from 'vitest';
import {
  MAX_JOB_DESCRIPTION_LENGTH,
  MAX_TAGS_PER_FIELD,
  scrapePayloadSchema,
  type ScrapePayload,
} from './schemas';

describe('scrape payload schema', () => {
  const basePayload: ScrapePayload = {
    source_platform: 'indeed',
    external_job_id: 'abc123',
    company_name: 'Acme',
    job_title: 'Software Engineer',
    job_link: 'https://example.com/jobs/abc123',
  };

  it('accepts the verified minimum API payload', () => {
    expect(scrapePayloadSchema.parse(basePayload)).toEqual(basePayload);
  });

  it('rejects null optional fields so callers omit empty values', () => {
    expect(() =>
      scrapePayloadSchema.parse({
        ...basePayload,
        job_location: null,
      }),
    ).toThrow();
  });

  it('accepts google as a source_platform now that the backend enum supports it', () => {
    const result = scrapePayloadSchema.parse({
      ...basePayload,
      source_platform: 'google',
    });
    expect(result.source_platform).toBe('google');
  });

  it('rejects oversized page-controlled descriptions and tag arrays', () => {
    expect(() =>
      scrapePayloadSchema.parse({
        ...basePayload,
        job_description: 'x'.repeat(MAX_JOB_DESCRIPTION_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      scrapePayloadSchema.parse({
        ...basePayload,
        skills: Array.from({ length: MAX_TAGS_PER_FIELD + 1 }, () => 'x'),
      }),
    ).toThrow();
  });
});
