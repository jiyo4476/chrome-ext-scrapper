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

  // Waits on several independent selector groups at once via a single
  // shared MutationObserver, instead of one observer per group -- avoids
  // doubling observer-callback overhead when a platform extractor needs to
  // wait on e.g. title and description together.
  function waitForEach(
    selectorGroups: string[][],
    timeoutMs: number,
  ): Promise<(Element | undefined)[]> {
    return new Promise((resolve) => {
      const results: (Element | undefined)[] = selectorGroups.map(
        () => undefined,
      );
      const pending = new Set(selectorGroups.map((_, i) => i));

      function checkPending(): boolean {
        for (const i of Array.from(pending)) {
          const el = queryFirst(selectorGroups[i] ?? []);
          if (el) {
            results[i] = el;
            pending.delete(i);
          }
        }
        return pending.size === 0;
      }

      if (checkPending()) {
        resolve(results);
        return;
      }

      const observer = new MutationObserver(() => {
        if (checkPending()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(results);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(results);
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

    // A posting whose own `url` points at this exact page is almost
    // certainly the one actually being viewed -- prefer it outright over a
    // richer but unrelated block (e.g. a "similar jobs" widget's JobPosting)
    // that just happens to have more fields populated.
    const currentUrlMatch = postings.find((posting) => {
      const url = posting.url;
      return typeof url === 'string' && resolveUrl(url) === location.href;
    });
    if (currentUrlMatch) return currentUrlMatch;

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
    // Wait on title and description together -- the header commonly paints
    // before #jobDescriptionText, which Indeed often populates via a
    // follow-up XHR. Waiting on title alone would return as soon as it
    // resolves and silently miss a still-loading description.
    const [titleEl, descriptionEl] = await waitForEach(
      [
        [
          'h1.jobsearch-JobInfoHeader-title',
          '[data-testid="jobsearch-JobInfoHeader-title"]',
          'h1',
        ],
        ['#jobDescriptionText', '[data-testid="jobDescriptionText"]'],
      ],
      800,
    );
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    addCandidate('job_description', textOf(descriptionEl), 'dom', 'high');

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
  }

  async function extractGlassdoorDom(): Promise<void> {
    const [titleEl, descriptionEl] = await waitForEach(
      [
        ['[data-test="job-title"]', 'h1'],
        ['[data-test="jobDescriptionContent"]', 'article'],
      ],
      800,
    );
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    addCandidate('job_description', textOf(descriptionEl), 'dom', 'high');

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
  }

  const GOOGLE_JOB_HEADING_SELECTOR =
    '[role="heading"][aria-level="2"], [role="heading"][aria-level="3"]';
  const MAX_PLAUSIBLE_COMPANY_NAME_LENGTH = 80;

  function queryGoogleJobHeadings(): Element[] {
    return Array.from(document.querySelectorAll(GOOGLE_JOB_HEADING_SELECTOR));
  }

  function findExplicitlySelectedGoogleJobHeading(
    headings: Element[],
  ): Element | undefined {
    // On a search-results page, multiple job cards can each render a
    // heading matching this selector -- prefer the one inside a panel
    // explicitly marked as the currently selected/expanded job over just
    // taking the first card in the list.
    return headings.find((el) =>
      el.closest('[aria-selected="true"], [aria-expanded="true"]'),
    );
  }

  function pickSelectedGoogleJobHeading(): Element | undefined {
    const headings = queryGoogleJobHeadings();
    // With more than one heading present and none yet marked selected, the
    // choice is genuinely ambiguous -- return undefined so the caller keeps
    // waiting for a selection signal instead of eagerly guessing headings[0].
    // With exactly one heading there's nothing to disambiguate, so resolve
    // immediately rather than waiting out the full timeout on every
    // single-result page.
    return (
      findExplicitlySelectedGoogleJobHeading(headings) ??
      (headings.length === 1 ? headings[0] : undefined)
    );
  }

  function pickGoogleJobDescriptionContainer(
    titleEl: Element,
  ): Element | undefined {
    // Prefer the ancestor explicitly marked as the currently selected/
    // expanded job card -- this is the only scope guaranteed not to leak
    // content from an adjacent card on a multi-result page.
    const selectedCard = titleEl.closest(
      '[aria-selected="true"], [aria-expanded="true"]',
    );
    if (selectedCard) return selectedCard;

    // Single-result pages often carry no explicit selection state. Fall
    // back to a bounded ancestor container, searching from the heading's
    // *parent* rather than the heading itself -- closest() matches the
    // element itself first, and the heading is frequently a <div>, one of
    // this selector's own tags, which would otherwise make the "bounded"
    // check pass trivially and land one level too high.
    return (
      titleEl.parentElement?.closest(
        'div, section, article, [role="article"], [role="region"]',
      ) ?? undefined
    );
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
        // Some SPAs toggle aria-selected/aria-expanded on already-mounted
        // card nodes instead of inserting new elements -- without watching
        // attributes, that toggle wouldn't retrigger evaluation and this
        // could resolve to the wrong (first) heading before selection state
        // ever lands.
        attributes: true,
        attributeFilter: ['aria-selected', 'aria-expanded'],
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        // No explicit selection ever appeared -- fall back to the first
        // heading found, if any, rather than surfacing nothing.
        resolve(queryGoogleJobHeadings()[0]);
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

    const container = pickGoogleJobDescriptionContainer(titleEl);
    if (container) {
      // 'medium', not 'low': once a bounded, explicitly-scoped container is
      // found (see pickGoogleJobDescriptionContainer's own scoping guard),
      // this is the selected job's actual description, not a fabricated
      // guess -- it should out-rank a generic page-level meta description
      // in the merge step, not lose to it.
      addCandidate(
        'job_description',
        textOf(container.querySelector('section, [role="article"]')),
        'dom',
        'medium',
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

  // og:site_name is the *hosting site's own* brand (e.g. "Indeed",
  // "Glassdoor") on aggregator job boards, not the employer -- only trust it
  // as a company name candidate off this set. Greenhouse/Lever/Workday are
  // deliberately excluded: those are white-labeled ATS embeds hosted under
  // the *employer's own* branding (e.g. boards.greenhouse.io/acmecorp), so
  // og:site_name there is plausibly the employer's own name, same as an
  // unrecognized careers page.
  const SITE_BRANDED_PLATFORMS = new Set<ApiSourcePlatform>([
    'linkedin',
    'indeed',
    'glassdoor',
    'dice',
    'angellist',
    'google',
  ]);
  if (!SITE_BRANDED_PLATFORMS.has(detection.platform)) {
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
  // A single dispatch table instead of a hand-written if/else chain -- adding
  // a new platform's DOM extractor is then a one-line addition here, in one
  // place, instead of a new branch easy to forget.
  const platformDomExtractors: Partial<
    Record<ApiSourcePlatform, () => Promise<void>>
  > = {
    indeed: extractIndeedDom,
    glassdoor: extractGlassdoorDom,
    google: extractGoogleJobsDom,
  };
  await platformDomExtractors[detection.platform]?.();

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
  // 'dom' ranks above 'jsonld' as a tiebreak: a platform DOM extractor only
  // runs for the platform actually detected on this page, scraping whatever
  // is on screen right now, whereas a JSON-LD block can be stale left-over
  // markup from a previous SPA-rendered view (e.g. a split-view results list
  // where clicking a different job updates the visible panel but not a
  // server-rendered <head> script tag) that just happens to still be present
  // in the DOM.
  const priority: Record<Source, number> = {
    dom: 0,
    jsonld: 1,
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
