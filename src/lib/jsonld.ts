import type { JobDraft } from './schemas';

const EMPLOYMENT_TYPE_MAP: Record<NonNullable<JobDraft['job_type']>, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  internship: 'INTERN',
  temp: 'TEMPORARY',
  freelance: 'CONTRACTOR',
};

/**
 * Maps a reviewed {@link JobDraft} to a schema.org `JobPosting` JSON-LD
 * object. This is a pure, explicit allowlist mapper: it never sees or emits
 * OAuth tokens, API keys, settings, cookies, or raw page HTML because
 * `JobDraft` never carries those fields.
 *
 * Taxonomy mapping policy (reviewed for EXT-TAXONOMY-001) -- each of the
 * four categories has an explicit decision; none is ever silently collapsed
 * into another:
 *
 * - `skills`         -> JobPosting `skills` (schema.org Text; emitted as an
 *                       array of strings).
 * - `certifications` -> JobPosting `qualifications` as
 *                       `EducationalOccupationalCredential` objects, the
 *                       schema.org type for named credentials.
 * - `software`       -> omitted. JobPosting has no property for named
 *                       tools/products, and serializing software under
 *                       `skills` would collapse the taxonomy.
 * - `keywords`       -> omitted. `keywords` is a CreativeWork property, not
 *                       a JobPosting property, and these contextual labels
 *                       are not schema.org skills.
 */
export function buildJobPostingJsonLd(
  draft: JobDraft,
): Record<string, unknown> {
  const baseSalary = buildBaseSalary(draft);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: draft.job_title,
    description: draft.job_description,
    datePosted: draft.date_posted,
    employmentType: draft.job_type
      ? EMPLOYMENT_TYPE_MAP[draft.job_type]
      : undefined,
    hiringOrganization: draft.company_name
      ? { '@type': 'Organization', name: draft.company_name }
      : undefined,
    jobLocation: draft.job_location
      ? { '@type': 'Place', address: draft.job_location }
      : undefined,
    jobLocationType: draft.is_remote ? 'TELECOMMUTE' : undefined,
    baseSalary,
    skills: draft.skills?.length ? [...draft.skills] : undefined,
    qualifications: draft.certifications?.length
      ? draft.certifications.map((name) => ({
          '@type': 'EducationalOccupationalCredential',
          name,
        }))
      : undefined,
    identifier: draft.external_job_id
      ? { '@type': 'PropertyValue', value: draft.external_job_id }
      : undefined,
    url: draft.job_link,
  };

  return stripUndefinedDeep(jsonLd) as Record<string, unknown>;
}

function buildBaseSalary(draft: JobDraft): Record<string, unknown> | undefined {
  if (draft.salary_min !== undefined || draft.salary_max !== undefined) {
    return {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue:
          draft.salary_min !== undefined ? draft.salary_min / 100 : undefined,
        maxValue:
          draft.salary_max !== undefined ? draft.salary_max / 100 : undefined,
        unitText: 'YEAR',
      },
    };
  }

  if (
    draft.hourly_rate_min !== undefined ||
    draft.hourly_rate_max !== undefined
  ) {
    return {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: draft.hourly_rate_min,
        maxValue: draft.hourly_rate_max,
        unitText: 'HOUR',
      },
    };
  }

  return undefined;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .map(([key, fieldValue]) => [key, stripUndefinedDeep(fieldValue)]);
    return Object.fromEntries(entries);
  }

  return value;
}

/**
 * Builds a safe `.jsonld` filename from the draft's company and title.
 */
export function buildExportFilename(draft: JobDraft): string {
  const company = sanitizeFilenamePart(draft.company_name);
  const title = sanitizeFilenamePart(draft.job_title);

  const parts = [company, title].filter((part) => part.length > 0);
  if (parts.length === 0) return 'job-posting.jsonld';

  return `${parts.join('_')}.jsonld`;
}

function sanitizeFilenamePart(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}
