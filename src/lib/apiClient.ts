import { z } from 'zod';
import { type SaveJobResult, saveJobResultSchema } from './messages';
import type { ScrapePayload } from './schemas';
import type { ExtensionSettings } from './settings';

export class ApiClientError extends Error {
  constructor(
    readonly code:
      | 'API_UNCONFIGURED'
      | 'API_AUTH_FAILED'
      | 'API_VALIDATION_FAILED'
      | 'API_NETWORK_FAILED'
      | 'API_UNEXPECTED_RESPONSE',
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function postScrapePayload(
  settings: ExtensionSettings,
  payload: ScrapePayload,
): Promise<SaveJobResult> {
  const apiBaseUrl = getApiBaseUrl(settings);

  const response = await fetch(`${apiBaseUrl}/api/scrape`, {
    method: 'POST',
    headers: buildHeaders(settings),
    body: JSON.stringify(payload),
  }).catch((error: unknown) => {
    throw new ApiClientError(
      'API_NETWORK_FAILED',
      'Could not reach the Job Tracker API.',
      stringifyUnknown(error),
    );
  });

  const responseBody = await readJsonResponse(response);
  if (response.status === 401 || response.status === 403) {
    throw new ApiClientError(
      'API_AUTH_FAILED',
      'The Job Tracker API rejected these credentials.',
    );
  }

  if (response.status === 422 || response.status === 400) {
    throw new ApiClientError(
      'API_VALIDATION_FAILED',
      'The Job Tracker API rejected this job payload.',
      JSON.stringify(responseBody),
    );
  }

  if (!response.ok) {
    throw new ApiClientError(
      'API_UNEXPECTED_RESPONSE',
      `The Job Tracker API returned HTTP ${String(response.status)}.`,
      JSON.stringify(responseBody),
    );
  }

  return saveJobResultSchema.parse(responseBody ?? {});
}

export async function testAuthConnection(
  settings: ExtensionSettings,
): Promise<void> {
  const apiBaseUrl = getApiBaseUrl(settings);
  const response = await fetch(`${apiBaseUrl}/api/health/auth`, {
    method: 'GET',
    headers: buildHeaders(settings),
  }).catch((error: unknown) => {
    throw new ApiClientError(
      'API_NETWORK_FAILED',
      'Could not reach the Job Tracker API.',
      stringifyUnknown(error),
    );
  });

  const responseBody = await readJsonResponse(response);
  if (response.status === 401 || response.status === 403) {
    throw new ApiClientError(
      'API_AUTH_FAILED',
      'The Job Tracker API rejected these credentials.',
      JSON.stringify(responseBody),
    );
  }

  if (!response.ok) {
    throw new ApiClientError(
      'API_UNEXPECTED_RESPONSE',
      `The Job Tracker API returned HTTP ${String(response.status)}.`,
      JSON.stringify(responseBody),
    );
  }
}

function getApiBaseUrl(settings: ExtensionSettings): string {
  const apiBaseUrl = settings.apiBaseUrl.trim().replace(/\/+$/, '');
  if (!apiBaseUrl) {
    throw new ApiClientError(
      'API_UNCONFIGURED',
      'Add an API base URL in Settings before connecting.',
    );
  }

  return apiBaseUrl;
}

function buildHeaders(settings: ExtensionSettings): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const accessToken = settings.oauthAccessToken.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiClientError(
      'API_UNEXPECTED_RESPONSE',
      'The Job Tracker API returned a non-JSON response.',
      stringifyUnknown(error),
    );
  }
}

function stringifyUnknown(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  const parsed = z.string().safeParse(error);
  return parsed.success ? parsed.data : undefined;
}
