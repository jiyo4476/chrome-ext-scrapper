import { browser } from 'wxt/browser';
import '../styles.css';
import {
  type ExtensionResponse,
  extensionResponseSchema,
} from '../../src/lib/messages';
import { type JobDraft, jobDraftSchema } from '../../src/lib/schemas';

const statusEl = document.querySelector<HTMLDivElement>('#status');
const extractButton =
  document.querySelector<HTMLButtonElement>('#extract-button');
const saveButton = document.querySelector<HTMLButtonElement>('#save-button');

extractButton?.addEventListener('click', () => {
  void extractActiveTab();
});

saveButton?.addEventListener('click', () => {
  void saveJob();
});

void extractActiveTab();

async function extractActiveTab(): Promise<void> {
  setStatus('Scanning active tab...');
  setExtractDisabled(true);

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'EXTRACT_ACTIVE_TAB',
    });
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

  if (response.type === 'EXTRACT_ACTIVE_TAB_RESULT') {
    renderDraft(response.draft);
    setSaveDisabled(false);
    setStatus('Review the extracted fields before saving.');
    return;
  }

  if (response.type === 'SAVE_JOB_RESULT') {
    setStatus(response.result.message || 'Saved job to Job Tracker.');
  }
}

async function saveJob(): Promise<void> {
  setStatus('Saving job...');
  setSaveDisabled(true);

  try {
    const draft = readDraftFromForm();
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'SAVE_JOB',
      draft,
    });
    const response = extensionResponseSchema.parse(rawResponse);
    renderResponse(response);
  } catch {
    setStatus('Review title, company, link, platform, and required settings.');
  } finally {
    setSaveDisabled(false);
  }
}

function renderDraft(draft: JobDraft): void {
  setInputValue('#job-title', draft.job_title);
  setInputValue('#company-name', draft.company_name);
  setInputValue('#job-link', draft.job_link);
  setInputValue('#source-platform', draft.source_platform);
  setInputValue('#job-description', draft.job_description);
}

function readDraftFromForm(): JobDraft {
  return jobDraftSchema.parse({
    job_title: getInputValue('#job-title'),
    company_name: getInputValue('#company-name'),
    job_link: getInputValue('#job-link'),
    source_platform: getInputValue('#source-platform') || 'other',
    job_description: getInputValue('#job-description'),
  });
}

function getInputValue(selector: string): string {
  return (
    document
      .querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      ?.value.trim() ?? ''
  );
}

function setInputValue(selector: string, value = ''): void {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  if (input) input.value = value;
}

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function setExtractDisabled(disabled: boolean): void {
  if (extractButton) extractButton.disabled = disabled;
}

function setSaveDisabled(disabled: boolean): void {
  if (saveButton) saveButton.disabled = disabled;
}
