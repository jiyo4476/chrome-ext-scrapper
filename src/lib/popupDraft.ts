import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { PopupFormValues } from './popupForm';

export const popupFormValuesSchema: z.ZodType<PopupFormValues> = z.object({
  job_title: z.string(),
  company_name: z.string(),
  job_link: z.string(),
  source_platform: z.string(),
  job_location: z.string(),
  is_remote: z.boolean(),
  job_description: z.string(),
  external_job_id: z.string(),
  date_posted: z.string(),
  job_type: z.string(),
  experience_level: z.string(),
  security_clearance_req: z.boolean(),
  salary_type: z.string(),
  salary_min: z.string(),
  salary_max: z.string(),
  hourly_rate_min: z.string(),
  hourly_rate_max: z.string(),
  salary_text: z.string(),
  skills: z.string(),
  software: z.string(),
  keywords: z.string(),
  certifications: z.string(),
});

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
