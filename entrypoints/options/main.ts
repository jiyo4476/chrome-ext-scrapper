import { browser } from 'wxt/browser';
import '../styles.css';
import { DEFAULT_API_BASE_URL } from '../../src/lib/settings';
import { extensionResponseSchema } from '../../src/lib/messages';

const form = document.querySelector<HTMLFormElement>('#settings-form');
const statusEl = document.querySelector<HTMLDivElement>('#status');

void loadSettings();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void persistSettings();
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
  setInputValue('#api-key', settings.apiKey);
  setChecked('#auto-detect', settings.autoDetect);
}

async function persistSettings(): Promise<void> {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      apiBaseUrl: getInputValue('#api-base-url') || DEFAULT_API_BASE_URL,
      apiKey: getInputValue('#api-key'),
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
