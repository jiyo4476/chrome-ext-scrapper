import { describe, expect, it } from 'vitest';
import { detectPlatform, isAutoScrapeUrl } from './detectPlatform';

describe('detectPlatform', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/123', 'linkedin'],
    ['https://www.indeed.com/viewjob?jk=abc123', 'indeed'],
    ['https://www.glassdoor.com/job-listing/foo.htm', 'glassdoor'],
    ['https://www.dice.com/job-detail/123', 'dice'],
    ['https://boards.greenhouse.io/hiringco/jobs/456', 'greenhouse'],
    ['https://jobs.lever.co/hiringco/123', 'lever'],
    ['https://hiringco.myworkdayjobs.com/careers/job/123', 'workday'],
    ['https://wellfound.com/jobs/123', 'angellist'],
    ['https://angel.co/company/foo/jobs/123', 'angellist'],
    ['https://www.builtincolorado.com/job/platform-engineer/9764574', 'direct'],
    ['https://builtin.com/job/platform-engineer/9764574', 'direct'],
  ])('detects %s as %s with high confidence', (url, expectedPlatform) => {
    expect(detectPlatform(url)).toMatchObject({
      platform: expectedPlatform,
      confidence: 'high',
    });
  });

  it('carries the canonical Indeed job ID into the extraction context', () => {
    expect(
      detectPlatform('https://www.indeed.com/jobs?q=engineer&vjk=selected-123'),
    ).toMatchObject({
      platform: 'indeed',
      externalJobId: 'selected-123',
    });
  });

  it.each([
    ['https://boards.greenhouse.io/hiringco/jobs/456789', '456789'],
    ['https://jobs.lever.co/hiringco/lever-posting-id', 'lever-posting-id'],
    [
      'https://wellfound.com/jobs/123456-senior-engineer',
      '123456-senior-engineer',
    ],
    ['https://builtin.com/job/platform-engineer/9764574', '9764574'],
  ])('carries the stable job ID from %s', (url, externalJobId) => {
    expect(detectPlatform(url).externalJobId).toBe(externalJobId);
  });

  it('detects a Google Jobs search results URL as google with high confidence', () => {
    expect(
      detectPlatform(
        'https://www.google.com/search?q=software+engineer&ibp=htl;jobs',
      ),
    ).toEqual({ platform: 'google', confidence: 'high' });
  });

  it('does not treat a non-Google host as google even with a matching query param', () => {
    const result = detectPlatform('https://example.com/jobs?ibp=htl;jobs');
    expect(result.platform).not.toBe('google');
  });

  it.each([
    'google.co.uk',
    'google.pl',
    'google.ru',
    'google.se',
    'google.co.kr',
    'google.com.sg',
    'google.co.id',
    'google.com.tw',
    'google.co.za',
    'google.com.tr',
  ])(
    'detects %s as google, matching Google Jobs across country TLDs',
    (host) => {
      expect(
        detectPlatform(`https://www.${host}/search?q=engineer&ibp=htl;jobs`),
      ).toEqual({ platform: 'google', confidence: 'high' });
    },
  );

  it.each([
    ['https://www.indeed.com.evil-phishing.example/viewjob?jk=1', 'indeed'],
    ['https://linkedin.com.attacker.net/jobs/view/1', 'linkedin'],
    ['https://notglassdoor.com/job-listing/foo.htm', 'glassdoor'],
    ['https://www.google.com.evil.example/search?ibp=htl;jobs', 'google'],
  ])(
    'does not misclassify a lookalike domain that merely contains %s as that platform',
    (url, spoofedPlatform) => {
      expect(detectPlatform(url).platform).not.toBe(spoofedPlatform);
    },
  );

  it('falls back to direct with low confidence for career/job URLs on unknown hosts', () => {
    expect(detectPlatform('https://acme.example.com/careers/123')).toEqual({
      platform: 'direct',
      confidence: 'low',
    });
    expect(detectPlatform('https://acme.example.com/jobs/123')).toEqual({
      platform: 'direct',
      confidence: 'low',
    });
  });

  it('falls back to other with low confidence for unrecognized URLs', () => {
    expect(detectPlatform('https://example.com/about')).toEqual({
      platform: 'other',
      confidence: 'low',
    });
  });

  it('does not assign high confidence to a Built In non-job page', () => {
    expect(detectPlatform('https://builtin.com/')).toEqual({
      platform: 'other',
      confidence: 'low',
    });
  });

  it('falls back to other with low confidence for an empty or malformed URL', () => {
    expect(detectPlatform('')).toEqual({
      platform: 'other',
      confidence: 'low',
    });
    expect(detectPlatform('not a url')).toEqual({
      platform: 'other',
      confidence: 'low',
    });
  });
});

describe('isAutoScrapeUrl', () => {
  it.each([
    'https://www.linkedin.com/jobs/view/123',
    'https://www.linkedin.com/jobs/search/?keywords=engineer',
    'https://www.indeed.com/viewjob?jk=abc123',
    'https://www.indeed.com/viewjob/?jk=abc123',
    'https://www.indeed.com/jobs?q=engineer&vjk=abc123',
    'https://www.indeed.com/jobs/?q=engineer&vjk=abc123',
    'https://www.glassdoor.com/job-listing/software-engineer-acme.htm?jl=123',
    'https://www.dice.com/job-detail/123e4567-e89b-12d3-a456-426614174000',
    'https://boards.greenhouse.io/hiringco/jobs/456789',
    'https://job-boards.greenhouse.io/hiringco/jobs/456789',
    'https://boards.greenhouse.io/hiringco/jobs/456789/',
    'https://job-boards.greenhouse.io/hiringco/jobs/456789/',
    'https://jobs.lever.co/hiringco/lever-posting-id',
    'https://hiringco.myworkdayjobs.com/careers/job/Denver-CO/Engineer/R-1234',
    'https://wellfound.com/jobs/123456-senior-engineer',
    'https://angel.co/company/acme/jobs/123456-senior-engineer',
    'https://www.builtincolorado.com/job/platform-engineer/9764574',
    'https://builtin.com/job/platform-engineer/9764574',
  ])('allows a supported provider job page: %s', (url) => {
    expect(isAutoScrapeUrl(url)).toBe(true);
  });

  it.each([
    'http://www.linkedin.com/jobs/view/123',
    'https://www.linkedin.com/feed/',
    'https://www.indeed.com/companies',
    'https://www.indeed.com/jobs?q=engineer',
    'https://www.indeed.com/viewjob',
    'https://www.glassdoor.com/Reviews/index.htm',
    'https://www.dice.com/companies',
    'https://boards.greenhouse.io/hiringco',
    'https://jobs.lever.co/hiringco/lever-posting-id/apply',
    'https://hiringco.myworkdayjobs.com/careers/search',
    'https://hiringco.myworkdayjobs.com/careers/job/Denver-CO/Engineer/R-1234/apply',
    'https://wellfound.com/jobs',
    'https://wellfound.com/jobs/',
    'https://wellfound.com/jobs/123456-senior-engineer/apply',
    'https://angel.co/company/acme/jobs/',
    'https://angel.co/company/acme/jobs/123456-senior-engineer/apply',
    'https://builtin.com/jobs',
    'https://linkedin.com.attacker.net/jobs/view/123',
    'https://www.indeed.com.evil.example/viewjob?jk=abc123',
    'https://example.com/jobs/123',
    'chrome://extensions/',
  ])('rejects unsupported domains and non-job routes: %s', (url) => {
    expect(isAutoScrapeUrl(url)).toBe(false);
  });
});
