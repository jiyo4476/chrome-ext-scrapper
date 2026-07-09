import { afterEach, describe, expect, it, vi } from 'vitest';
import { postScrapePayload } from './apiClient';
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

  it('posts to /api/scrape with bearer auth', async () => {
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
          apiKey: 'secret',
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
        Authorization: 'Bearer secret',
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
          apiKey: 'bad-token',
          autoDetect: false,
        },
        payload,
      ),
    ).rejects.toMatchObject({
      code: 'API_AUTH_FAILED',
    });
  });
});
