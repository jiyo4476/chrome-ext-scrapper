import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  identity: {
    getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/'),
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

import { getValidAccessToken, signInWithAuthentik } from './oauth';
import type { ExtensionSettings } from './settings';

const baseSettings: ExtensionSettings = {
  apiBaseUrl: 'http://jobtracker.local',
  authentikBaseUrl: 'https://auth.example.com',
  oauthClientId: 'job-tracker-extension',
  oauthScope: 'openid profile email',
  oauthAccessToken: '',
  oauthRefreshToken: '',
  oauthExpiresAt: 0,
  autoDetect: false,
};
let storedSettings: ExtensionSettings;

describe('Authentik OAuth helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    browserMock.identity.getRedirectURL.mockReturnValue(
      'https://extension.chromiumapp.org/',
    );
    browserMock.identity.launchWebAuthFlow.mockImplementation(
      (options: unknown) => {
        const state = new URL(getAuthFlowUrl(options)).searchParams.get(
          'state',
        );
        return Promise.resolve(
          `https://extension.chromiumapp.org/?code=auth-code&state=${String(
            state,
          )}`,
        );
      },
    );
    storedSettings = { ...baseSettings };
    browserMock.storage.local.get.mockImplementation(() =>
      Promise.resolve({ 'jobTracker.settings': storedSettings }),
    );
    browserMock.storage.local.set.mockImplementation((value: unknown) => {
      const next = (value as Record<string, ExtensionSettings>)[
        'jobTracker.settings'
      ];
      if (!next) throw new Error('Expected settings storage payload.');
      storedSettings = next;
      return Promise.resolve();
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              expires_in: 600,
            }),
            { status: 200 },
          ),
        ),
      ),
    );
  });

  it('starts authorization-code PKCE sign-in and stores returned tokens', async () => {
    const settings = await signInWithAuthentik(baseSettings);

    const authUrl = new URL(getFirstLaunchUrl());
    expect(authUrl.origin).toBe('https://auth.example.com');
    expect(authUrl.pathname).toBe('/application/o/authorize/');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('client_id')).toBe('job-tracker-extension');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://extension.chromiumapp.org/',
    );
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('state')).toBeTruthy();

    const [tokenUrl, tokenRequest] = getFirstFetchCall();
    expect(tokenUrl.href).toBe('https://auth.example.com/application/o/token/');
    const body = tokenRequest.body;
    expect(body.get('client_id')).toBe('job-tracker-extension');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('redirect_uri')).toBe('https://extension.chromiumapp.org/');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.has('client_secret')).toBe(false);

    expect(settings.oauthAccessToken).toBe('access-token');
    expect(settings.oauthRefreshToken).toBe('refresh-token');
    expect(getSavedSettings()).toMatchObject({
      oauthAccessToken: 'access-token',
      oauthRefreshToken: 'refresh-token',
    });
  });

  it('reuses a non-expiring access token without refreshing', async () => {
    const token = await getValidAccessToken({
      ...baseSettings,
      oauthAccessToken: 'current-token',
      oauthRefreshToken: 'refresh-token',
      oauthExpiresAt: Date.now() + 120_000,
    });

    expect(token).toBe('current-token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes and persists expired access tokens', async () => {
    storedSettings = {
      ...baseSettings,
      oauthAccessToken: 'expired-token',
      oauthRefreshToken: 'refresh-token',
      oauthExpiresAt: Date.now() - 1_000,
    };
    const token = await getValidAccessToken(storedSettings);

    const [, tokenRequest] = getFirstFetchCall();
    const body = tokenRequest.body;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
    expect(token).toBe('access-token');
    expect(browserMock.storage.local.set).toHaveBeenCalled();
  });

  it('asks the user to sign in when no refresh token is available', async () => {
    await expect(getValidAccessToken(baseSettings)).rejects.toThrow(
      'Sign in with Authentik before saving jobs.',
    );
  });

  it('clears stale credentials when refresh fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    storedSettings = {
      ...baseSettings,
      oauthAccessToken: 'expired-token',
      oauthRefreshToken: 'stale-refresh-token',
      oauthExpiresAt: Date.now() - 1,
    };

    await expect(getValidAccessToken(storedSettings)).rejects.toThrow(
      'Authentik token exchange failed with HTTP 401.',
    );
    expect(getSavedSettings()).toMatchObject({
      oauthAccessToken: '',
      oauthRefreshToken: '',
      oauthExpiresAt: 0,
    });
  });

  it('shares one rotating-token refresh across concurrent callers', async () => {
    storedSettings = {
      ...baseSettings,
      oauthRefreshToken: 'refresh-token',
    };

    await expect(
      Promise.all([
        getValidAccessToken(storedSettings),
        getValidAccessToken(storedSettings),
      ]),
    ).resolves.toEqual(['access-token', 'access-token']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storedSettings.oauthRefreshToken).toBe('refresh-token');
  });

  it('preserves a settings save while refresh persists rotated credentials', async () => {
    const { saveSettings } = await import('./settings');
    storedSettings = {
      ...baseSettings,
      oauthRefreshToken: 'refresh-token',
      autoDetect: false,
    };
    let releaseFetch: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        }),
    );

    const refresh = getValidAccessToken(storedSettings);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    await saveSettings({ autoDetect: true });
    releaseFetch?.(
      new Response(
        JSON.stringify({
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 600,
        }),
        { status: 200 },
      ),
    );

    await expect(refresh).resolves.toBe('rotated-access');
    expect(storedSettings).toMatchObject({
      autoDetect: true,
      oauthAccessToken: 'rotated-access',
      oauthRefreshToken: 'rotated-refresh',
    });
  });

  it('does not restore credentials when sign-out wins an in-flight refresh', async () => {
    const { clearOAuthCredentials } = await import('./settings');
    storedSettings = {
      ...baseSettings,
      oauthRefreshToken: 'refresh-token',
    };
    let releaseFetch: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        }),
    );

    const refresh = getValidAccessToken(storedSettings);
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    await clearOAuthCredentials();
    releaseFetch?.(
      new Response(
        JSON.stringify({
          access_token: 'late-access',
          refresh_token: 'late-refresh',
          expires_in: 600,
        }),
        { status: 200 },
      ),
    );

    await expect(refresh).rejects.toThrow(
      'OAuth credentials changed while refresh was in progress.',
    );
    expect(storedSettings).toMatchObject({
      oauthAccessToken: '',
      oauthRefreshToken: '',
      oauthExpiresAt: 0,
    });
  });

  it('aborts a never-resolving token request without clearing credentials', async () => {
    vi.useFakeTimers();
    storedSettings = {
      ...baseSettings,
      oauthRefreshToken: 'refresh-token',
    };
    vi.mocked(fetch).mockImplementation(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const refresh = getValidAccessToken(storedSettings);
    const rejection = expect(refresh).rejects.toMatchObject({
      message: 'Authentik token request timed out. Please try again.',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(storedSettings.oauthRefreshToken).toBe('refresh-token');
    vi.useRealTimers();
  });

  it('rejects sign-in callbacks with a mismatched state', async () => {
    browserMock.identity.launchWebAuthFlow.mockResolvedValue(
      'https://extension.chromiumapp.org/?code=auth-code&state=wrong-state',
    );

    await expect(signInWithAuthentik(baseSettings)).rejects.toThrow(
      'Authentik sign-in returned an invalid state value.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

function getFirstLaunchUrl(): string {
  const options: unknown =
    browserMock.identity.launchWebAuthFlow.mock.calls[0]?.[0];
  return getAuthFlowUrl(options);
}

function getAuthFlowUrl(options: unknown): string {
  if (typeof options !== 'object' || options === null) {
    throw new Error('Expected launchWebAuthFlow options.');
  }

  const url = (options as { url?: unknown }).url;
  if (typeof url !== 'string') {
    throw new Error('Expected launchWebAuthFlow URL.');
  }

  return url;
}

function getFirstFetchCall(): [URL, RequestInit & { body: URLSearchParams }] {
  const call = vi.mocked(fetch).mock.calls[0];
  if (!call) throw new Error('Expected fetch to be called.');

  const input: unknown = call[0];
  if (!(input instanceof URL)) throw new Error('Expected fetch URL input.');

  const init: unknown = call[1];
  if (typeof init !== 'object' || init === null) {
    throw new Error('Expected fetch init.');
  }

  const body = (init as { body?: unknown }).body;
  if (!(body instanceof URLSearchParams)) {
    throw new Error('Expected URLSearchParams body.');
  }

  return [input, { ...(init as RequestInit), body }];
}

function getSavedSettings(): ExtensionSettings {
  const stored: unknown = browserMock.storage.local.set.mock.calls[0]?.[0];
  if (typeof stored !== 'object' || stored === null) {
    throw new Error('Expected saved settings payload.');
  }

  const settings = (stored as Record<string, unknown>)['jobTracker.settings'];
  return settings as ExtensionSettings;
}
