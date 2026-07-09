import { browser } from 'wxt/browser';
import {
  type ExtensionSettings,
  saveSettings,
} from './settings';

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

const TOKEN_REFRESH_SKEW_MS = 60_000;

export async function signInWithAuthentik(
  settings: ExtensionSettings,
): Promise<ExtensionSettings> {
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const redirectUri = browser.identity.getRedirectURL();
  const authorizeUrl = new URL('/application/o/authorize/', settings.authentikBaseUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', settings.oauthClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', settings.oauthScope);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authorizeUrl.toString(),
    interactive: true,
  });
  if (!callbackUrl) throw new Error('Authentik sign-in was cancelled.');

  const code = new URL(callbackUrl).searchParams.get('code');
  if (!code) throw new Error('Authentik did not return an authorization code.');

  return exchangeToken(settings, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

export async function getValidAccessToken(
  settings: ExtensionSettings,
): Promise<string> {
  if (
    settings.oauthAccessToken &&
    Date.now() + TOKEN_REFRESH_SKEW_MS < settings.oauthExpiresAt
  ) {
    return settings.oauthAccessToken;
  }

  if (!settings.oauthRefreshToken) {
    throw new Error('Sign in with Authentik before saving jobs.');
  }

  const refreshed = await exchangeToken(settings, {
    grant_type: 'refresh_token',
    refresh_token: settings.oauthRefreshToken,
  });
  return refreshed.oauthAccessToken;
}

async function exchangeToken(
  settings: ExtensionSettings,
  params: Record<string, string>,
): Promise<ExtensionSettings> {
  const tokenUrl = new URL('/application/o/token/', settings.authentikBaseUrl);
  const body = new URLSearchParams({
    client_id: settings.oauthClientId,
    ...params,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Authentik token exchange failed with HTTP ${response.status}.`);
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  if (typeof tokenResponse.access_token !== 'string') {
    throw new Error('Authentik token response did not include an access token.');
  }

  const expiresIn =
    typeof tokenResponse.expires_in === 'number' ? tokenResponse.expires_in : 300;
  return saveSettings({
    ...settings,
    oauthAccessToken: tokenResponse.access_token,
    oauthRefreshToken:
      typeof tokenResponse.refresh_token === 'string'
        ? tokenResponse.refresh_token
        : settings.oauthRefreshToken,
    oauthExpiresAt: Date.now() + expiresIn * 1000,
  });
}

function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
