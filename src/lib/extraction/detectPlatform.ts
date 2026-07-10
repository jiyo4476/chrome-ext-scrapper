import type { ApiSourcePlatform } from '../schemas';

export type PlatformConfidence = 'high' | 'low';

export interface PlatformDetection {
  platform: ApiSourcePlatform;
  confidence: PlatformConfidence;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// Google serves the same job-search UI across many country TLDs. A regex
// like /google\.[a-z.]+$/ would re-open the exact spoofing bug this module
// exists to fix (it would also match e.g. "google.com.evil.example", since
// "com.evil.example" is itself all [a-z.] characters) -- there is no way to
// validate a "real" multi-label TLD without a public-suffix list, so match
// against a bounded, explicit allowlist via the same exact-or-suffix rule
// used above instead. TLDs not listed here safely fall through to the
// 'direct'/'other' branches rather than being misdetected.
const GOOGLE_SEARCH_HOSTS = [
  'google.com',
  'google.co.uk',
  'google.ca',
  'google.com.au',
  'google.de',
  'google.fr',
  'google.es',
  'google.it',
  'google.co.jp',
  'google.co.in',
  'google.com.br',
  'google.com.mx',
  'google.nl',
  'google.co.nz',
  'google.ie',
];

function isGoogleHost(host: string): boolean {
  return GOOGLE_SEARCH_HOSTS.some((domain) => hostMatches(host, domain));
}

export function detectPlatform(url: string): PlatformDetection {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const lowerUrl = (url || '').toLowerCase();

  if (hostMatches(host, 'linkedin.com')) {
    return { platform: 'linkedin', confidence: 'high' };
  }
  if (hostMatches(host, 'indeed.com')) {
    return { platform: 'indeed', confidence: 'high' };
  }
  if (hostMatches(host, 'glassdoor.com')) {
    return { platform: 'glassdoor', confidence: 'high' };
  }
  if (hostMatches(host, 'dice.com')) {
    return { platform: 'dice', confidence: 'high' };
  }
  if (hostMatches(host, 'greenhouse.io')) {
    return { platform: 'greenhouse', confidence: 'high' };
  }
  if (hostMatches(host, 'lever.co')) {
    return { platform: 'lever', confidence: 'high' };
  }
  if (hostMatches(host, 'myworkdayjobs.com')) {
    return { platform: 'workday', confidence: 'high' };
  }
  if (hostMatches(host, 'wellfound.com') || hostMatches(host, 'angel.co')) {
    return { platform: 'angellist', confidence: 'high' };
  }
  if (isGoogleHost(host) && lowerUrl.includes('ibp=htl')) {
    return { platform: 'google', confidence: 'high' };
  }
  if (lowerUrl.includes('career') || lowerUrl.includes('job')) {
    return { platform: 'direct', confidence: 'low' };
  }
  return { platform: 'other', confidence: 'low' };
}
