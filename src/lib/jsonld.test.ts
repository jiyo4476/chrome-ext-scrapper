import { describe, expect, it } from 'vitest';
import { buildExportFilename, buildJobPostingJsonLd } from './jsonld';
import type { JobDraft } from './schemas';

const baseDraft: JobDraft = {
  source_platform: 'indeed',
  external_job_id: 'abc123',
  company_name: 'Acme Corp',
  job_title: 'Senior Software Engineer',
  job_link: 'https://example.com/jobs/abc123',
  job_location: 'Austin, TX',
  is_remote: true,
  job_description: 'Build great software.',
  date_posted: '2026-07-01',
  job_type: 'full_time',
};

describe('buildJobPostingJsonLd', () => {
  it('maps a full draft to the correct JobPosting shape', () => {
    expect(buildJobPostingJsonLd(baseDraft)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Software Engineer',
      description: 'Build great software.',
      datePosted: '2026-07-01',
      employmentType: 'FULL_TIME',
      hiringOrganization: { '@type': 'Organization', name: 'Acme Corp' },
      jobLocation: { '@type': 'Place', address: 'Austin, TX' },
      jobLocationType: 'TELECOMMUTE',
      identifier: { '@type': 'PropertyValue', value: 'abc123' },
      url: 'https://example.com/jobs/abc123',
    });
  });

  it('converts annual salary cents to dollars', () => {
    const result = buildJobPostingJsonLd({
      ...baseDraft,
      salary_min: 10_000_000,
      salary_max: 15_000_000,
    });

    expect(result.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: 100_000,
        maxValue: 150_000,
        unitText: 'YEAR',
      },
    });
  });

  it('passes hourly rates through as-is', () => {
    const result = buildJobPostingJsonLd({
      source_platform: 'other',
      hourly_rate_min: 45.5,
      hourly_rate_max: 60,
    });

    expect(result.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: 45.5,
        maxValue: 60,
        unitText: 'HOUR',
      },
    });
  });

  it('omits missing optional fields instead of emitting undefined keys', () => {
    const result = buildJobPostingJsonLd({ source_platform: 'other' });

    expect(Object.keys(result)).toEqual(['@context', '@type']);
    expect(result).not.toHaveProperty('title');
    expect(result).not.toHaveProperty('baseSalary');
    expect(result).not.toHaveProperty('hiringOrganization');
    expect(JSON.stringify(result)).not.toContain('undefined');
  });

  it('maps every job_type to its schema.org employmentType', () => {
    const cases: [JobDraft['job_type'], string][] = [
      ['full_time', 'FULL_TIME'],
      ['part_time', 'PART_TIME'],
      ['contract', 'CONTRACTOR'],
      ['internship', 'INTERN'],
      ['temp', 'TEMPORARY'],
      ['freelance', 'CONTRACTOR'],
    ];

    for (const [jobType, expected] of cases) {
      const result = buildJobPostingJsonLd({
        source_platform: 'other',
        job_type: jobType,
      });
      expect(result.employmentType).toBe(expected);
    }
  });

  it('never includes OAuth tokens, API keys, or settings-shaped data', () => {
    const result = buildJobPostingJsonLd(baseDraft);
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('oauthaccesstoken');
    expect(serialized).not.toContain('oauthrefreshtoken');
    expect(serialized).not.toContain('apikey');
  });
});

describe('buildExportFilename', () => {
  it('builds a lowercase, hyphenated filename from company and title', () => {
    expect(
      buildExportFilename({
        source_platform: 'other',
        company_name: 'Acme Corp',
        job_title: 'Senior Software Engineer',
      }),
    ).toBe('acme-corp_senior-software-engineer.jsonld');
  });

  it('collapses special and unicode characters into single hyphens', () => {
    expect(
      buildExportFilename({
        source_platform: 'other',
        company_name: 'Ácme & Sons!!',
        job_title: 'Engineer (Remote) — Team #2',
      }),
    ).toMatch(/^[a-z0-9-]+_[a-z0-9-]+\.jsonld$/);
  });

  it('truncates very long names to 40 characters per part', () => {
    const longName = 'a'.repeat(100);
    const filename = buildExportFilename({
      source_platform: 'other',
      company_name: longName,
      job_title: longName,
    });

    const [company, titleWithExt] = filename.split('_');
    expect(company?.length).toBeLessThanOrEqual(40);
    expect(titleWithExt?.replace('.jsonld', '').length).toBeLessThanOrEqual(40);
  });

  it('falls back to job-posting.jsonld when both parts are empty', () => {
    expect(buildExportFilename({ source_platform: 'other' })).toBe(
      'job-posting.jsonld',
    );

    expect(
      buildExportFilename({
        source_platform: 'other',
        company_name: '!!!',
        job_title: '###',
      }),
    ).toBe('job-posting.jsonld');
  });

  it('never lets a path-traversal-looking company name escape the filename', () => {
    const filename = buildExportFilename({
      source_platform: 'other',
      company_name: '../../etc/passwd',
      job_title: 'Engineer',
    });

    expect(filename).not.toContain('/');
    expect(filename).not.toContain('..');
    expect(filename.endsWith('.jsonld')).toBe(true);
  });
});
