import { describe, expect, it } from 'vitest';
import { popupDraftPersistenceErrorMessage } from './popupDraftFeedback';

describe('popup draft persistence feedback', () => {
  it('explains stale page context without calling it a storage failure', () => {
    expect(
      popupDraftPersistenceErrorMessage(
        'POPUP_CONTEXT_STALE',
        'Could not store the popup draft.',
      ),
    ).toBe('This page changed or closed. Your outdated draft was not stored.');
  });

  it('preserves genuine storage failure details', () => {
    expect(
      popupDraftPersistenceErrorMessage(
        'STORAGE_FAILED',
        'Could not store the popup draft.',
      ),
    ).toBe('Could not store the popup draft.');
  });
});
