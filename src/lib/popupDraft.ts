import { browser } from 'wxt/browser';
import { z } from 'zod';
import { type PopupFormValues, popupFormValuesSchema } from './popupForm';

export const popupDraftContextSchema = z.object({
  tabId: z.number().int().nonnegative(),
  url: z.string().min(1),
});

const popupDraftSchema = popupDraftContextSchema.extend({
  values: popupFormValuesSchema,
  updatedAt: z.number().int().nonnegative(),
});

export interface PopupDraftContext {
  tabId: number;
  url: string;
}

interface PopupDraft {
  tabId: number;
  url: string;
  values: PopupFormValues;
  updatedAt: number;
}

// This feature intentionally uses one slot: opening the popup for another tab
// replaces the prior tab's draft, while context matching prevents cross-tab
// restoration. Move to a tab-keyed record if multi-tab draft retention becomes
// a product requirement.
const STORAGE_KEY = 'jobTracker.popupDraft';

export async function getPopupDraft(
  context: PopupDraftContext,
): Promise<PopupFormValues | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const parsed = popupDraftSchema.safeParse(result[STORAGE_KEY]);
  if (!parsed.success || !matchesContext(parsed.data, context)) {
    return undefined;
  }
  return parsed.data.values;
}

export async function savePopupDraft(
  context: PopupDraftContext,
  values: PopupFormValues,
): Promise<void> {
  const draft: PopupDraft = popupDraftSchema.parse({
    ...context,
    values,
    updatedAt: Date.now(),
  });
  await browser.storage.local.set({ [STORAGE_KEY]: draft });
}

export async function clearPopupDraft(
  context: PopupDraftContext,
): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const parsed = popupDraftSchema.safeParse(result[STORAGE_KEY]);
  if (parsed.success && matchesContext(parsed.data, context)) {
    await browser.storage.local.remove(STORAGE_KEY);
  }
}

export async function clearPopupDraftForTab(tabId: number): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const parsed = popupDraftSchema.safeParse(result[STORAGE_KEY]);
  if (parsed.success && parsed.data.tabId === tabId) {
    await browser.storage.local.remove(STORAGE_KEY);
  }
}

function matchesContext(
  draft: Pick<PopupDraft, 'tabId' | 'url'>,
  context: PopupDraftContext,
): boolean {
  return draft.tabId === context.tabId && draft.url === context.url;
}
