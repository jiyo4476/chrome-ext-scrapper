import { afterEach, describe, expect, it, vi } from 'vitest';
import { postScrapePayload, testAuthConnection } from './apiClient';
import type { ScrapePayload } from './schemas';

describe('postScrapePayload', () => {
  const payload: ScrapePayload = {
    source_platform: 'indeed',
    external_job_id: 'abc123',
    company_name: 'Acme',
    job_title: 'Software Engineer',
    job_link: 'https://example.com/jobs/abc123',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /api/scrape with OAuth bearer auth', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ action: 'created', job_id: 'job-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postScrapePayload(
        {
          apiBaseUrl: 'http://localhost:3000/',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          oauthAccessToken: 'oauth-token',
          oauthRefreshToken: '',
          oauthExpiresAt: Date.now() + 300_000,
          apiKey: '',
          autoDetect: false,
        },
        payload,
      ),
    ).resolves.toEqual({ action: 'created', job_id: 'job-1' });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/scrape', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer oauth-token',
      },
      body: JSON.stringify(payload),
    });
  });

  it('maps auth failures to a structured client error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );

    await expect(
      postScrapePayload(
        {
          apiBaseUrl: 'http://localhost:3000',
          authentikBaseUrl: 'https://auth.yjimmy.dev',
          oauthClientId: 'job-tracker-extension',
          oauthScope: 'openid profile email',
          oauthAccessToken: 'bad-token',
          oauthRefreshToken: '',
          oauthExpiresAt: Date.now() + 300_000,
          apiKey: '',
          autoDetect: false,
        },
        payload,
      ),
    ).rejects.toMatchObject({
      code: 'API_AUTH_FAILED',
    });
  });
});

describe('testAuthConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks /api/health/auth with OAuth bearer auth', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      testAuthConnection({
        apiBaseUrl: 'http://localhost:3000/',
        authentikBaseUrl: 'https://auth.yjimmy.dev',
        oauthClientId: 'job-tracker-extension',
        oauthScope: 'openid profile email',
        oauthAccessToken: 'oauth-token',
        oauthRefreshToken: '',
        oauthExpiresAt: Date.now() + 300_000,
        apiKey: '',
        autoDetect: false,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/health/auth',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer oauth-token',
        },
      },
    );
  });
});
