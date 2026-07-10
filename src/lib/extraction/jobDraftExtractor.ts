import type { ApiSourcePlatform, JobDraft } from '../schemas';

/**
 * Extracts a best-guess {@link JobDraft} from the active page using JSON-LD
 * `JobPosting` markup, OpenGraph/meta tags, platform-specific DOM selectors,
 * the page URL, and finally visible text as a last-resort fallback.
 *
 * IMPORTANT: this function is passed directly to
 * `browser.scripting.executeScript({ func: extractJobDraft, args: [detection] })`,
 * which stringifies the function body and injects it into the page. It must
 * not reference any binding from outside its own body/params other than page
 * globals (`document`, `window`, `location`). Only type-only imports are
 * allowed at the module level because those are erased at compile time.
 *
 * The platform is pre-detected in the background worker (which has `tab.url`
 * available without injection) and passed in as `detection` — this function
 * trusts it entirely rather than re-detecting from `location`, since
 * background already saw the same URL.
 */
export async function extractJobDraft(detection: {
  platform: ApiSourcePlatform;
  confidence: 'high' | 'low';
}): Promise<{
  draft: JobDraft;
  candidates: Partial<
    Record<
      keyof JobDraft,
      {
        value: unknown;
        source: 'jsonld' | 'dom' | 'meta' | 'visible-text' | 'url';
        confidence: 'high' | 'medium' | 'low';
      }[]
    >
  >;
}> {
  type Source = 'jsonld' | 'dom' | 'meta' | 'visible-text' | 'url';
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

  function resolveUrl(raw: string): string | undefined {
    try {
      return new URL(raw, location.href).toString();
    } catch {
      return undefined;
    }
  }

  function queryFirst(
    selectors: string[],
    root: ParentNode = document,
  ): Element | null {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function textOf(el: Element | null | undefined): string | undefined {
    const text = el?.textContent?.replace(/\s+/g, ' ').trim();
    return text || undefined;
  }

  function waitForAny(
    selectors: string[],
    timeoutMs: number,
  ): Promise<Element | undefined> {
    return new Promise((resolve) => {
      const immediate = queryFirst(selectors);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = queryFirst(selectors);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(undefined);
      }, timeoutMs);
    });
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

  function richnessScore(posting: Record<string, unknown>): number {
    return [
      'title',
      'hiringOrganization',
      'description',
      'datePosted',
      'jobLocation',
      'baseSalary',
    ].reduce((score, key) => score + (posting[key] ? 1 : 0), 0);
  }

  function pickRichestJobPosting(
    postings: Record<string, unknown>[],
  ): Record<string, unknown> | undefined {
    if (postings.length === 0) return undefined;
    return postings.reduce((best, current) =>
      richnessScore(current) > richnessScore(best) ? current : best,
    );
  }

  function metaContent(name: string): string | undefined {
    const selector = `meta[name="${name}"], meta[property="${name}"]`;
    const value = document
      .querySelector<HTMLMetaElement>(selector)
      ?.content?.trim();
    return value || undefined;
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

  // --- platform-specific DOM extraction -------------------------------------

  async function extractIndeedDom(): Promise<void> {
    const titleEl = await waitForAny(
      [
        'h1.jobsearch-JobInfoHeader-title',
        '[data-testid="jobsearch-JobInfoHeader-title"]',
        'h1',
      ],
      800,
    );
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');

    addCandidate(
      'company_name',
      textOf(
        queryFirst([
          '[data-testid="inlineHeader-companyName"]',
          '.jobsearch-InlineCompanyRating-companyHeader a',
          '.jobsearch-CompanyInfoContainer a',
        ]),
      ),
      'dom',
      'high',
    );

    addCandidate(
      'job_location',
      textOf(
        queryFirst([
          '[data-testid="inlineHeader-companyLocation"]',
          '.jobsearch-JobInfoHeader-subtitle > div',
        ]),
      ),
      'dom',
      'medium',
    );

    addCandidate(
      'job_description',
      textOf(
        queryFirst([
          '#jobDescriptionText',
          '[data-testid="jobDescriptionText"]',
        ]),
      ),
      'dom',
      'high',
    );
  }

  async function extractGlassdoorDom(): Promise<void> {
    const titleEl = await waitForAny(['[data-test="job-title"]', 'h1'], 800);
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');

    addCandidate(
      'company_name',
      textOf(queryFirst(['[data-test="employer-name"]'])),
      'dom',
      'high',
    );

    addCandidate(
      'job_location',
      textOf(queryFirst(['[data-test="location"]'])),
      'dom',
      'medium',
    );

    addCandidate(
      'job_description',
      textOf(queryFirst(['[data-test="jobDescriptionContent"]', 'article'])),
      'dom',
      'high',
    );
  }

  const GOOGLE_JOB_HEADING_SELECTOR =
    '[role="heading"][aria-level="2"], [role="heading"][aria-level="3"]';
  const MAX_PLAUSIBLE_COMPANY_NAME_LENGTH = 80;

  function queryGoogleJobHeadings(): Element[] {
    return Array.from(document.querySelectorAll(GOOGLE_JOB_HEADING_SELECTOR));
  }

  function pickSelectedGoogleJobHeading(): Element | undefined {
    // On a search-results page, multiple job cards can each render a
    // heading matching this selector -- prefer the one inside a panel
    // explicitly marked as the currently selected/expanded job over just
    // taking the first card in the list.
    const headings = queryGoogleJobHeadings();
    const selected = headings.find((el) =>
      el.closest('[aria-selected="true"], [aria-expanded="true"]'),
    );
    return selected ?? headings[0];
  }

  function waitForSelectedGoogleJobHeading(
    timeoutMs: number,
  ): Promise<Element | undefined> {
    return new Promise((resolve) => {
      const immediate = pickSelectedGoogleJobHeading();
      if (immediate) {
        resolve(immediate);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = pickSelectedGoogleJobHeading();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(undefined);
      }, timeoutMs);
    });
  }

  async function extractGoogleJobsDom(): Promise<void> {
    const titleEl = await waitForSelectedGoogleJobHeading(1800);
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    if (!titleEl) return;

    const titleText = textOf(titleEl);
    const companyText = textOf(titleEl.nextElementSibling);
    if (
      companyText &&
      companyText.length <= MAX_PLAUSIBLE_COMPANY_NAME_LENGTH &&
      companyText !== titleText
    ) {
      addCandidate('company_name', companyText, 'dom', 'low');
    }

    // Only trust a real ancestor container scoped to this heading -- if
    // none exists, omit the description candidate rather than falling back
    // to the whole document, which can silently pick up unrelated content
    // (another job card, page chrome, footer text, etc.).
    const container = titleEl.closest(
      'div, section, article, [role="article"], [role="region"]',
    )?.parentElement;
    if (container) {
      addCandidate(
        'job_description',
        textOf(container.querySelector('section, [role="article"]')),
        'dom',
        'low',
      );
    }
  }

  // --- jsonld source ---------------------------------------------------
  const jobPosting = pickRichestJobPosting(collectJsonLdJobPostings());
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
      typeof url === 'string' ? resolveUrl(url) : undefined,
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

  const JOB_BOARD_PLATFORMS = new Set<ApiSourcePlatform>([
    'linkedin',
    'indeed',
    'glassdoor',
    'dice',
    'lever',
    'greenhouse',
    'workday',
    'angellist',
    'google',
  ]);
  if (!JOB_BOARD_PLATFORMS.has(detection.platform)) {
    // og:site_name is the *hosting site's* brand (e.g. "Indeed", "Glassdoor")
    // on known job boards, not the employer -- only trust it as a company
    // name candidate on unrecognized sites, where it's plausibly the
    // employer's own careers page.
    addCandidate('company_name', metaContent('og:site_name'), 'meta', 'medium');
  }

  const metaUrl = metaContent('og:url');
  addCandidate(
    'job_link',
    metaUrl ? resolveUrl(metaUrl) : undefined,
    'meta',
    'medium',
  );

  // --- url source ----------------------------------------------------------
  const href = location.href;
  addCandidate('job_link', href, 'url', 'medium');
  addCandidate(
    'source_platform',
    detection.platform,
    'url',
    detection.confidence,
  );

  const titleForId =
    document.title || document.querySelector('h1')?.textContent || undefined;
  addCandidate(
    'external_job_id',
    inferExternalId(href, titleForId),
    'url',
    'medium',
  );

  // --- platform-specific dom source -----------------------------------------
  if (detection.platform === 'indeed') {
    await extractIndeedDom();
  } else if (detection.platform === 'glassdoor') {
    await extractGlassdoorDom();
  } else if (detection.platform === 'google') {
    await extractGoogleJobsDom();
  }

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
    dom: 1,
    meta: 2,
    url: 3,
    'visible-text': 4,
  };
  const confidenceRank: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const draft: Record<string, unknown> = {};
  const confidenceMap: Partial<Record<keyof JobDraft, Confidence>> = {};
  const outCandidates: FieldCandidates = {};

  (Object.keys(fieldCandidates) as (keyof JobDraft)[]).forEach((field) => {
    const list = fieldCandidates[field];
    if (!list || list.length === 0) return;

    // Confidence is the primary ranking signal -- a targeted but uncertain
    // 'dom' heuristic (e.g. Google's proximity-based description guess)
    // should not out-rank a more reliable lower-priority source just
    // because 'dom' sits above it in the source priority order. Source
    // priority only breaks ties between candidates of equal confidence.
    const sorted = [...list].sort(
      (a, b) =>
        confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
        priority[a.source] - priority[b.source],
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

  if (Object.keys(confidenceMap).length > 0) {
    draft.extraction_confidence = confidenceMap;
  }

  return {
    draft: draft as unknown as JobDraft,
    candidates: outCandidates,
  };
}
