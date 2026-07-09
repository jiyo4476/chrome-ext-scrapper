import { describe, expect, it } from 'vitest';
import {
  scrapePayloadSchema,
  toApiSourcePlatform,
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

  it('keeps Google Jobs compatible with the current backend enum', () => {
    expect(toApiSourcePlatform('google')).toBe('other');
  });
});
