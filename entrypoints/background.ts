import { browser } from 'wxt/browser';
import {
  type ExtensionErrorCode,
  type ExtensionMessage,
  type ExtensionResponse,
  extensionMessageSchema,
} from '../src/lib/messages';
import {
  ApiClientError,
  postScrapePayload,
  testAuthConnection,
} from '../src/lib/apiClient';
import { getValidAccessToken, signInWithAuthentik } from '../src/lib/oauth';
import { buildScrapePayload } from '../src/lib/payload';
import { type JobDraft, jobDraftSchema } from '../src/lib/schemas';
import { getSettings, saveSettings } from '../src/lib/settings';

let saveJobInFlight = false;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    const parsed = extensionMessageSchema.safeParse(message);
    if (!parsed.success) {
      return Promise.resolve(
        errorResponse('MESSAGE_INVALID', 'Unexpected extension message.'),
      );
    }

    return handleMessage(parsed.data);
  });
});

export async function handleMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  if (message.type === 'EXTRACT_ACTIVE_TAB') {
    return extractActiveTab();
  }

  if (message.type === 'SAVE_JOB') {
    return saveJob(message.draft);
  }

  if (message.type === 'GET_SETTINGS') {
    const settings = await getSettings();
    return { type: 'GET_SETTINGS_RESULT', ok: true, settings };
  }

  if (message.type === 'SAVE_SETTINGS') {
    const settings = await saveSettings(message.settings);
    return { type: 'SAVE_SETTINGS_RESULT', ok: true, settings };
  }

  if (message.type === 'OAUTH_SIGN_IN') {
    try {
      const settings = await signInWithAuthentik(await getSettings());
      return { type: 'SAVE_SETTINGS_RESULT', ok: true, settings };
    } catch (error) {
      return errorResponse(
        'OAUTH_FAILED',
        'Authentik sign-in failed.',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  if (message.type === 'TEST_CONNECTION') {
    return testConnection();
  }

  return errorResponse(
    'MESSAGE_UNHANDLED',
    'No handler is available for this action.',
  );
}

async function extractActiveTab(): Promise<ExtensionResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return errorResponse('TAB_NOT_FOUND', 'No active tab is available.');
  }

  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectVisibleJobDraft,
    });

    const draft = result?.result;
    if (!draft) {
      return errorResponse(
        'EXTRACT_EMPTY',
        'No job data was found on this page.',
      );
    }

    const parsedDraft = jobDraftSchema.safeParse(draft);
    if (!parsedDraft.success) {
      return errorResponse(
        'EXTRACT_FAILED',
        'The page returned job data in an unexpected shape.',
      );
    }

    return {
      type: 'EXTRACT_ACTIVE_TAB_RESULT',
      ok: true,
      draft: parsedDraft.data,
    };
  } catch {
    return errorResponse(
      'EXTRACT_FAILED',
      'Chrome could not read the active tab. Try reloading the page and opening the popup again.',
    );
  }
}

async function saveJob(draft: JobDraft): Promise<ExtensionResponse> {
  if (saveJobInFlight) {
    return errorResponse('SAVE_IN_PROGRESS', 'A save is already in progress.');
  }

  saveJobInFlight = true;
  try {
    const payload = buildScrapePayload(draft);
    const settings = await getSettings();
    const accessToken = await getValidAccessToken(settings);
    const result = await postScrapePayload(
      { ...settings, oauthAccessToken: accessToken },
      payload,
    );
    return { type: 'SAVE_JOB_RESULT', ok: true, payload, result };
  } catch (error) {
    if (error instanceof ApiClientError) {
      return errorResponse(error.code, error.message, error.details);
    }

    if (error instanceof Error && error.message.includes('Authentik')) {
      return errorResponse('OAUTH_FAILED', error.message);
    }

    if (error instanceof Error && error.message.includes('Sign in')) {
      return errorResponse('OAUTH_FAILED', error.message);
    }

    return errorResponse(
      'PAYLOAD_INVALID',
      'Review the required fields before saving this job.',
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    saveJobInFlight = false;
  }
}

async function testConnection(): Promise<ExtensionResponse> {
  try {
    const settings = await getSettings();
    const accessToken = await getValidAccessToken(settings);
    await testAuthConnection({ ...settings, oauthAccessToken: accessToken });
    return { type: 'TEST_CONNECTION_RESULT', ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) {
      return errorResponse(error.code, error.message, error.details);
    }

    if (error instanceof Error && error.message.includes('Sign in')) {
      return errorResponse('OAUTH_FAILED', error.message);
    }

    return errorResponse(
      'API_UNEXPECTED_RESPONSE',
      'Could not verify the Job Tracker API connection.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function errorResponse(
  code: ExtensionErrorCode,
  message: string,
  details?: string,
): ExtensionResponse {
  return { type: 'ERROR', ok: false, error: { code, message, details } };
}

function collectVisibleJobDraft(): JobDraft {
  const text = (selector: string): string | undefined => {
    const value = document.querySelector(selector)?.textContent?.trim();
    return value || undefined;
  };

  const meta = (name: string): string | undefined => {
    const selector = `meta[name="${name}"], meta[property="${name}"]`;
    const value = document
      .querySelector<HTMLMetaElement>(selector)
      ?.content?.trim();
    return value || undefined;
  };

  const canonical =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    location.href;
  const host = location.hostname.toLowerCase();
  const title = text('h1') || meta('og:title') || document.title;
  const description =
    meta('description') || meta('og:description') || text('main');

  return {
    source_platform: detectPlatform(host, location.href),
    external_job_id: inferExternalId(location.href, title),
    job_title: title?.replace(/\s+/g, ' ').trim(),
    company_name: meta('og:site_name') || host.replace(/^www\./, ''),
    job_link: canonical,
    job_description: description?.replace(/\s+/g, ' ').trim(),
    extraction_confidence: {
      job_title: title ? 'medium' : 'low',
      company_name: 'low',
      job_link: 'high',
    },
  };
}

function detectPlatform(
  host: string,
  url: string,
): JobDraft['source_platform'] {
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('indeed.com')) return 'indeed';
  if (host.includes('glassdoor.com')) return 'glassdoor';
  if (host.includes('dice.com')) return 'dice';
  if (host.includes('greenhouse.io')) return 'greenhouse';
  if (host.includes('lever.co')) return 'lever';
  if (host.includes('myworkdayjobs.com')) return 'workday';
  if (host.includes('wellfound.com') || host.includes('angel.co'))
    return 'angellist';
  if (host.includes('google.') && url.includes('ibp=htl')) return 'google';
  if (
    url.toLowerCase().includes('career') ||
    url.toLowerCase().includes('job')
  ) {
    return 'direct';
  }
  return 'other';
}

function inferExternalId(url: string, title?: string): string {
  const parsed = new URL(url);
  const indeedKey = parsed.searchParams.get('jk');
  if (indeedKey) return indeedKey;

  const pathId = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (pathId) return pathId.replace(/[^a-zA-Z0-9_-]/g, '-');

  return `${parsed.hostname}-${title || 'job'}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}
