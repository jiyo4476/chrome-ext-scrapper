import type { ApiSourcePlatform } from '../schemas';

export type PlatformConfidence = 'high' | 'low';

export interface PlatformDetection {
  platform: ApiSourcePlatform;
  confidence: PlatformConfidence;
}

export function detectPlatform(url: string): PlatformDetection {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const lowerUrl = (url || '').toLowerCase();

  if (host.includes('linkedin.com')) {
    return { platform: 'linkedin', confidence: 'high' };
  }
  if (host.includes('indeed.com')) {
    return { platform: 'indeed', confidence: 'high' };
  }
  if (host.includes('glassdoor.com')) {
    return { platform: 'glassdoor', confidence: 'high' };
  }
  if (host.includes('dice.com')) {
    return { platform: 'dice', confidence: 'high' };
  }
  if (host.includes('greenhouse.io')) {
    return { platform: 'greenhouse', confidence: 'high' };
  }
  if (host.includes('lever.co')) {
    return { platform: 'lever', confidence: 'high' };
  }
  if (host.includes('myworkdayjobs.com')) {
    return { platform: 'workday', confidence: 'high' };
  }
  if (host.includes('wellfound.com') || host.includes('angel.co')) {
    return { platform: 'angellist', confidence: 'high' };
  }
  if (host.includes('google.') && lowerUrl.includes('ibp=htl')) {
    return { platform: 'google', confidence: 'high' };
  }
  if (lowerUrl.includes('career') || lowerUrl.includes('job')) {
    return { platform: 'direct', confidence: 'low' };
  }
  return { platform: 'other', confidence: 'low' };
}
