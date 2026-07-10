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
});
