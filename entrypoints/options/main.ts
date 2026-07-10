import { browser } from 'wxt/browser';
import '../styles.css';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_AUTHENTIK_BASE_URL,
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_SCOPE,
  type ExtensionSettings,
} from '../../src/lib/settings';
import { extensionResponseSchema } from '../../src/lib/messages';
import { signInWithAuthentik as launchAuthentikSignIn } from '../../src/lib/oauth';
import { toOriginPermissionPattern } from '../../src/lib/origins';

const form = document.querySelector<HTMLFormElement>('#settings-form');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const signInButton =
  document.querySelector<HTMLButtonElement>('#oauth-sign-in');
const testConnectionButton =
  document.querySelector<HTMLButtonElement>('#test-connection');

void loadSettings();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void persistSettings();
});

signInButton?.addEventListener('click', () => {
  void signInWithAuthentik();
});

testConnectionButton?.addEventListener('click', () => {
  void testConnection();
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

async function persistSettings(
  savedMessage?: string,
): Promise<ExtensionSettings | null> {
  const apiBaseUrl = getInputValue('#api-base-url') || DEFAULT_API_BASE_URL;
  const authentikBaseUrl =
    getInputValue('#authentik-base-url') || DEFAULT_AUTHENTIK_BASE_URL;
  const permissionGranted = await ensureHostPermissions([
    apiBaseUrl,
    authentikBaseUrl,
  ]);
  if (!permissionGranted) {
    setStatus('Allow API and Authentik access before saving these settings.');
    return null;
  }

  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      apiBaseUrl,
      authentikBaseUrl,
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
    return null;
  }

  setStatus(
    savedMessage ?? `Saved settings for ${response.settings.apiBaseUrl}.`,
  );
  return response.settings;
}

async function signInWithAuthentik(): Promise<void> {
  setStatus('Preparing Authentik sign-in...');
  setSignInDisabled(true);

  try {
    const settings = await persistSettings();
    if (!settings) return;

    setStatus('Opening Authentik sign-in...');
    await launchAuthentikSignIn(settings);
    setStatus('Signed in with Authentik.');
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'Could not complete Authentik sign-in.',
    );
  } finally {
    setSignInDisabled(false);
  }
}

async function testConnection(): Promise<void> {
  setStatus('Testing Job Tracker connection...');
  setControlsDisabled(true);

  try {
    const settings = await persistSettings('Settings saved. Testing now...');
    if (!settings) return;

    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'TEST_CONNECTION',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok || response.type !== 'TEST_CONNECTION_RESULT') {
      setStatus(
        !response.ok
          ? response.error.message
          : 'Could not verify the connection.',
      );
      return;
    }

    setStatus('Connected to Job Tracker with Authentik.');
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'Could not verify the connection.',
    );
  } finally {
    setControlsDisabled(false);
  }
}

async function ensureHostPermissions(baseUrls: string[]): Promise<boolean> {
  const origins = Array.from(
    new Set(baseUrls.map((baseUrl) => toOriginPermissionPattern(baseUrl))),
  );
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

function setSignInDisabled(disabled: boolean): void {
  if (signInButton) signInButton.disabled = disabled;
}

function setControlsDisabled(disabled: boolean): void {
  setSignInDisabled(disabled);
  if (testConnectionButton) testConnectionButton.disabled = disabled;
}
