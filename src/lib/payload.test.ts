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
        job_description:
          '\r\n# Build tools\r\n\r\nKeep  meaningful spacing.\r\n\r\n- First\r\n- Second\r\n',
        skills: [' TypeScript ', '', 'Chrome Extensions'],
        extraction_confidence: {
          job_title: 'high',
        },
      }),
    ).toEqual({
      source_platform: 'google',
      external_job_id: 'abc123',
      company_name: 'Acme',
      job_title: 'Senior Software Engineer',
      job_link: 'https://example.com/jobs/abc123',
      job_description:
        '# Build tools\n\nKeep  meaningful spacing.\n\n- First\n- Second',
      skills: ['TypeScript', 'Chrome Extensions'],
    });
  });

  it('deduplicates each taxonomy category case-insensitively, never across categories', () => {
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-4',
      company_name: 'Acme',
      job_title: 'Engineer',
      job_link: 'https://example.com/jobs/4',
      skills: ['Python', 'python', ' PYTHON ', 'CI/CD'],
      keywords: ['python', 'remote'],
      software: ['Docker', 'docker'],
    });

    // First spelling wins within a category.
    expect(payload.skills).toEqual(['Python', 'CI/CD']);
    expect(payload.software).toEqual(['Docker']);
    // The same name survives in a different category untouched.
    expect(payload.keywords).toEqual(['python', 'remote']);
  });

  it('caps every taxonomy category at 100 entries', () => {
    const oversized = Array.from({ length: 150 }, (_, i) => `Tag ${String(i)}`);
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-5',
      company_name: 'Acme',
      job_title: 'Engineer',
      job_link: 'https://example.com/jobs/5',
      certifications: oversized,
    });

    expect(payload.certifications).toHaveLength(100);
    expect(payload.certifications?.at(0)).toBe('Tag 0');
    expect(payload.certifications?.at(-1)).toBe('Tag 99');
  });

  it('omits empty taxonomy arrays instead of sending []', () => {
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-6',
      company_name: 'Acme',
      job_title: 'Engineer',
      job_link: 'https://example.com/jobs/6',
      skills: [],
      software: ['  ', ''],
      keywords: undefined,
    });

    expect(payload).not.toHaveProperty('skills');
    expect(payload).not.toHaveProperty('software');
    expect(payload).not.toHaveProperty('keywords');
    expect(payload).not.toHaveProperty('certifications');
  });

  it('preserves Markdown structure while scalar fields remain normalized', () => {
    const payload = buildScrapePayload({
      source_platform: 'linkedin',
      external_job_id: ' job   1 ',
      company_name: ' Acme   Corp ',
      job_title: ' Senior   Engineer ',
      job_link: 'https://example.com/jobs/1',
      job_description:
        '**Overview**  \nNext line\n\n## Requirements\n\n- TypeScript',
    });

    expect(payload.external_job_id).toBe('job 1');
    expect(payload.company_name).toBe('Acme Corp');
    expect(payload.job_title).toBe('Senior Engineer');
    expect(payload.job_description).toBe(
      '**Overview**  \nNext line\n\n## Requirements\n\n- TypeScript',
    );
  });

  it('removes blank outer lines without trimming meaningful line spacing', () => {
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-2',
      company_name: 'Acme',
      job_title: 'Engineer',
      job_link: 'https://example.com/jobs/2',
      job_description:
        '\r\n  \r\n    npm run build\r\nContinue here  \r\n\t\r\n',
    });

    expect(payload.job_description).toBe('    npm run build\nContinue here  ');
  });

  it('omits a whitespace-only Markdown description', () => {
    const payload = buildScrapePayload({
      source_platform: 'direct',
      external_job_id: 'job-3',
      company_name: 'Acme',
      job_title: 'Engineer',
      job_link: 'https://example.com/jobs/3',
      job_description: ' \r\n\t\r\n ',
    });

    expect(payload).not.toHaveProperty('job_description');
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
