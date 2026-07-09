import { describe, expect, it } from 'vitest';
import { buildScrapePayload } from './payload';

describe('buildScrapePayload', () => {
  it('normalizes a draft into the backend scrape payload', () => {
    expect(
      buildScrapePayload({
        source_platform: 'google',
        external_job_id: ' abc123 ',
        company_name: ' Acme ',
        job_title: ' Senior   Software Engineer ',
        job_link: 'https://example.com/jobs/abc123',
        job_description: ' Build   tools. ',
        skills: [' TypeScript ', '', 'Chrome Extensions'],
        extraction_confidence: {
          job_title: 'high',
        },
      }),
    ).toEqual({
      source_platform: 'other',
      external_job_id: 'abc123',
      company_name: 'Acme',
      job_title: 'Senior Software Engineer',
      job_link: 'https://example.com/jobs/abc123',
      job_description: 'Build tools.',
      skills: ['TypeScript', 'Chrome Extensions'],
    });
  });

  it('omits posting_md_path because the extension cannot create server files', () => {
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-1',
      company_name: 'Acme',
      job_title: 'Software Engineer',
      job_link: 'https://example.com/jobs/job-1',
    });

    expect(payload).not.toHaveProperty('posting_md_path');
  });
});
