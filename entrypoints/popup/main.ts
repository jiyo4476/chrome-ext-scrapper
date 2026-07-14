import { browser } from 'wxt/browser';
import '../styles.css';
import {
  type ExtensionResponse,
  type ExtractionCandidates,
  type SaveJobResult,
  extensionResponseSchema,
} from '../../src/lib/messages';
import {
  buildExportFilename,
  buildJobPostingJsonLd,
} from '../../src/lib/jsonld';
import {
  applyCandidateSelection,
  CANDIDATE_SOURCE_LABELS,
  draftToFormValues,
  type DraftFormField,
  emptyFormValues,
  type FieldError,
  firstInvalidField,
  formatCandidateValue,
  formValuesToDraft,
  FORM_FIELD_ORDER,
  type PopupFormValues,
  validateFormValues,
} from '../../src/lib/popupForm';
import type { JobDraft } from '../../src/lib/schemas';
import type { PopupDraftContext } from '../../src/lib/popupDraft';

const FIELD_IDS: Record<DraftFormField, string> = {
  job_title: 'job-title',
  company_name: 'company-name',
  job_link: 'job-link',
  source_platform: 'source-platform',
  job_location: 'job-location',
  is_remote: 'is-remote',
  job_description: 'job-description',
  external_job_id: 'external-job-id',
  date_posted: 'date-posted',
  job_type: 'job-type',
  experience_level: 'experience-level',
  security_clearance_req: 'security-clearance-req',
  salary_type: 'salary-type',
  salary_min: 'salary-min',
  salary_max: 'salary-max',
  hourly_rate_min: 'hourly-rate-min',
  hourly_rate_max: 'hourly-rate-max',
  salary_text: 'salary-text',
  skills: 'skills',
  software: 'software',
  keywords: 'keywords',
  certifications: 'certifications',
};

const ERROR_FIELDS: DraftFormField[] = [
  'job_link',
  'date_posted',
  'salary_min',
  'salary_max',
  'hourly_rate_min',
  'hourly_rate_max',
];

const statusEl = document.querySelector<HTMLDivElement>('#status');
const authGateEl = document.querySelector<HTMLElement>('#auth-gate');
const authStatusEl = document.querySelector<HTMLDivElement>('#auth-status');
const appContentEl = document.querySelector<HTMLDivElement>('#app-content');
const signInButton =
  document.querySelector<HTMLButtonElement>('#sign-in-button');
const form = document.querySelector<HTMLFormElement>('#job-form');
const extractButton =
  document.querySelector<HTMLButtonElement>('#extract-button');
const exportButton =
  document.querySelector<HTMLButtonElement>('#export-button');
const saveButton = document.querySelector<HTMLButtonElement>('#save-button');

let saveInFlight = false;
let formRevision = 0;
let popupDraftContext: PopupDraftContext | undefined;

form?.addEventListener('input', () => {
  formRevision += 1;
  void persistCurrentDraft();
});

extractButton?.addEventListener('click', () => {
  void extractActiveTab();
});

exportButton?.addEventListener('click', () => {
  exportJsonLd();
});

saveButton?.addEventListener('click', () => {
  void saveJob();
});

signInButton?.addEventListener('click', () => {
  void signIn();
});

void initializePopup();

async function initializePopup(): Promise<void> {
  setAuthStatus('Checking sign-in status…');
  setSignInDisabled(true);
  popupDraftContext = await getActiveTabContext();

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
      showApp();
      await restoreDraftOrExtract();
      return;
    }
    showAuthGate();
  } catch {
    showAuthGate('Could not verify your sign-in. Try again.');
  }
}

async function autoExtractIfEnabled(): Promise<void> {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'GET_SETTINGS',
  });
  const response = extensionResponseSchema.parse(rawResponse);
  if (
    response.ok &&
    response.type === 'GET_SETTINGS_RESULT' &&
    response.settings.autoDetect
  ) {
    await extractActiveTab();
    return;
  }
  setStatus(
    'Open a supported job page, then select Scan active tab.',
    'status',
  );
}

async function signIn(): Promise<void> {
  setAuthStatus('Opening Authentik sign-in…');
  setSignInDisabled(true);

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'OAUTH_SIGN_IN',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok) {
      showAuthGate(response.error.message);
      return;
    }
    if (response.type !== 'OAUTH_SIGN_IN_RESULT') {
      showAuthGate('Could not confirm Authentik sign-in. Try again.');
      return;
    }
    showApp();
    await restoreDraftOrExtract();
  } catch {
    showAuthGate('Could not complete Authentik sign-in. Try again.');
  }
}

async function restoreDraftOrExtract(): Promise<void> {
  if (popupDraftContext) {
    try {
      const storedValues = await requestPopupDraft(popupDraftContext);
      if (storedValues) {
        applyFormValues(storedValues);
        setStatus('Restored your unsaved changes.', 'status');
        return;
      }
    } catch {
      // Storage failure should not prevent the existing extraction workflow.
    }
  }

  await autoExtractIfEnabled();
}

async function getActiveTabContext(): Promise<PopupDraftContext | undefined> {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined || !tab.url) return undefined;
    return { tabId: tab.id, url: tab.url };
  } catch {
    return undefined;
  }
}

function showApp(): void {
  if (authGateEl) authGateEl.hidden = true;
  if (appContentEl) appContentEl.hidden = false;
}

function showAuthGate(message = 'Sign in to continue.'): void {
  if (appContentEl) appContentEl.hidden = true;
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

async function extractActiveTab(): Promise<void> {
  clearFieldErrors();
  renderCandidates(undefined);
  setStatus('Scanning the active tab…', 'status');
  setBusy(true);

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'EXTRACT_ACTIVE_TAB',
    });
    const response = extensionResponseSchema.parse(rawResponse);
    renderResponse(response);
  } catch {
    setStatus(
      'Could not extract this page. Try again or enter the details manually.',
      'alert',
    );
  } finally {
    setBusy(false);
  }
}

async function saveJob(): Promise<void> {
  if (saveInFlight) return;

  clearFieldErrors();
  const values = readFormValues();
  const errors = validateFormValues(values);
  if (errors.length > 0) {
    renderFieldErrors(errors);
    setStatus('Fix the highlighted fields before saving.', 'alert');
    const invalidField = firstInvalidField(errors);
    if (invalidField) focusField(invalidField);
    return;
  }

  saveInFlight = true;
  const submittedRevision = formRevision;
  setStatus('Saving job…', 'status');
  setSaveDisabled(true);

  try {
    const draft = formValuesToDraft(values);
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'SAVE_JOB',
      draft,
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (
      response.ok &&
      response.type === 'SAVE_JOB_RESULT' &&
      popupDraftContext
    ) {
      if (formRevision === submittedRevision) {
        await clearCurrentDraft();
        if (formRevision !== submittedRevision) {
          await persistCurrentDraft();
        }
      } else {
        await persistCurrentDraft();
      }
    }
    renderResponse(response);
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'Review the fields before saving this job.',
      'alert',
    );
  } finally {
    saveInFlight = false;
    setSaveDisabled(false);
  }
}

function enterManualEntry(): void {
  clearFieldErrors();
  renderCandidates(undefined);
  applyFormValues(emptyFormValues());
  formRevision += 1;
  void persistCurrentDraft();
  setStatus('Manual entry. Fill in the fields and save.', 'status');
  focusField('job_title');
}

function exportJsonLd(): void {
  clearFieldErrors();
  const values = readFormValues();
  const errors = validateFormValues(values);
  if (errors.length > 0) {
    renderFieldErrors(errors);
    setStatus('Fix the highlighted fields before exporting.', 'alert');
    const invalidField = firstInvalidField(errors);
    if (invalidField) focusField(invalidField);
    return;
  }

  let draft: JobDraft;
  try {
    draft = formValuesToDraft(values);
  } catch {
    setStatus('Fix the highlighted fields before exporting.', 'alert');
    return;
  }

  const jsonLd = buildJobPostingJsonLd(draft);
  const filename = buildExportFilename(draft);
  const blob = new Blob([JSON.stringify(jsonLd, null, 2)], {
    type: 'application/ld+json',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setStatus(`Exported ${filename}.`, 'status');
}

function renderResponse(response: ExtensionResponse): void {
  if (!response.ok) {
    handleError(response.error.code, response.error.message);
    return;
  }

  if (response.type === 'EXTRACT_ACTIVE_TAB_RESULT') {
    applyFormValues(draftToFormValues(response.draft));
    formRevision += 1;
    void persistCurrentDraft();
    renderCandidates(response.candidates);
    setStatus('Review the extracted fields before saving.', 'status');
    return;
  }

  if (response.type === 'SAVE_JOB_RESULT') {
    setStatus(formatSaveResult(response.result), 'status');
  }
}

function handleError(code: string, message: string): void {
  if (code === 'EXTRACT_EMPTY') {
    enterManualEntry();
    setStatus(
      'No job data was found on this page. Enter the details manually.',
      'status',
    );
    return;
  }

  if (code === 'OAUTH_FAILED') {
    showAuthGate(message);
    return;
  }

  setStatus(message, 'alert');
}

function renderCandidates(candidates: ExtractionCandidates | undefined): void {
  FORM_FIELD_ORDER.forEach((field) => {
    const container = document.getElementById(`candidates-${field}`);
    if (!container) return;

    container.innerHTML = '';
    if (field === 'job_description') {
      container.hidden = true;
      return;
    }

    const list = candidates?.[field];
    if (!list || list.length < 2) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    list.forEach((candidate, index) => {
      const optionId = `candidate-${field}-${String(index)}`;

      const wrapper = document.createElement('label');
      wrapper.className = 'candidate-option';
      wrapper.htmlFor = optionId;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `candidate-${field}`;
      radio.id = optionId;
      radio.addEventListener('change', () => {
        selectCandidate(field, candidate.value);
      });

      const text = document.createElement('span');
      text.textContent = `${CANDIDATE_SOURCE_LABELS[candidate.source]}: ${formatCandidateValue(candidate.value)}`;

      wrapper.append(radio, text);
      container.appendChild(wrapper);
    });
  });
}

function selectCandidate(field: DraftFormField, value: unknown): void {
  const next = applyCandidateSelection(readFormValues(), field, value);
  applyFormValues(next);
  formRevision += 1;
  void persistCurrentDraft();
}

async function requestPopupDraft(
  context: PopupDraftContext,
): Promise<PopupFormValues | undefined> {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    type: 'GET_POPUP_DRAFT',
    context,
  });
  const response = extensionResponseSchema.parse(rawResponse);
  if (!response.ok || response.type !== 'GET_POPUP_DRAFT_RESULT') {
    throw new Error('Could not read the popup draft.');
  }
  return response.values;
}

async function persistCurrentDraft(): Promise<void> {
  if (!popupDraftContext) return;

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'SAVE_POPUP_DRAFT',
      context: popupDraftContext,
      values: readFormValues(),
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok || response.type !== 'SAVE_POPUP_DRAFT_RESULT') {
      throw new Error('Could not store the popup draft.');
    }
  } catch {
    // Draft persistence is best-effort and must not block popup editing.
  }
}

async function clearCurrentDraft(): Promise<void> {
  if (!popupDraftContext) return;

  try {
    const rawResponse: unknown = await browser.runtime.sendMessage({
      type: 'CLEAR_POPUP_DRAFT',
      context: popupDraftContext,
    });
    const response = extensionResponseSchema.parse(rawResponse);
    if (!response.ok || response.type !== 'CLEAR_POPUP_DRAFT_RESULT') {
      throw new Error('Could not clear the popup draft.');
    }
  } catch {
    // A storage failure should not turn a successful job save into an error.
  }
}

function formatSaveResult(result: SaveJobResult): string {
  const action = result.action ?? mapLegacyStatus(result.status);
  const jobId = result.job_id ?? result.id;
  const suffix = jobId ? ` Job ID: ${String(jobId)}.` : '';

  if (action === 'created') return `Created job in Job Tracker.${suffix}`;
  if (action === 'updated')
    return `Updated existing job in Job Tracker.${suffix}`;
  if (action === 'duplicate_skipped') {
    return `Duplicate found; existing job was left unchanged.${suffix}`;
  }

  return result.message || `Saved job to Job Tracker.${suffix}`;
}

function mapLegacyStatus(
  status: SaveJobResult['status'],
): SaveJobResult['action'] | undefined {
  if (status === 'duplicate') return 'duplicate_skipped';
  return status;
}

function readFormValues(): PopupFormValues {
  return {
    job_title: getValue('job_title'),
    company_name: getValue('company_name'),
    job_link: getValue('job_link'),
    source_platform: getValue('source_platform'),
    job_location: getValue('job_location'),
    is_remote: getChecked('is_remote'),
    job_description: getValue('job_description'),
    external_job_id: getValue('external_job_id'),
    date_posted: getValue('date_posted'),
    job_type: getValue('job_type'),
    experience_level: getValue('experience_level'),
    security_clearance_req: getChecked('security_clearance_req'),
    salary_type: getValue('salary_type'),
    salary_min: getValue('salary_min'),
    salary_max: getValue('salary_max'),
    hourly_rate_min: getValue('hourly_rate_min'),
    hourly_rate_max: getValue('hourly_rate_max'),
    salary_text: getValue('salary_text'),
    skills: getValue('skills'),
    software: getValue('software'),
    keywords: getValue('keywords'),
    certifications: getValue('certifications'),
  };
}

function applyFormValues(values: PopupFormValues): void {
  setValue('job_title', values.job_title);
  setValue('company_name', values.company_name);
  setValue('job_link', values.job_link);
  setValue('source_platform', values.source_platform);
  setValue('job_location', values.job_location);
  setChecked('is_remote', values.is_remote);
  setValue('job_description', values.job_description);
  setValue('external_job_id', values.external_job_id);
  setValue('date_posted', values.date_posted);
  setValue('job_type', values.job_type);
  setValue('experience_level', values.experience_level);
  setChecked('security_clearance_req', values.security_clearance_req);
  setValue('salary_type', values.salary_type);
  setValue('salary_min', values.salary_min);
  setValue('salary_max', values.salary_max);
  setValue('hourly_rate_min', values.hourly_rate_min);
  setValue('hourly_rate_max', values.hourly_rate_max);
  setValue('salary_text', values.salary_text);
  setValue('skills', values.skills);
  setValue('software', values.software);
  setValue('keywords', values.keywords);
  setValue('certifications', values.certifications);
}

function clearFieldErrors(): void {
  ERROR_FIELDS.forEach((field) => {
    const el = document.getElementById(`error-${field}`);
    if (el) {
      el.textContent = '';
      el.hidden = true;
    }
  });
}

function renderFieldErrors(errors: FieldError[]): void {
  errors.forEach((error) => {
    const el = document.getElementById(`error-${error.field}`);
    if (el) {
      el.textContent = error.message;
      el.hidden = false;
    }
  });
}

function focusField(field: DraftFormField): void {
  const el = document.getElementById(FIELD_IDS[field]);
  el?.focus();
}

function getFieldElement(
  field: DraftFormField,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  return document.getElementById(FIELD_IDS[field]) as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
}

function getValue(field: DraftFormField): string {
  return getFieldElement(field)?.value ?? '';
}

function setValue(field: DraftFormField, value: string): void {
  const el = getFieldElement(field);
  if (el) el.value = value;
}

function getChecked(field: DraftFormField): boolean {
  const el = document.getElementById(
    FIELD_IDS[field],
  ) as HTMLInputElement | null;
  return el?.checked ?? false;
}

function setChecked(field: DraftFormField, checked: boolean): void {
  const el = document.getElementById(
    FIELD_IDS[field],
  ) as HTMLInputElement | null;
  if (el) el.checked = checked;
}

function setStatus(message: string, kind: 'status' | 'alert' = 'status'): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.setAttribute('role', kind);
}

function setBusy(disabled: boolean): void {
  form
    ?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea')
    .forEach((el) => {
      el.disabled = disabled;
    });
  setExtractDisabled(disabled);
  setExportDisabled(disabled);
  setSaveDisabled(disabled);
}

function setExtractDisabled(disabled: boolean): void {
  if (extractButton) extractButton.disabled = disabled;
}

function setExportDisabled(disabled: boolean): void {
  if (exportButton) exportButton.disabled = disabled;
}

function setSaveDisabled(disabled: boolean): void {
  if (saveButton) saveButton.disabled = disabled;
}
