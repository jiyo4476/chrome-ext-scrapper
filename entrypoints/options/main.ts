import '../styles.css';
import {
  DEFAULT_API_BASE_URL,
  getSettings,
  saveSettings,
} from '../../src/lib/settings';

const form = document.querySelector<HTMLFormElement>('#settings-form');
const statusEl = document.querySelector<HTMLDivElement>('#status');

void loadSettings();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void persistSettings();
});

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  setInputValue('#api-base-url', settings.apiBaseUrl || DEFAULT_API_BASE_URL);
  setInputValue('#api-key', settings.apiKey);
  setChecked('#auto-detect', settings.autoDetect);
}

async function persistSettings(): Promise<void> {
  const settings = await saveSettings({
    apiBaseUrl: getInputValue('#api-base-url') || DEFAULT_API_BASE_URL,
    apiKey: getInputValue('#api-key'),
    autoDetect: getChecked('#auto-detect'),
  });

  setStatus(`Saved settings for ${settings.apiBaseUrl}.`);
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
