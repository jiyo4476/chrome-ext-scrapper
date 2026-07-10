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
import { detectPlatform } from '../src/lib/extraction/detectPlatform';
import { extractJobDraft } from '../src/lib/extraction/jobDraftExtractor';
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

  const detection = detectPlatform(tab.url ?? '');

  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobDraft,
      args: [detection],
    });

    const extraction = result?.result;
    if (!extraction) {
      return errorResponse(
        'EXTRACT_EMPTY',
        'No job data was found on this page.',
      );
    }

    const parsedDraft = safeParseDraftWithFallback(extraction.draft);
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
      candidates: extraction.candidates,
    };
  } catch {
    return errorResponse(
      'EXTRACT_FAILED',
      'Chrome could not read the active tab. Try reloading the page and opening the popup again.',
    );
  }
}

function safeParseDraftWithFallback(raw: unknown) {
  const first = jobDraftSchema.safeParse(raw);
  if (first.success || typeof raw !== 'object' || raw === null) return first;

  const cleaned: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  };
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && key in cleaned) {
      Reflect.deleteProperty(cleaned, key);
    }
  }
  return jobDraftSchema.safeParse(cleaned);
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
