import { afterEach, describe, expect, it, vi } from 'vitest';
import { postScrapePayload, testAuthConnection } from './apiClient';
import type { ScrapePayload } from './schemas';

const payload: ScrapePayload = {
  source_platform: 'indeed',
  external_job_id: 'abc123',
  company_name: 'Acme',
  job_title: 'Software Engineer',
  job_link: 'https://example.com/jobs/abc123',
};

describe('postScrapePayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /api/scrape with OAuth bearer auth', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ action: 'created', job_id: 'job-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postScrapePayload(
        {
          apiBaseUrl: 'http://jobtracker.local/',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          oauthAccessToken: 'oauth-token',
          oauthRefreshToken: '',
          oauthExpiresAt: Date.now() + 300_000,
          autoDetect: false,
        },
        payload,
      ),
    ).resolves.toEqual({ action: 'created', job_id: 'job-1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://jobtracker.local/api/scrape',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer oauth-token',
      },
      body: JSON.stringify(payload),
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps auth failures to a structured client error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );

    await expect(
      postScrapePayload(
        {
          apiBaseUrl: 'http://jobtracker.local',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          oauthAccessToken: 'bad-token',
          oauthRefreshToken: '',
          oauthExpiresAt: Date.now() + 300_000,
          autoDetect: false,
        },
        payload,
      ),
    ).rejects.toMatchObject({
      code: 'API_AUTH_FAILED',
    });
  });

  it('rejects oversized API responses before parsing them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{}', {
            status: 200,
            headers: { 'Content-Length': '1000001' },
          }),
        ),
      ),
    );

    await expect(
      postScrapePayload(
        {
          apiBaseUrl: 'http://jobtracker.local',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          oauthAccessToken: 'oauth-token',
          oauthRefreshToken: '',
          oauthExpiresAt: Date.now() + 300_000,
          autoDetect: false,
        },
        payload,
      ),
    ).rejects.toMatchObject({
      code: 'API_UNEXPECTED_RESPONSE',
      message: 'The Job Tracker API returned an oversized response.',
    });
  });
});

describe('testAuthConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks /api/health/auth with OAuth bearer auth', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      testAuthConnection({
        apiBaseUrl: 'http://jobtracker.local/',
        authentikBaseUrl: 'https://auth.yjimmy.dev',
        oauthClientId: 'job-tracker-extension',
        oauthScope: 'openid profile email',
        oauthAccessToken: 'oauth-token',
        oauthRefreshToken: '',
        oauthExpiresAt: Date.now() + 300_000,
        autoDetect: false,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://jobtracker.local/api/health/auth',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer oauth-token',
      },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a never-resolving scrape request with a retryable timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    const request = postScrapePayload(
      {
        apiBaseUrl: 'http://jobtracker.local',
        authentikBaseUrl: 'https://auth.yjimmy.dev',
        oauthClientId: 'job-tracker-extension',
        oauthScope: 'openid profile email',
        oauthAccessToken: 'oauth-token',
        oauthRefreshToken: '',
        oauthExpiresAt: Date.now() + 300_000,
        autoDetect: false,
      },
      payload,
    );
    const rejection = expect(request).rejects.toMatchObject({
      code: 'API_TIMEOUT',
      message: 'The Job Tracker API request timed out. Please try again.',
      details: 'This request is safe to retry.',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    vi.useRealTimers();
  });

  it('aborts a never-resolving health check with a retryable timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    const request = testAuthConnection({
      apiBaseUrl: 'http://jobtracker.local',
      authentikBaseUrl: 'https://auth.yjimmy.dev',
      oauthClientId: 'job-tracker-extension',
      oauthScope: 'openid profile email',
      oauthAccessToken: 'oauth-token',
      oauthRefreshToken: '',
      oauthExpiresAt: Date.now() + 300_000,
      autoDetect: false,
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'API_TIMEOUT',
      details: 'This request is safe to retry.',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    vi.useRealTimers();
  });
});
