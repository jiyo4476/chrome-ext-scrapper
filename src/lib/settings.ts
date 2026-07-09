import { browser } from 'wxt/browser';
import { z } from 'zod';

export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const extensionSettingsSchema = z.object({
  apiBaseUrl: z.string().url().default(DEFAULT_API_BASE_URL),
  apiKey: z.string().default(''),
  autoDetect: z.boolean().default(false),
});

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

const STORAGE_KEY = 'jobTracker.settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return extensionSettingsSchema.parse(result[STORAGE_KEY] ?? {});
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<ExtensionSettings> {
  const parsed = extensionSettingsSchema.parse(settings);
  await browser.storage.local.set({ [STORAGE_KEY]: parsed });
  return parsed;
}

export function redactApiKey(value: string): string {
  if (value.length <= 6) return value ? '***' : '';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
