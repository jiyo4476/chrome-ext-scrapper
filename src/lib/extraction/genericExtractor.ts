import type { JobDraft } from '../schemas';

/**
 * Extracts a best-guess {@link JobDraft} from the active page using JSON-LD
 * `JobPosting` markup, OpenGraph/meta tags, the page URL, and finally
 * visible text as a last-resort fallback.
 *
 * IMPORTANT: this function is passed directly to
 * `browser.scripting.executeScript({ func: extractGenericJobDraft })`, which
 * stringifies the function body and injects it into the page. It must not
 * reference any binding from outside its own body/params other than page
 * globals (`document`, `window`, `location`). Only type-only imports are
 * allowed at the module level because those are erased at compile time.
 */
export function extractGenericJobDraft(): {
  draft: JobDraft;
  candidates: Partial<
    Record<
      keyof JobDraft,
      {
        value: unknown;
        source: 'jsonld' | 'meta' | 'visible-text' | 'url';
        confidence: 'high' | 'medium' | 'low';
      }[]
    >
  >;
} {
  type Source = 'jsonld' | 'meta' | 'visible-text' | 'url';
  type Confidence = 'high' | 'medium' | 'low';

  interface Candidate {
    value: unknown;
    source: Source;
    confidence: Confidence;
  }

  type FieldCandidates = Partial<Record<keyof JobDraft, Candidate[]>>;

  const fieldCandidates: FieldCandidates = {};

  function addCandidate(
    field: keyof JobDraft,
    value: unknown,
    source: Source,
    confidence: Confidence,
  ): void {
    if (value === undefined || value === null || value === '') return;
    const existing = fieldCandidates[field];
    const list = existing ?? [];
    list.push({ value, source, confidence });
    fieldCandidates[field] = list;
  }

  function numberOrUndefined(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
  }

  function stripHtml(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    const text = container.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function normalizeDate(raw: string): string | undefined {
    const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
    if (isoMatch?.[1]) return isoMatch[1];

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return undefined;
  }

  function mapEmploymentType(raw: unknown): JobDraft['job_type'] | undefined {
    const employmentTypeMap: Record<string, JobDraft['job_type']> = {
      FULL_TIME: 'full_time',
      PART_TIME: 'part_time',
      CONTRACTOR: 'contract',
      INTERN: 'internship',
      TEMPORARY: 'temp',
    };

    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === 'string') {
        const mapped = employmentTypeMap[value.trim().toUpperCase()];
        if (mapped) return mapped;
      }
    }
    return undefined;
  }

  function extractLocationText(jobLocation: unknown): string | undefined {
    const node: unknown = Array.isArray(jobLocation)
      ? (jobLocation as unknown[])[0]
      : jobLocation;
    if (!node || typeof node !== 'object') return undefined;

    const address = (node as Record<string, unknown>).address;
    if (!address || typeof address !== 'object') return undefined;

    const addr = address as Record<string, unknown>;
    const locality =
      typeof addr.addressLocality === 'string'
        ? addr.addressLocality.trim()
        : undefined;
    const region =
      typeof addr.addressRegion === 'string'
        ? addr.addressRegion.trim()
        : undefined;

    const parts = [locality, region].filter((part): part is string =>
      Boolean(part),
    );
    return parts.length ? parts.join(', ') : undefined;
  }

  function detectRemoteFromJsonLd(
    jobPosting: Record<string, unknown>,
  ): boolean | undefined {
    const locationType = jobPosting.jobLocationType;
    if (
      typeof locationType === 'string' &&
      locationType.toUpperCase().includes('TELECOMMUTE')
    ) {
      return true;
    }

    const requirements = jobPosting.applicantLocationRequirements;
    if (
      requirements &&
      JSON.stringify(requirements).toUpperCase().includes('TELECOMMUTE')
    ) {
      return true;
    }

    if (!jobPosting.jobLocation) {
      const titleText =
        typeof jobPosting.title === 'string' ? jobPosting.title : '';
      const descriptionText =
        typeof jobPosting.description === 'string'
          ? jobPosting.description
          : '';
      const remoteText = `${titleText} ${descriptionText}`.toLowerCase();
      if (/\bremote\b/.test(remoteText)) return true;
    }

    return undefined;
  }

  function extractSalary(jobPosting: Record<string, unknown>): void {
    const baseSalary = jobPosting.baseSalary;
    if (!baseSalary || typeof baseSalary !== 'object') return;

    const baseSalaryObj = baseSalary as Record<string, unknown>;
    const valueNode =
      baseSalaryObj.value && typeof baseSalaryObj.value === 'object'
        ? (baseSalaryObj.value as Record<string, unknown>)
        : undefined;

    const unitText =
      typeof valueNode?.unitText === 'string'
        ? valueNode.unitText
        : typeof baseSalaryObj.unitText === 'string'
          ? baseSalaryObj.unitText
          : undefined;

    if (!unitText) return;

    const minValue =
      numberOrUndefined(valueNode?.minValue) ??
      numberOrUndefined(valueNode?.value);
    const maxValue =
      numberOrUndefined(valueNode?.maxValue) ??
      numberOrUndefined(valueNode?.value);

    const normalizedUnit = unitText.toUpperCase();
    if (normalizedUnit === 'YEAR') {
      addCandidate('salary_type', 'annual', 'jsonld', 'high');
      if (minValue !== undefined) {
        addCandidate(
          'salary_min',
          Math.round(minValue * 100),
          'jsonld',
          'high',
        );
      }
      if (maxValue !== undefined) {
        addCandidate(
          'salary_max',
          Math.round(maxValue * 100),
          'jsonld',
          'high',
        );
      }
    } else if (normalizedUnit === 'HOUR') {
      addCandidate('salary_type', 'hourly', 'jsonld', 'high');
      if (minValue !== undefined) {
        addCandidate('hourly_rate_min', minValue, 'jsonld', 'high');
      }
      if (maxValue !== undefined) {
        addCandidate('hourly_rate_max', maxValue, 'jsonld', 'high');
      }
    }
  }

  function collectFromNode(
    node: unknown,
    out: Record<string, unknown>[],
  ): void {
    if (Array.isArray(node)) {
      node.forEach((item) => {
        collectFromNode(item, out);
      });
      return;
    }
    if (!node || typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const type = obj['@type'];
    const typeStr = Array.isArray(type)
      ? (type as unknown[])
          .filter((entry): entry is string => typeof entry === 'string')
          .join(',')
      : typeof type === 'string'
        ? type
        : '';
    if (typeStr.includes('JobPosting')) {
      out.push(obj);
    }

    if (Array.isArray(obj['@graph'])) {
      collectFromNode(obj['@graph'], out);
    }
  }

  function collectJsonLdJobPostings(): Record<string, unknown>[] {
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    );
    const postings: Record<string, unknown>[] = [];
    for (const script of scripts) {
      const raw = script.textContent;
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        collectFromNode(parsed, postings);
      } catch {
        continue;
      }
    }
    return postings;
  }

  function metaContent(name: string): string | undefined {
    const selector = `meta[name="${name}"], meta[property="${name}"]`;
    const value = document
      .querySelector<HTMLMetaElement>(selector)
      ?.content?.trim();
    return value || undefined;
  }

  function detectPlatform(host: string, url: string): string {
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('glassdoor.com')) return 'glassdoor';
    if (host.includes('dice.com')) return 'dice';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('myworkdayjobs.com')) return 'workday';
    if (host.includes('wellfound.com') || host.includes('angel.co'))
      return 'angellist';
    if (host.includes('google.') && url.includes('ibp=htl')) return 'google';
    if (
      url.toLowerCase().includes('career') ||
      url.toLowerCase().includes('job')
    ) {
      return 'direct';
    }
    return 'other';
  }

  function inferExternalId(url: string, title?: string): string {
    const parsed = new URL(url);
    const indeedKey = parsed.searchParams.get('jk');
    if (indeedKey) return indeedKey;

    const pathId = parsed.pathname.split('/').filter(Boolean).at(-1);
    if (pathId) return pathId.replace(/[^a-zA-Z0-9_-]/g, '-');

    return `${parsed.hostname}-${title || 'job'}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
  }

  // --- jsonld source ---------------------------------------------------
  const jobPosting = collectJsonLdJobPostings()[0];
  if (jobPosting) {
    const title = jobPosting.title;
    addCandidate(
      'job_title',
      typeof title === 'string' ? title.trim() : undefined,
      'jsonld',
      'high',
    );

    const org = jobPosting.hiringOrganization;
    const orgName =
      typeof org === 'string'
        ? org
        : org && typeof org === 'object'
          ? (org as Record<string, unknown>).name
          : undefined;
    addCandidate(
      'company_name',
      typeof orgName === 'string' ? orgName.trim() : undefined,
      'jsonld',
      'high',
    );

    const description = jobPosting.description;
    if (typeof description === 'string') {
      addCandidate('job_description', stripHtml(description), 'jsonld', 'high');
    }

    const datePosted = jobPosting.datePosted;
    if (typeof datePosted === 'string') {
      addCandidate('date_posted', normalizeDate(datePosted), 'jsonld', 'high');
    }

    addCandidate(
      'job_type',
      mapEmploymentType(jobPosting.employmentType),
      'jsonld',
      'high',
    );

    addCandidate(
      'is_remote',
      detectRemoteFromJsonLd(jobPosting),
      'jsonld',
      'high',
    );

    addCandidate(
      'job_location',
      extractLocationText(jobPosting.jobLocation),
      'jsonld',
      'high',
    );

    extractSalary(jobPosting);

    const identifier = jobPosting.identifier;
    const identifierValue =
      typeof identifier === 'string'
        ? identifier
        : identifier && typeof identifier === 'object'
          ? (identifier as Record<string, unknown>).value
          : undefined;
    addCandidate(
      'external_job_id',
      typeof identifierValue === 'string'
        ? identifierValue
        : typeof identifierValue === 'number'
          ? String(identifierValue)
          : undefined,
      'jsonld',
      'high',
    );

    const url = jobPosting.url;
    addCandidate(
      'job_link',
      typeof url === 'string' ? url : undefined,
      'jsonld',
      'high',
    );
  }

  // --- meta source -------------------------------------------------------
  addCandidate('job_title', metaContent('og:title'), 'meta', 'medium');
  const metaDescription =
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.content?.trim() || metaContent('og:description');
  addCandidate('job_description', metaDescription, 'meta', 'medium');
  addCandidate('company_name', metaContent('og:site_name'), 'meta', 'medium');
  addCandidate('job_link', metaContent('og:url'), 'meta', 'medium');

  // --- url source ----------------------------------------------------------
  const href = location.href;
  addCandidate('job_link', href, 'url', 'medium');

  const host = location.hostname.toLowerCase();
  addCandidate('source_platform', detectPlatform(host, href), 'url', 'medium');

  const titleForId =
    document.title || document.querySelector('h1')?.textContent || undefined;
  addCandidate(
    'external_job_id',
    inferExternalId(href, titleForId),
    'url',
    'medium',
  );

  // --- visible-text source -------------------------------------------------
  const h1Text = document
    .querySelector('h1')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
  addCandidate('job_title', h1Text, 'visible-text', 'low');

  const bodyNode =
    document.querySelector('main') ??
    document.querySelector('article') ??
    document.body;
  const bodyText = bodyNode?.textContent
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
  addCandidate('job_description', bodyText, 'visible-text', 'low');

  // --- merge candidates into a single best-guess draft ---------------------
  const priority: Record<Source, number> = {
    jsonld: 0,
    meta: 1,
    url: 2,
    'visible-text': 3,
  };

  const draft: Record<string, unknown> = {};
  const confidenceMap: Partial<Record<keyof JobDraft, Confidence>> = {};
  const outCandidates: FieldCandidates = {};

  (Object.keys(fieldCandidates) as (keyof JobDraft)[]).forEach((field) => {
    const list = fieldCandidates[field];
    if (!list || list.length === 0) return;

    const sorted = [...list].sort(
      (a, b) => priority[a.source] - priority[b.source],
    );
    const winner = sorted[0];
    if (winner) {
      draft[field] = winner.value;
      confidenceMap[field] = winner.confidence;
    }

    const distinctValues = new Set(list.map((c) => JSON.stringify(c.value)));
    if (distinctValues.size >= 2) {
      outCandidates[field] = list;
    }
  });

  if (draft.source_platform === undefined) {
    draft.source_platform = 'other';
  }

  if (Object.keys(confidenceMap).length > 0) {
    draft.extraction_confidence = confidenceMap;
  }

  return {
    draft: draft as unknown as JobDraft,
    candidates: outCandidates,
  };
}
