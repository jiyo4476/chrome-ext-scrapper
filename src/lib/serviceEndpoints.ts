export const DEFAULT_JOB_TRACKER_API_ENDPOINT = 'http://jobtracker.local';
export const DEFAULT_OAUTH2_ENDPOINT = 'https://auth.yjimmy.dev';

export function resolveServiceEndpoint(
  value: string | undefined,
  fallback: string,
): string {
  const candidate = value?.trim() || fallback;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    return candidate.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}
