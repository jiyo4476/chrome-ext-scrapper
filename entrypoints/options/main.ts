import { browser } from 'wxt/browser';
import '../styles.css';
import type { PublicSettings } from '../../src/lib/settings';
import { extensionResponseSchema } from '../../src/lib/messages';

const form = document.querySelector<HTMLFormElement>('#settings-form');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const authGateEl = document.querySelector<HTMLElement>('#auth-gate');
const authStatusEl = document.querySelector<HTMLDivElement>('#auth-status');
const settingsContentEl =
  document.querySelector<HTMLElement>('#settings-content');
const signInButton =
  document.querySelector<HTMLButtonElement>('#oauth-sign-in');
const signOutButton =
  document.querySelector<HTMLButtonElement>('#oauth-sign-out');
const testConnectionButton =
  document.querySelector<HTMLButtonElement>('#test-connection');

void initializeOptions();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void persistSettings();
});

signInButton?.addEventListener('click', () => {
  void signInWithAuthentik();
});

signOutButton?.addEventListener('click', () => {
  void signOut();
});

testConnectionButton?.addEventListener('click', () => {
  void testConnection();
});

async function initializeOptions(): Promise<void> {
  setAuthStatus('Checking sign-in status…');
  setSignInDisabled(true);

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'GET_AUTH_STATUS',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (
      response.ok &&
      response.type === 'GET_AUTH_STATUS_RESULT' &&
      response.authenticated
    ) {
      showSettings();
      await loadSettings();
      return;
    }
    showAuthGate();
  } catch {
    showAuthGate('Could not verify your sign-in. Try again.');
  }
}

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
  setChecked('#auto-detect', settings.autoDetect);
  setStatus(`Connected to ${settings.apiBaseUrl}.`);
}

async function persistSettings(
  savedMessage?: string,
): Promise<PublicSettings | null> {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
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
  setAuthStatus('Preparing Authentik sign-in…');
  setSignInDisabled(true);

  try {
    setAuthStatus('Opening Authentik sign-in…');
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'OAUTH_SIGN_IN',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok || response.type !== 'OAUTH_SIGN_IN_RESULT') {
      showAuthGate(
        !response.ok ? response.error.message : 'Could not confirm sign-in.',
      );
      return;
    }
    showSettings();
    await loadSettings();
  } catch (error) {
    showAuthGate(
      error instanceof Error
        ? error.message
        : 'Could not complete Authentik sign-in.',
    );
  } finally {
    setSignInDisabled(false);
  }
}

async function signOut(): Promise<void> {
  setControlsDisabled(true);
  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'OAUTH_SIGN_OUT',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok || response.type !== 'OAUTH_SIGN_OUT_RESULT') {
      setStatus(!response.ok ? response.error.message : 'Could not sign out.');
      return;
    }
    showAuthGate('Signed out. Sign in to continue.');
  } catch {
    setStatus('Could not sign out.');
  } finally {
    setControlsDisabled(false);
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

function showSettings(): void {
  if (authGateEl) authGateEl.hidden = true;
  if (settingsContentEl) settingsContentEl.hidden = false;
}

function showAuthGate(message = 'Sign in to continue.'): void {
  if (settingsContentEl) settingsContentEl.hidden = true;
  if (authGateEl) authGateEl.hidden = false;
  setAuthStatus(message);
  setSignInDisabled(false);
  signInButton?.focus();
}

function setAuthStatus(message: string): void {
  if (authStatusEl) authStatusEl.textContent = message;
}

function setSignInDisabled(disabled: boolean): void {
  if (signInButton) signInButton.disabled = disabled;
}

function setControlsDisabled(disabled: boolean): void {
  setSignInDisabled(disabled);
  if (testConnectionButton) testConnectionButton.disabled = disabled;
}
