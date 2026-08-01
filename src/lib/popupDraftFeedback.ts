import type { ExtensionErrorCode } from './messages';

export function popupDraftPersistenceErrorMessage(
  code: ExtensionErrorCode,
  fallbackMessage: string,
): string {
  if (code === 'POPUP_CONTEXT_STALE') {
    return 'This page changed or closed. Your outdated draft was not stored.';
  }
  return fallbackMessage;
}
