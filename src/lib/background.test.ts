import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_DRAFT_EXTRACTOR_BRIDGE_KEY } from './extraction/jobDraftExtractorBridge';
import { emptyFormValues } from './popupForm';

const browserMock = vi.hoisted(() => ({
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(),
  },
  identity: {
    getRedirectURL: vi.fn(),
    launchWebAuthFlow: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

vi.mock('wxt/browser', () => ({
  browser: browserMock,
}));

describe('background save flow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal('defineBackground', (setup: () => void) => {
      setup();
    });
    vi.stubGlobal('fetch', vi.fn());
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.storage.local.set.mockResolvedValue(undefined);
    browserMock.storage.local.remove.mockResolvedValue(undefined);
  });

  it('surfaces the Authentik sign-in prompt when saving before sign-in', async () => {
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({
      type: 'SAVE_JOB',
      draft: {
        source_platform: 'indeed',
        external_job_id: 'job-123',
        company_name: 'Acme',
        job_title: 'Software Engineer',
        job_link: 'https://example.com/jobs/job-123',
      },
    });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: {
        code: 'OAUTH_FAILED',
        message: 'Sign in with Authentik before saving jobs.',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an unauthenticated status before sign-in', async () => {
    const { handleMessage } = await import('../../entrypoints/background');

    await expect(handleMessage({ type: 'GET_AUTH_STATUS' })).resolves.toEqual({
      type: 'GET_AUTH_STATUS_RESULT',
      ok: true,
      authenticated: false,
    });
  });

  it('reports an authenticated status for a current access token', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.settings': {
        oauthAccessToken: 'current-token',
        oauthExpiresAt: Date.now() + 300_000,
      },
    });
    const { handleMessage } = await import('../../entrypoints/background');

    await expect(handleMessage({ type: 'GET_AUTH_STATUS' })).resolves.toEqual({
      type: 'GET_AUTH_STATUS_RESULT',
      ok: true,
      authenticated: true,
    });
  });

  it('signs out by clearing stored OAuth credentials', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.settings': {
        oauthAccessToken: 'current-token',
        oauthRefreshToken: 'refresh-token',
        oauthExpiresAt: Date.now() + 300_000,
      },
    });
    const { handleMessage } = await import('../../entrypoints/background');

    await expect(handleMessage({ type: 'OAUTH_SIGN_OUT' })).resolves.toEqual({
      type: 'OAUTH_SIGN_OUT_RESULT',
      ok: true,
    });
    expect(browserMock.storage.local.set).toHaveBeenCalled();
    const stored: unknown = browserMock.storage.local.set.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      'jobTracker.settings': {
        oauthAccessToken: '',
        oauthRefreshToken: '',
        oauthExpiresAt: 0,
      },
    });
  });

  it('returns only non-sensitive settings to extension pages', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.settings': {
        oauthAccessToken: 'current-token',
        oauthRefreshToken: 'refresh-token',
        oauthExpiresAt: Date.now() + 300_000,
      },
    });
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'GET_SETTINGS' });
    expect(response).toEqual({
      type: 'GET_SETTINGS_RESULT',
      ok: true,
      settings: { apiBaseUrl: 'http://jobtracker.local', autoDetect: true },
    });
    expect(response).not.toHaveProperty('settings.oauthAccessToken');
    expect(response).not.toHaveProperty('settings.oauthRefreshToken');
  });

  it('detects the platform from the active tab URL and passes it to extraction', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.indeed.com/viewjob?jk=abc123' },
    ]);
    browserMock.scripting.executeScript.mockResolvedValue([
      {
        result: {
          draft: {
            source_platform: 'indeed',
            external_job_id: 'abc123',
            company_name: 'Acme',
            job_title: 'Software Engineer',
            job_link: 'https://www.indeed.com/viewjob?jk=abc123',
          },
          candidates: {},
        },
      },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'EXTRACT_ACTIVE_TAB_RESULT',
      ok: true,
    });
    expect(browserMock.scripting.executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 1 },
      files: ['/content-scripts/content.js'],
    });
    expect(browserMock.scripting.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        args: [
          JOB_DRAFT_EXTRACTOR_BRIDGE_KEY,
          {
            platform: 'indeed',
            confidence: 'high',
            externalJobId: 'abc123',
          },
        ],
      }),
    );
  });

  it('returns TAB_NOT_FOUND when no active tab is available', async () => {
    browserMock.tabs.query.mockResolvedValue([]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: { code: 'TAB_NOT_FOUND' },
    });
    expect(browserMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not inject the scraper on unsupported domains', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://mail.example.com/inbox' },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: { code: 'DOMAIN_NOT_SUPPORTED' },
    });
    expect(browserMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not inject the scraper on non-job pages of supported domains', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.linkedin.com/feed/' },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: { code: 'DOMAIN_NOT_SUPPORTED' },
    });
    expect(browserMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not inject the scraper on a bare Indeed results page', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.indeed.com/jobs?q=engineer' },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: { code: 'DOMAIN_NOT_SUPPORTED' },
    });
    expect(browserMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('strips only the invalid field from a partially malformed draft instead of discarding it entirely', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.glassdoor.com/job-listing/foo.htm' },
    ]);
    browserMock.scripting.executeScript.mockResolvedValue([
      {
        result: {
          draft: {
            source_platform: 'glassdoor',
            external_job_id: 'foo',
            company_name: 'Acme',
            job_title: 'Software Engineer',
            job_link: 'not a valid url',
          },
          candidates: {},
        },
      },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'EXTRACT_ACTIVE_TAB_RESULT',
      ok: true,
      draft: {
        source_platform: 'glassdoor',
        external_job_id: 'foo',
        company_name: 'Acme',
        job_title: 'Software Engineer',
      },
    });
    expect(response).not.toHaveProperty('draft.job_link');
  });

  it('drops an invalid candidate value from the picker instead of re-offering something already stripped from the draft', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.glassdoor.com/job-listing/foo.htm' },
    ]);
    browserMock.scripting.executeScript.mockResolvedValue([
      {
        result: {
          draft: {
            source_platform: 'glassdoor',
            external_job_id: 'foo',
            company_name: 'Acme',
            job_title: 'Software Engineer',
            job_link: 'not a valid url',
          },
          candidates: {
            job_link: [
              {
                value: 'not a valid url',
                source: 'meta',
                confidence: 'medium',
              },
              {
                value: 'https://example.com/jobs/foo',
                source: 'url',
                confidence: 'medium',
              },
            ],
          },
        },
      },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'EXTRACT_ACTIVE_TAB_RESULT',
      ok: true,
      candidates: {
        job_link: [{ value: 'https://example.com/jobs/foo', source: 'url' }],
      },
    });
  });

  it('reports EXTRACT_FAILED instead of an empty draft when the injected script returns an array', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://www.glassdoor.com/job-listing/foo.htm' },
    ]);
    browserMock.scripting.executeScript.mockResolvedValue([
      { result: { draft: ['not', 'a', 'draft', 'object'], candidates: {} } },
    ]);
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'EXTRACT_ACTIVE_TAB' });

    expect(response).toMatchObject({
      type: 'ERROR',
      ok: false,
      error: { code: 'EXTRACT_FAILED' },
    });
  });

  it('checks the authenticated API health endpoint', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.settings': {
        apiBaseUrl: 'http://jobtracker.local',
        authentikBaseUrl: 'https://auth.yjimmy.dev',
        oauthClientId: 'job-tracker-extension',
        oauthScope: 'openid profile email',
        oauthAccessToken: 'oauth-token',
        oauthRefreshToken: '',
        oauthExpiresAt: Date.now() + 300_000,
        apiKey: '',
        autoDetect: false,
      },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { handleMessage } = await import('../../entrypoints/background');

    const response = await handleMessage({ type: 'TEST_CONNECTION' });

    expect(response).toEqual({ type: 'TEST_CONNECTION_RESULT', ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'http://jobtracker.local/api/health/auth',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('serializes popup draft writes in the background worker', async () => {
    let finishFirstWrite: (() => void) | undefined;
    browserMock.storage.local.set
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstWrite = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const { handleMessage } = await import('../../entrypoints/background');
    const context = { tabId: 42, url: 'https://example.com/jobs/42' };
    const firstValues = { ...emptyFormValues(), job_title: 'First' };
    const secondValues = { ...emptyFormValues(), job_title: 'Second' };

    const first = handleMessage({
      type: 'SAVE_POPUP_DRAFT',
      context,
      values: firstValues,
    });
    const second = handleMessage({
      type: 'SAVE_POPUP_DRAFT',
      context,
      values: secondValues,
    });

    await vi.waitFor(() => {
      expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
    });
    finishFirstWrite?.();
    await expect(first).resolves.toEqual({
      type: 'SAVE_POPUP_DRAFT_RESULT',
      ok: true,
    });
    await expect(second).resolves.toEqual({
      type: 'SAVE_POPUP_DRAFT_RESULT',
      ok: true,
    });
    const secondPayload: unknown =
      browserMock.storage.local.set.mock.calls[1]?.[0];
    expect(secondPayload).toMatchObject({
      'jobTracker.popupDraft': { values: secondValues },
    });
  });

  it('stores a save-time edit after the successful-save clear', async () => {
    const operations: string[] = [];
    const context = { tabId: 42, url: 'https://example.com/jobs/42' };
    const storedValues = emptyFormValues();
    const editedValues = { ...storedValues, job_title: 'Edited during save' };
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': {
        ...context,
        values: storedValues,
        updatedAt: 1,
      },
    });
    browserMock.storage.local.remove.mockImplementation(() => {
      operations.push('clear');
      return Promise.resolve();
    });
    browserMock.storage.local.set.mockImplementation(() => {
      operations.push('save edit');
      return Promise.resolve();
    });
    const { handleMessage } = await import('../../entrypoints/background');

    const clear = handleMessage({ type: 'CLEAR_POPUP_DRAFT', context });
    const saveEdit = handleMessage({
      type: 'SAVE_POPUP_DRAFT',
      context,
      values: editedValues,
    });

    await expect(clear).resolves.toEqual({
      type: 'CLEAR_POPUP_DRAFT_RESULT',
      ok: true,
    });
    await expect(saveEdit).resolves.toEqual({
      type: 'SAVE_POPUP_DRAFT_RESULT',
      ok: true,
    });
    expect(operations).toEqual(['clear', 'save edit']);
  });

  it('invalidates the matching tab draft on navigation and tab removal', async () => {
    const context = { tabId: 42, url: 'https://example.com/jobs/42' };
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': {
        ...context,
        values: emptyFormValues(),
        updatedAt: 1,
      },
    });
    await import('../../entrypoints/background');
    const rawOnUpdated: unknown =
      browserMock.tabs.onUpdated.addListener.mock.calls.at(-1)?.[0];
    const rawOnRemoved: unknown =
      browserMock.tabs.onRemoved.addListener.mock.calls.at(-1)?.[0];
    if (
      typeof rawOnUpdated !== 'function' ||
      typeof rawOnRemoved !== 'function'
    ) {
      throw new Error('Expected background tab lifecycle listeners.');
    }
    const onUpdated = rawOnUpdated as (
      tabId: number,
      changeInfo: { status?: string; url?: string },
    ) => void;
    const onRemoved = rawOnRemoved as (tabId: number) => void;

    onUpdated?.(context.tabId, { status: 'complete' });
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();

    onUpdated(context.tabId, { url: 'https://example.com/jobs/43' });
    await vi.waitFor(() => {
      expect(browserMock.storage.local.remove).toHaveBeenCalledTimes(1);
    });

    onUpdated(context.tabId, { status: 'loading' });
    await vi.waitFor(() => {
      expect(browserMock.storage.local.remove).toHaveBeenCalledTimes(2);
    });

    onRemoved(context.tabId);
    await vi.waitFor(() => {
      expect(browserMock.storage.local.remove).toHaveBeenCalledTimes(3);
    });
  });
});
