import { describe, expect, it } from 'vitest';
import { detectPlatform } from './detectPlatform';

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
  ])('detects %s as %s with high confidence', (url, expectedPlatform) => {
    expect(detectPlatform(url)).toEqual({
      platform: expectedPlatform,
      confidence: 'high',
    });
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
