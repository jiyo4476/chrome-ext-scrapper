import {
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
    job_description: cleanMultilineString(draft.job_description),
    salary_text: cleanString(draft.salary_text),
    skills: cleanStringArray(draft.skills),
    software: cleanStringArray(draft.software),
    keywords: cleanStringArray(draft.keywords),
    certifications: cleanStringArray(draft.certifications),
    extraction_confidence: undefined,
  });

  return scrapePayloadSchema.parse(payload);
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function cleanMultilineString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === '') start += 1;
  while (end > start && lines[end - 1]?.trim() === '') end -= 1;

  const cleaned = lines.slice(start, end).join('\n');
  return cleaned || undefined;
}

function cleanStringArray(values: string[] | undefined): string[] | undefined {
  const cleaned = values
    ?.map((value) => cleanString(value))
    .filter((value): value is string => Boolean(value));

  return cleaned?.length ? cleaned : undefined;
}

function omitEmptyValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}
