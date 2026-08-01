import { describe, expect, it } from 'vitest';
import { isPlainDate, normalizePlainDate, plainDateSchema } from './plainDate';

describe('plain dates', () => {
  it.each(['2025-02-29', '2026-02-30', '2026-04-31', '2026-13-01'])(
    'rejects impossible calendar date %s',
    (value) => {
      expect(isPlainDate(value)).toBe(false);
      expect(plainDateSchema.safeParse(value).success).toBe(false);
      expect(normalizePlainDate(value)).toBeUndefined();
    },
  );

  it.each(['0096-02-29', '2024-02-29', '2000-02-29', '2026-12-31'])(
    'round-trips valid date %s',
    (value) => {
      expect(isPlainDate(value)).toBe(true);
      expect(plainDateSchema.parse(value)).toBe(value);
      expect(normalizePlainDate(value)).toBe(value);
    },
  );

  it('normalizes valid timestamp and human-readable inputs', () => {
    expect(normalizePlainDate('2024-02-29T18:30:00Z')).toBe('2024-02-29');
    expect(normalizePlainDate('July 1, 2026')).toBe('2026-07-01');
  });
});
