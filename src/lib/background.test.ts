import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_DRAFT_EXTRACTOR_BRIDGE_KEY } from './extraction/jobDraftExtractorBridge';

const browserMock = vi.hoisted(() => ({
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
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
    vi.stubGlobal('defineBackground', (setup: () => void) => {
      setup();
    });
    vi.stubGlobal('fetch', vi.fn());
    browserMock.storage.local.get.mockResolvedValue({});
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
      settings: { apiBaseUrl: 'http://localhost:3000', autoDetect: true },
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
        apiBaseUrl: 'http://localhost:3000',
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
      'http://localhost:3000/api/health/auth',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
