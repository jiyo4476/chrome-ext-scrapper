import type { ApiSourcePlatform } from '../schemas';

export type PlatformConfidence = 'high' | 'low';

export interface PlatformDetection {
  platform: ApiSourcePlatform;
  confidence: PlatformConfidence;
  externalJobId?: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export const AUTO_SCRAPE_DOMAINS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'dice.com',
  'greenhouse.io',
  'lever.co',
  'myworkdayjobs.com',
  'wellfound.com',
  'angel.co',
  'builtin.com',
  'builtincolorado.com',
] as const;

function pathSegmentAfter(path: string, segment: string): string | undefined {
  const parts = path.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === segment);
  return index >= 0 ? parts[index + 1] : undefined;
}

function finalPathSegment(path: string): string | undefined {
  return path.split('/').filter(Boolean).at(-1);
}

function getIndeedJobId(parsed: URL): string | undefined {
  return (
    parsed.searchParams.get('jk') ?? parsed.searchParams.get('vjk') ?? undefined
  );
}

export function isAutoScrapeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '') || '/';

  if (!AUTO_SCRAPE_DOMAINS.some((domain) => hostMatches(host, domain))) {
    return false;
  }

  if (hostMatches(host, 'linkedin.com')) {
    return path.startsWith('/jobs/view/') || path.startsWith('/jobs/search');
  }
  if (hostMatches(host, 'indeed.com')) {
    return (
      Boolean(getIndeedJobId(parsed)) &&
      (path === '/viewjob' || path === '/jobs')
    );
  }
  if (hostMatches(host, 'glassdoor.com')) {
    return path.includes('/job-listing/');
  }
  if (hostMatches(host, 'dice.com')) {
    return path.startsWith('/job-detail/');
  }
  if (hostMatches(host, 'greenhouse.io')) {
    return /\/jobs\/[^/]+$/i.test(path);
  }
  if (hostMatches(host, 'lever.co')) {
    return path.split('/').filter(Boolean).length === 2;
  }
  if (hostMatches(host, 'myworkdayjobs.com')) {
    return path.includes('/job/');
  }
  if (hostMatches(host, 'wellfound.com')) {
    return path.startsWith('/jobs/');
  }
  if (hostMatches(host, 'angel.co')) {
    return path.includes('/jobs/');
  }
  if (
    hostMatches(host, 'builtin.com') ||
    hostMatches(host, 'builtincolorado.com')
  ) {
    return /\/job\/[^/]+\/\d+$/i.test(path);
  }
  return false;
}

// Google serves the same job-search UI across many country TLDs. A regex
// like /google\.[a-z.]+$/ would re-open the exact spoofing bug this module
// exists to fix (it would also match e.g. "google.com.evil.example", since
// "com.evil.example" is itself all [a-z.] characters) -- there is no way to
// validate a "real" multi-label TLD without a public-suffix list, so match
// against a bounded, explicit allowlist via the same exact-or-suffix rule
// used above instead. This list covers Google's major-market ccTLDs; it is
// not exhaustive (Google operates ~190 country domains) but TLDs not listed
// here safely fall through to the 'direct'/'other' branches -- degraded
// detection quality, not a spoofing risk -- rather than being misdetected.
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
  'google.pl',
  'google.ru',
  'google.se',
  'google.no',
  'google.dk',
  'google.fi',
  'google.at',
  'google.ch',
  'google.be',
  'google.pt',
  'google.gr',
  'google.co.kr',
  'google.com.sg',
  'google.com.hk',
  'google.co.th',
  'google.co.id',
  'google.com.tw',
  'google.co.za',
  'google.com.ar',
  'google.cl',
  'google.com.co',
  'google.com.pe',
  'google.com.ph',
  'google.com.my',
  'google.com.eg',
  'google.com.sa',
  'google.ae',
  'google.com.pk',
  'google.com.vn',
  'google.cz',
  'google.sk',
  'google.hu',
  'google.ro',
  'google.bg',
  'google.hr',
  'google.si',
  'google.lt',
  'google.lv',
  'google.ee',
  'google.is',
  'google.com.ua',
  'google.by',
  'google.co.il',
  'google.com.tr',
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
    const externalJobId = getIndeedJobId(new URL(url));
    return {
      platform: 'indeed',
      confidence: 'high',
      ...(externalJobId ? { externalJobId } : {}),
    };
  }
  if (hostMatches(host, 'glassdoor.com')) {
    return { platform: 'glassdoor', confidence: 'high' };
  }
  if (hostMatches(host, 'dice.com')) {
    return { platform: 'dice', confidence: 'high' };
  }
  if (hostMatches(host, 'greenhouse.io')) {
    const externalJobId = pathSegmentAfter(new URL(url).pathname, 'jobs');
    return {
      platform: 'greenhouse',
      confidence: 'high',
      ...(externalJobId ? { externalJobId } : {}),
    };
  }
  if (hostMatches(host, 'lever.co')) {
    const externalJobId = finalPathSegment(new URL(url).pathname);
    return {
      platform: 'lever',
      confidence: 'high',
      ...(externalJobId ? { externalJobId } : {}),
    };
  }
  if (hostMatches(host, 'myworkdayjobs.com')) {
    return { platform: 'workday', confidence: 'high' };
  }
  if (hostMatches(host, 'wellfound.com') || hostMatches(host, 'angel.co')) {
    const externalJobId = pathSegmentAfter(new URL(url).pathname, 'jobs');
    return {
      platform: 'angellist',
      confidence: 'high',
      ...(externalJobId ? { externalJobId } : {}),
    };
  }
  if (
    hostMatches(host, 'builtin.com') ||
    hostMatches(host, 'builtincolorado.com')
  ) {
    const externalJobId = finalPathSegment(new URL(url).pathname);
    if (/\/job\/[^/]+\/\d+\/?$/i.test(new URL(url).pathname)) {
      return {
        platform: 'direct',
        confidence: 'high',
        ...(externalJobId ? { externalJobId } : {}),
      };
    }
  }
  if (isGoogleHost(host) && lowerUrl.includes('ibp=htl')) {
    return { platform: 'google', confidence: 'high' };
  }
  if (lowerUrl.includes('career') || lowerUrl.includes('job')) {
    return { platform: 'direct', confidence: 'low' };
  }
  return { platform: 'other', confidence: 'low' };
}
