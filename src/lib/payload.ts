import {
  MAX_TAGS_PER_FIELD,
  type JobDraft,
  type ScrapePayload,
  scrapePayloadSchema,
} from './schemas';

export function buildScrapePayload(draft: JobDraft): ScrapePayload {
  const payload = omitEmptyValues({
    ...draft,
    external_job_id: cleanString(draft.external_job_id),
    company_name: cleanString(draft.company_name),
    job_title: cleanString(draft.job_title),
    job_link: cleanString(draft.job_link),
    job_location: cleanString(draft.job_location),
    job_description: cleanString(draft.job_description),
    salary_text: cleanString(draft.salary_text),
    skills: cleanTagArray(draft.skills),
    software: cleanTagArray(draft.software),
    keywords: cleanTagArray(draft.keywords),
    certifications: cleanTagArray(draft.certifications),
    extraction_confidence: undefined,
  });

  return scrapePayloadSchema.parse(payload);
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

/**
 * Normalizes one taxonomy category for the payload: blank entries are
 * dropped, duplicates are removed case-insensitively (first spelling wins),
 * the category is capped at {@link MAX_TAGS_PER_FIELD}, and an empty result
 * is omitted from the payload entirely. Each category cleans independently:
 * values are never deduplicated against, or moved into, another category.
 */
function cleanTagArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = cleanString(value);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
    if (cleaned.length === MAX_TAGS_PER_FIELD) break;
  }

  return cleaned.length ? cleaned : undefined;
}

function omitEmptyValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}
