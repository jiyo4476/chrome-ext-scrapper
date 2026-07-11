import { browser } from 'wxt/browser';
import {
  type ExtensionErrorCode,
  type ExtensionMessage,
  type ExtensionResponse,
  type ExtractionCandidate,
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
import {
  clearOAuthCredentials,
  getSettings,
  saveSettings,
  toPublicSettings,
} from '../src/lib/settings';

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
    return {
      type: 'GET_SETTINGS_RESULT',
      ok: true,
      settings: toPublicSettings(settings),
    };
  }

  if (message.type === 'SAVE_SETTINGS') {
    const settings = await saveSettings(message.settings);
    return {
      type: 'SAVE_SETTINGS_RESULT',
      ok: true,
      settings: toPublicSettings(settings),
    };
  }

  if (message.type === 'OAUTH_SIGN_IN') {
    try {
      await signInWithAuthentik(await getSettings());
      return { type: 'OAUTH_SIGN_IN_RESULT', ok: true };
    } catch (error) {
      return errorResponse(
        'OAUTH_FAILED',
        'Authentik sign-in failed.',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  if (message.type === 'OAUTH_SIGN_OUT') {
    await clearOAuthCredentials();
    return { type: 'OAUTH_SIGN_OUT_RESULT', ok: true };
  }

  if (message.type === 'GET_AUTH_STATUS') {
    try {
      await getValidAccessToken(await getSettings());
      return {
        type: 'GET_AUTH_STATUS_RESULT',
        ok: true,
        authenticated: true,
      };
    } catch {
      return {
        type: 'GET_AUTH_STATUS_RESULT',
        ok: true,
        authenticated: false,
      };
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
      candidates: filterInvalidCandidates(extraction.candidates),
    };
  } catch {
    return errorResponse(
      'EXTRACT_FAILED',
      'Chrome could not read the active tab. Try reloading the page and opening the popup again.',
    );
  }
}

// safeParseDraftWithFallback strips invalid fields out of the returned
// draft, but the raw candidates object it's paired with comes from the same
// unvalidated page-script output -- without this, the field-review picker
// could still offer a value that was just rejected from the draft as a
// selectable option. Drop any candidate whose value doesn't pass its
// field's own schema, so the picker never re-surfaces something already
// known to be invalid.
function filterInvalidCandidates(
  candidates: unknown,
): Record<string, ExtractionCandidate[]> {
  if (!candidates || typeof candidates !== 'object') return {};

  const shape = jobDraftSchema.shape as Record<
    string,
    { safeParse: (value: unknown) => { success: boolean } }
  >;
  const filtered: Record<string, ExtractionCandidate[]> = {};

  for (const [field, list] of Object.entries(
    candidates as Record<string, unknown>,
  ).slice(0, 30)) {
    const fieldSchema = shape[field];
    if (!fieldSchema || !Array.isArray(list)) continue;

    const validList = (list as ExtractionCandidate[])
      .slice(0, 20)
      .filter((candidate) => fieldSchema.safeParse(candidate.value).success);
    if (validList.length > 0) {
      filtered[field] = validList;
    }
  }

  return filtered;
}

function safeParseDraftWithFallback(raw: unknown) {
  const first = jobDraftSchema.safeParse(raw);
  if (
    first.success ||
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return first;
  }

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
