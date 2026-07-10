import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(browserMock.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [{ platform: 'indeed', confidence: 'high' }],
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
