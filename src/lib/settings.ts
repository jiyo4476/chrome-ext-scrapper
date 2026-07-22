import { browser } from 'wxt/browser';
import { z } from 'zod';

import {
  DEFAULT_JOB_TRACKER_API_ENDPOINT,
  DEFAULT_OAUTH2_ENDPOINT,
  resolveServiceEndpoint,
} from './serviceEndpoints';

export const DEFAULT_API_BASE_URL = resolveServiceEndpoint(
  import.meta.env.WXT_JOB_TRACKER_API_ENDPOINT,
  DEFAULT_JOB_TRACKER_API_ENDPOINT,
);
export const DEFAULT_AUTHENTIK_BASE_URL = resolveServiceEndpoint(
  import.meta.env.WXT_OAUTH2_ENDPOINT,
  DEFAULT_OAUTH2_ENDPOINT,
);
export const DEFAULT_OAUTH_CLIENT_ID = 'job-tracker-extension';
export const DEFAULT_OAUTH_SCOPE = 'openid profile email';

export const extensionSettingsSchema = z.object({
  apiBaseUrl: z.string().url().default(DEFAULT_API_BASE_URL),
  authentikBaseUrl: z.string().url().default(DEFAULT_AUTHENTIK_BASE_URL),
  oauthClientId: z.string().default(DEFAULT_OAUTH_CLIENT_ID),
  oauthScope: z.string().default(DEFAULT_OAUTH_SCOPE),
  oauthAccessToken: z.string().default(''),
  oauthRefreshToken: z.string().default(''),
  oauthExpiresAt: z.number().default(0),
  autoDetect: z.boolean().default(true),
});

export const extensionSettingsUpdateSchema = extensionSettingsSchema.partial();

export const publicSettingsSchema = extensionSettingsSchema.pick({
  apiBaseUrl: true,
  autoDetect: true,
});

export const publicSettingsUpdateSchema = publicSettingsSchema
  .pick({ autoDetect: true })
  .partial();

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;
export type ExtensionSettingsUpdate = z.infer<
  typeof extensionSettingsUpdateSchema
>;
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export type PublicSettingsUpdate = z.infer<typeof publicSettingsUpdateSchema>;

const STORAGE_KEY = 'jobTracker.settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return lockProtectedSettings(
    extensionSettingsSchema.parse(result[STORAGE_KEY] ?? {}),
  );
}

export async function saveSettings(
  settings: ExtensionSettingsUpdate,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const parsed = lockProtectedSettings(
    extensionSettingsSchema.parse({ ...current, ...settings }),
  );
  await browser.storage.local.set({ [STORAGE_KEY]: parsed });
  return parsed;
}

function lockProtectedSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    ...settings,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    authentikBaseUrl: DEFAULT_AUTHENTIK_BASE_URL,
    oauthClientId: DEFAULT_OAUTH_CLIENT_ID,
    oauthScope: DEFAULT_OAUTH_SCOPE,
  };
}

export function toPublicSettings(settings: ExtensionSettings): PublicSettings {
  return publicSettingsSchema.parse(settings);
}

export async function clearOAuthCredentials(): Promise<ExtensionSettings> {
  return saveSettings({
    oauthAccessToken: '',
    oauthRefreshToken: '',
    oauthExpiresAt: 0,
  });
}
