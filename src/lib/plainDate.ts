import { z } from 'zod';

export const PLAIN_DATE_MESSAGE =
  'Use a real calendar date in YYYY-MM-DD format.';

export function isPlainDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const plainDateSchema = z.string().refine(isPlainDate, {
  message: PLAIN_DATE_MESSAGE,
});

export function normalizePlainDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(trimmed);
  if (isoPrefix?.[1]) {
    return isPlainDate(isoPrefix[1]) ? isoPrefix[1] : undefined;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const normalized = parsed.toISOString().slice(0, 10);
  return isPlainDate(normalized) ? normalized : undefined;
}
