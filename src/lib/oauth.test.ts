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
  apiBaseUrl: 'http://localhost:3000',
  authentikBaseUrl: 'https://auth.example.com',
  oauthClientId: 'job-tracker-extension',
  oauthScope: 'openid profile email',
  oauthAccessToken: '',
  oauthRefreshToken: '',
  oauthExpiresAt: 0,
  apiKey: '',
  autoDetect: false,
};

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
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.storage.local.set.mockResolvedValue(undefined);
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
    const token = await getValidAccessToken({
      ...baseSettings,
      oauthAccessToken: 'expired-token',
      oauthRefreshToken: 'refresh-token',
      oauthExpiresAt: Date.now() - 1_000,
    });

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

    await expect(
      getValidAccessToken({
        ...baseSettings,
        oauthAccessToken: 'expired-token',
        oauthRefreshToken: 'stale-refresh-token',
        oauthExpiresAt: Date.now() - 1,
      }),
    ).rejects.toThrow('Authentik token exchange failed with HTTP 401.');
    expect(getSavedSettings()).toMatchObject({
      oauthAccessToken: '',
      oauthRefreshToken: '',
      oauthExpiresAt: 0,
    });
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
