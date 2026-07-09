import { browser } from 'wxt/browser';
import '../styles.css';
import {
  type ExtensionResponse,
  extensionResponseSchema,
} from '../../src/lib/messages';

const statusEl = document.querySelector<HTMLDivElement>('#status');
const extractButton = document.querySelector<HTMLButtonElement>('#extract-button');

extractButton?.addEventListener('click', () => {
  void extractActiveTab();
});

void extractActiveTab();

async function extractActiveTab(): Promise<void> {
  setStatus('Scanning active tab...');
  setExtractDisabled(true);

  try {
    const rawResponse = await browser.runtime.sendMessage({ type: 'EXTRACT_ACTIVE_TAB' });
    const response = extensionResponseSchema.parse(rawResponse);
    renderResponse(response);
  } catch {
    setStatus('Could not extract this page.');
  } finally {
    setExtractDisabled(false);
  }
}

function renderResponse(response: ExtensionResponse): void {
  if (!response.ok) {
    setStatus(response.error.message);
    return;
  }

  setInputValue('#job-title', response.draft.job_title);
  setInputValue('#company-name', response.draft.company_name);
  setInputValue('#job-link', response.draft.job_link);
  setInputValue('#source-platform', response.draft.source_platform);
  setInputValue('#job-description', response.draft.job_description);
  setStatus('Review the extracted fields before saving.');
}

function setInputValue(selector: string, value = ''): void {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (input) input.value = value;
}

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function setExtractDisabled(disabled: boolean): void {
  if (extractButton) extractButton.disabled = disabled;
}
