import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFormValues } from './popupForm';

const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import {
  clearPopupDraft,
  clearPopupDraftForTab,
  getPopupDraft,
  savePopupDraft,
} from './popupDraft';

const context = { tabId: 42, url: 'https://jobs.example.com/role/123' };

describe('popup draft storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.storage.local.set.mockResolvedValue(undefined);
    browserMock.storage.local.remove.mockResolvedValue(undefined);
  });

  it('preserves partial and temporarily invalid form strings', async () => {
    const values = {
      ...emptyFormValues(),
      job_title: 'Platform Engineer',
      salary_min: '-',
    };

    await savePopupDraft(context, values);

    const stored = getStoredDraft();
    expect(stored).toMatchObject({ ...context, values });
    expect(stored.updatedAt).toEqual(expect.any(Number));
  });

  it('restores only a draft from the same tab and URL', async () => {
    const values = { ...emptyFormValues(), company_name: 'Acme' };
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': { ...context, values, updatedAt: 1 },
    });

    await expect(getPopupDraft(context)).resolves.toEqual(values);
    await expect(
      getPopupDraft({ ...context, tabId: 43 }),
    ).resolves.toBeUndefined();
    await expect(
      getPopupDraft({ ...context, url: 'https://jobs.example.com/role/456' }),
    ).resolves.toBeUndefined();
  });

  it('does not restore the single-slot draft after another tab overwrites it', async () => {
    const otherContext = { ...context, tabId: context.tabId + 1 };
    const otherValues = { ...emptyFormValues(), company_name: 'Other tab' };

    await savePopupDraft(otherContext, otherValues);
    browserMock.storage.local.get.mockResolvedValue(
      browserMock.storage.local.set.mock.calls[0]?.[0],
    );

    await expect(getPopupDraft(context)).resolves.toBeUndefined();
    await expect(getPopupDraft(otherContext)).resolves.toEqual(otherValues);
  });

  it('ignores malformed storage instead of breaking popup initialization', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': { ...context, values: { job_title: 123 } },
    });

    await expect(getPopupDraft(context)).resolves.toBeUndefined();
  });

  it('clears only the draft belonging to the current context', async () => {
    const values = emptyFormValues();
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': { ...context, values, updatedAt: 1 },
    });

    await clearPopupDraft(context);
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith(
      'jobTracker.popupDraft',
    );

    browserMock.storage.local.remove.mockClear();
    await clearPopupDraft({ ...context, tabId: 99 });
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
  });

  it('invalidates a stored draft when its tab navigates or closes', async () => {
    const values = emptyFormValues();
    browserMock.storage.local.get.mockResolvedValue({
      'jobTracker.popupDraft': { ...context, values, updatedAt: 1 },
    });

    await clearPopupDraftForTab(context.tabId);
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith(
      'jobTracker.popupDraft',
    );

    browserMock.storage.local.remove.mockClear();
    await clearPopupDraftForTab(context.tabId + 1);
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
  });
});

function getStoredDraft(): Record<string, unknown> {
  const payload: unknown = browserMock.storage.local.set.mock.calls[0]?.[0];
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Expected popup draft storage payload.');
  }
  const draft = (payload as Record<string, Record<string, unknown>>)[
    'jobTracker.popupDraft'
  ];
  if (!draft) throw new Error('Expected stored popup draft.');
  return draft;
}
