import { browser } from 'wxt/browser';
import '../styles.css';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_AUTHENTIK_BASE_URL,
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_SCOPE,
} from '../../src/lib/settings';
import { extensionResponseSchema } from '../../src/lib/messages';
import { toOriginPermissionPattern } from '../../src/lib/origins';

const form = document.querySelector<HTMLFormElement>('#settings-form');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const signInButton =
  document.querySelector<HTMLButtonElement>('#oauth-sign-in');

void loadSettings();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void persistSettings();
});

signInButton?.addEventListener('click', () => {
  void signInWithAuthentik();
});

async function loadSettings(): Promise<void> {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'GET_SETTINGS',
  });
  const response = extensionResponseSchema.parse(rawResponse);
  if (!response.ok || response.type !== 'GET_SETTINGS_RESULT') {
    setStatus(
      !response.ok ? response.error.message : 'Could not load settings.',
    );
    return;
  }

  const settings = response.settings;
  setInputValue('#api-base-url', settings.apiBaseUrl || DEFAULT_API_BASE_URL);
  setInputValue(
    '#authentik-base-url',
    settings.authentikBaseUrl || DEFAULT_AUTHENTIK_BASE_URL,
  );
  setInputValue(
    '#oauth-client-id',
    settings.oauthClientId || DEFAULT_OAUTH_CLIENT_ID,
  );
  setInputValue('#oauth-scope', settings.oauthScope || DEFAULT_OAUTH_SCOPE);
  setChecked('#auto-detect', settings.autoDetect);
  if (settings.oauthAccessToken) setStatus('Signed in with Authentik.');
}

async function persistSettings(): Promise<void> {
  const apiBaseUrl = getInputValue('#api-base-url') || DEFAULT_API_BASE_URL;
  const permissionGranted = await ensureApiHostPermission(apiBaseUrl);
  if (!permissionGranted) {
    setStatus('Allow API access before saving these settings.');
    return;
  }

  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      apiBaseUrl,
      authentikBaseUrl:
        getInputValue('#authentik-base-url') || DEFAULT_AUTHENTIK_BASE_URL,
      oauthClientId:
        getInputValue('#oauth-client-id') || DEFAULT_OAUTH_CLIENT_ID,
      oauthScope: getInputValue('#oauth-scope') || DEFAULT_OAUTH_SCOPE,
      autoDetect: getChecked('#auto-detect'),
    },
  });

  const response = extensionResponseSchema.parse(rawResponse);
  if (!response.ok || response.type !== 'SAVE_SETTINGS_RESULT') {
    setStatus(
      !response.ok ? response.error.message : 'Could not save settings.',
    );
    return;
  }

  setStatus(`Saved settings for ${response.settings.apiBaseUrl}.`);
}

async function signInWithAuthentik(): Promise<void> {
  await persistSettings();
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'OAUTH_SIGN_IN',
  });
  const response = extensionResponseSchema.parse(rawResponse);
  if (!response.ok || response.type !== 'SAVE_SETTINGS_RESULT') {
    setStatus(
      !response.ok ? response.error.message : 'Could not complete sign-in.',
    );
    return;
  }

  setStatus('Signed in with Authentik.');
}

async function ensureApiHostPermission(apiBaseUrl: string): Promise<boolean> {
  const origins = [toOriginPermissionPattern(apiBaseUrl)];
  const hasPermission = await browser.permissions.contains({ origins });
  if (hasPermission) return true;

  return browser.permissions.request({ origins });
}

function getInputValue(selector: string): string {
  return document.querySelector<HTMLInputElement>(selector)?.value.trim() ?? '';
}

function setInputValue(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (input) input.value = value;
}

function getChecked(selector: string): boolean {
  return document.querySelector<HTMLInputElement>(selector)?.checked ?? false;
}

function setChecked(selector: string, checked: boolean): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (input) input.checked = checked;
}

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}
