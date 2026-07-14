import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import type { ApiSourcePlatform, JobDraft } from '../schemas';

// '#text' must be listed explicitly alongside KEEP_CONTENT: false below --
// without it, DOMPurify treats bare text nodes as unlisted too and strips
// all of them, not just the content of actually-disallowed elements like
// <script>.
const DESCRIPTION_TAGS = [
  '#text',
  'a',
  'article',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'strong',
  'ul',
];

// Preserve the text inside unrecognized presentation wrappers (for example
// <span>, <mark>, or table cells) while removing both the element and content
// of active/embedded controls. This avoids silently deleting meaningful job
// description text without letting executable page content reach Turndown.
const DESCRIPTION_FORBIDDEN_TAGS = [
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'math',
  'noscript',
  'object',
  'option',
  'script',
  'select',
  'style',
  'svg',
  'textarea',
];

type LinkedinJobTypeMapping = readonly [
  RegExp,
  NonNullable<JobDraft['job_type']>,
];

type LinkedinExperienceLevelMapping = readonly [
  RegExp,
  NonNullable<JobDraft['experience_level']>,
];

const LINKEDIN_JOB_TYPE_MAPPINGS: readonly LinkedinJobTypeMapping[] = [
  [/^(full[- ]time|permanent)$/i, 'full_time'],
  [/^part[- ]time$/i, 'part_time'],
  [/^(contract|contractor|c2c|w2 contract)$/i, 'contract'],
  [/^(intern|internship)$/i, 'internship'],
  [/^(temporary|seasonal)$/i, 'temp'],
  [/^freelance$/i, 'freelance'],
];

const LINKEDIN_EXPERIENCE_LEVEL_MAPPINGS: readonly LinkedinExperienceLevelMapping[] =
  [
    [/^(executive|director)$/i, 'executive'],
    [/^(mid-senior level|senior)$/i, 'senior'],
    [/^(associate|mid level|mid-level)$/i, 'mid'],
    [/^(entry level|entry-level|internship)$/i, 'entry'],
  ];

function normalizeMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (line.endsWith('  ') ? line : line.replace(/[ \t]+$/, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Built once at module scope: this configuration is stateless across calls,
// and htmlToSafeMarkdown() can run several times per extraction (DOM/JSON-LD
// /meta/visible-text candidates), so re-instantiating it per call is wasted
// setup work.
const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  headingStyle: 'atx',
  strongDelimiter: '**',
});

// Turndown pads list markers to 4 columns (e.g. "-   item") to line up
// continuation lines under a 4-space indent; override with a single space
// so plain lists don't come out with distractingly wide gaps.
turndown.addRule('listItem', {
  filter: 'li',
  replacement(content, node, options) {
    const parent = node.parentNode as Element | null;
    let prefix = `${options.bulletListMarker ?? '-'} `;
    if (parent?.nodeName === 'OL') {
      const start = parent.getAttribute('start');
      const index = Array.prototype.indexOf.call(parent.children, node);
      const number = start ? Number(start) + index : index + 1;
      prefix = `${String(number)}. `;
    }
    const isParagraph = content.endsWith('\n');
    const trimmed = content.replace(/^\n+/, '').replace(/\n+$/, '');
    const body = trimmed + (isParagraph ? '\n' : '');
    const indented = body.replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
    return prefix + indented + (node.nextSibling ? '\n' : '');
  },
});

// `src` is never in ALLOWED_ATTR below, so an <img> only ever carries alt
// text here -- surface that as plain text instead of Turndown's default
// `![alt](src)` rule, which drops the alt text entirely when there's no src.
turndown.addRule('image', {
  filter: 'img',
  replacement(_content, node) {
    const alt = (node as Element).getAttribute('alt')?.trim();
    return alt ? turndown.escape(alt) : '';
  },
});

// Turndown's default escaping only guards Markdown syntax characters, not
// `<`/`>` -- without escaping those too, sanitized-away tag text left over
// as plain text (e.g. "Use <script>...") would still read as raw,
// renderer-interpretable HTML once this Markdown is displayed downstream.
const defaultEscape = turndown.escape.bind(turndown);
turndown.escape = (text: string) =>
  defaultEscape(text).replace(/</g, '\\<').replace(/>/g, '\\>');

function htmlToSafeMarkdown(html: string | Node): string {
  // RETURN_DOM_FRAGMENT hands back DOMPurify's own sanitized DOM tree
  // directly, so the sanitized markup is never re-serialized to a string and
  // reassigned via `innerHTML` -- there's no second HTML-parsing pass for a
  // scanner (or a browser mXSS quirk) to find a gadget in.
  const sanitizedFragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DESCRIPTION_TAGS,
    ALLOWED_ATTR: ['href', 'alt'],
    FORBID_TAGS: DESCRIPTION_FORBIDDEN_TAGS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const link of sanitizedFragment.querySelectorAll<HTMLAnchorElement>(
    'a[href]',
  )) {
    const rawHref = link.getAttribute('href');
    try {
      const url = new URL(rawHref ?? '', document.baseURI);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        link.removeAttribute('href');
      } else {
        link.href = url.href;
      }
    } catch {
      link.removeAttribute('href');
    }
  }

  return normalizeMarkdown(turndown.turndown(sanitizedFragment));
}

function plainTextToSafeMarkdown(text: string): string {
  const container = document.createElement('div');
  container.textContent = text;
  return htmlToSafeMarkdown(container.innerHTML);
}

function elementToSafeMarkdown(root: Element): string {
  return htmlToSafeMarkdown(root.innerHTML);
}

/**
 * Extracts a best-guess {@link JobDraft} from the active page using JSON-LD
 * `JobPosting` markup, OpenGraph/meta tags, platform-specific DOM selectors,
 * the page URL, and finally visible text as a last-resort fallback.
 *
 * Runs from the locally bundled runtime content script in the MV3 isolated
 * world so the DOMPurify and Turndown browser dependencies remain available.
 */
export async function extractJobDraft(detection: {
  platform: ApiSourcePlatform;
  confidence: 'high' | 'low';
  externalJobId?: string;
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

  function bySelector(selectors: string[]): () => Element | undefined {
    return () => queryFirst(selectors) ?? undefined;
  }

  // Waits on several independent element finders at once via a single
  // shared MutationObserver, instead of one observer per finder -- avoids
  // doubling observer-callback overhead when a platform extractor needs to
  // wait on e.g. title and description together. Each finder can be a
  // CSS-selector lookup (see `bySelector`) or any other DOM query, e.g.
  // matching by text content, which no CSS selector alone can express.
  function waitForEach(
    finders: (() => Element | undefined)[],
    timeoutMs: number,
  ): Promise<(Element | undefined)[]> {
    return new Promise((resolve) => {
      const results: (Element | undefined)[] = finders.map(() => undefined);
      const pending = new Set(finders.map((_, i) => i));

      function checkPending(): boolean {
        for (const i of Array.from(pending)) {
          const el = finders[i]?.();
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
        bySelector([
          'h1.jobsearch-JobInfoHeader-title',
          '[data-testid="jobsearch-JobInfoHeader-title"]',
          'h1',
        ]),
        bySelector([
          '#jobDescriptionText',
          '[data-testid="jobDescriptionText"]',
        ]),
      ],
      800,
    );
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    addCandidate(
      'job_description',
      descriptionEl ? elementToSafeMarkdown(descriptionEl) : undefined,
      'dom',
      'high',
    );

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
        bySelector(['[data-test="job-title"]', 'h1']),
        bySelector(['[data-test="jobDescriptionContent"]', 'article']),
      ],
      800,
    );
    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    addCandidate(
      'job_description',
      descriptionEl ? elementToSafeMarkdown(descriptionEl) : undefined,
      'dom',
      'high',
    );

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

  async function extractDiceDom(): Promise<void> {
    const currentPath = location.pathname.replace(/\/$/, '');
    const detailLink = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/job-detail/"]'),
    ).find((link) => {
      try {
        return (
          new URL(link.href, location.href).pathname.replace(/\/$/, '') ===
          currentPath
        );
      } catch {
        return false;
      }
    });

    const detailRoot =
      detailLink?.closest('main, article, [role="main"], [role="article"]') ??
      document.querySelector('main') ??
      document.body;
    const [titleEl, descriptionEl] = await waitForEach(
      [
        () =>
          detailRoot.querySelector(
            'h1, [data-testid="job-detail-title"], [data-cy="job-title"]',
          ) ??
          detailLink ??
          undefined,
        () =>
          detailRoot.querySelector(
            '[data-testid="job-description"], [data-cy="job-description"], [class*="job-description"], [class*="jobDescription"]',
          ) ?? undefined,
      ],
      800,
    );

    addCandidate('job_title', textOf(titleEl), 'dom', 'high');
    addCandidate(
      'job_description',
      descriptionEl ? elementToSafeMarkdown(descriptionEl) : undefined,
      'dom',
      'high',
    );
    addCandidate(
      'company_name',
      textOf(
        detailRoot.querySelector(
          'a[href*="/company-profile/"], [data-testid="company-name"], [data-cy="company-name"]',
        ),
      ),
      'dom',
      'high',
    );
    addCandidate(
      'job_location',
      textOf(
        detailRoot.querySelector(
          '[data-testid="job-location"], [data-cy="location"], [class*="location"]',
        ),
      ),
      'dom',
      'medium',
    );
  }

  // LinkedIn's own <title> tag already spells out
  // "{Title} | {Company} | LinkedIn" (optionally prefixed with an
  // unread-notification badge like "(3) "). Parsing it is available the
  // instant the page loads, unlike any DOM selector, which depends on
  // LinkedIn's client-side render and rotates classnames across deploys.
  function parseLinkedinPageTitle(rawTitle: string): {
    company?: string | undefined;
    title?: string | undefined;
  } {
    const withoutBadge = rawTitle.replace(/^\(\d+\)\s*/, '');
    const parts = withoutBadge.split('|').map((part) => part.trim());
    if (parts.length < 3 || parts.at(-1)?.toLowerCase() !== 'linkedin') {
      return {};
    }
    return {
      title: parts[0] || undefined,
      company: parts[1] || undefined,
    };
  }

  function findLastLinkedinLazyColumn(): Element | undefined {
    return Array.from(
      document.querySelectorAll('[data-testid="lazy-column"]'),
    ).at(-1);
  }

  function findAboutTheJobHeading(): Element | undefined {
    const root = findLastLinkedinLazyColumn() ?? document;
    const heading = Array.from(root.querySelectorAll('h2')).find((h) =>
      textOf(h)?.toLowerCase().includes('about the job'),
    );
    return heading ?? undefined;
  }

  function findLinkedinCompany(): Element | undefined {
    const root = findLastLinkedinLazyColumn() ?? document;
    return (
      root.querySelector('a[href^="https://www.linkedin.com/company/"]') ??
      undefined
    );
  }

  function isWithinLinkedinDescription(
    element: Element,
    heading: Element | undefined,
    stopHeading: Element | undefined,
  ): boolean {
    if (!heading) return false;
    const followsHeading = Boolean(
      heading.compareDocumentPosition(element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const precedesStop =
      !stopHeading ||
      Boolean(
        element.compareDocumentPosition(stopHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    return element === heading || (followsHeading && precedesStop);
  }

  function findLinkedinDescriptionStopHeading(
    root: ParentNode,
    heading: Element,
  ): Element | undefined {
    const startLevel = headingLevel(heading) ?? 2;
    return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
      (candidate) =>
        candidate !== heading &&
        Boolean(
          heading.compareDocumentPosition(candidate) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ) &&
        (headingLevel(candidate) ?? 7) <= startLevel,
    );
  }

  function linkedinCompactTexts(
    root: ParentNode,
    descriptionHeading: Element | undefined,
  ): string[] {
    const descriptionStopHeading = descriptionHeading
      ? findLinkedinDescriptionStopHeading(root, descriptionHeading)
      : undefined;
    const values = Array.from(
      root.querySelectorAll<HTMLElement>('button, a, li, span, p'),
    ).flatMap((element) => {
      if (
        isWithinLinkedinDescription(
          element,
          descriptionHeading,
          descriptionStopHeading,
        )
      ) {
        return [];
      }
      const text = textOf(element);
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      return [text, ariaLabel];
    });

    return Array.from(
      new Set(
        values.filter(
          (value): value is string =>
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= 200,
        ),
      ),
    );
  }

  function mapLinkedinJobType(
    texts: string[],
  ): JobDraft['job_type'] | undefined {
    for (const text of texts) {
      const mapping = LINKEDIN_JOB_TYPE_MAPPINGS.find(([pattern]) =>
        pattern.test(text),
      );
      if (mapping) return mapping[1];
    }
    return undefined;
  }

  function mapLinkedinExperienceLevel(
    texts: string[],
  ): JobDraft['experience_level'] | undefined {
    for (const text of texts) {
      const mapping = LINKEDIN_EXPERIENCE_LEVEL_MAPPINGS.find(([pattern]) =>
        pattern.test(text),
      );
      if (mapping) return mapping[1];
    }
    return undefined;
  }

  function inferExperienceFromTitle(
    title: string | undefined,
  ): JobDraft['experience_level'] | undefined {
    if (!title) return undefined;
    if (/\b(chief|director|vice president|vp|executive)\b/i.test(title)) {
      return 'executive';
    }
    if (/\b(staff|principal|lead)\b/i.test(title)) return 'lead';
    if (/\b(senior|sr\.?)\b/i.test(title)) return 'senior';
    if (/\b(mid[- ]level|intermediate)\b/i.test(title)) return 'mid';
    if (/\b(junior|jr\.?|entry[- ]level|new grad|intern)\b/i.test(title)) {
      return 'entry';
    }
    return undefined;
  }

  function detectLinkedinRemote(texts: string[]): boolean | undefined {
    if (texts.some((text) => /^remote$/i.test(text))) return true;
    if (texts.some((text) => /^(hybrid|on[- ]site|onsite)$/i.test(text))) {
      return false;
    }
    return undefined;
  }

  function detectClearanceRequirement(
    description: string | undefined,
  ): boolean | undefined {
    if (!description) return undefined;
    if (
      /\bno (?:[\w/-]+ ){0,4}(?:security )?clearance (?:is )?required\b/i.test(
        description,
      ) ||
      /\b(?:does not|doesn't|do not|don't) require (?:an? )?(?:[\w/-]+ ){0,4}(?:security )?clearance\b/i.test(
        description,
      ) ||
      /\b(?:[\w/-]+ ){0,4}(?:security )?clearance\b[^\n.!?]{0,40}\bnot (?:currently )?required\b/i.test(
        description,
      )
    ) {
      return false;
    }
    if (
      /\b(?:active|current) (?:[\w/-]+ )?(?:security )?clearance\b/i.test(
        description,
      ) ||
      /\b(?:clearance|security clearance) (?:is )?required\b/i.test(
        description,
      ) ||
      /\b(?:must (?:have|hold|possess)|requires?|required to (?:have|hold|possess)|ability to obtain) (?:an? )?(?:active )?(?:[\w/-]+ )?(?:security )?clearance\b/i.test(
        description,
      ) ||
      /\b(?:TS\/SCI|top secret\/SCI|secret clearance)\b/i.test(description)
    ) {
      return true;
    }
    return undefined;
  }

  function parseLinkedinSalary(texts: string[]):
    | {
        text: string;
        type: NonNullable<JobDraft['salary_type']>;
        min: number;
        max: number;
      }
    | undefined {
    const hasUsdMarker = (text: string): boolean =>
      !/\b(?!US(?:D)?\b)[A-Z]{1,3}\s*\$/i.test(text) &&
      /(?:\bUSD\b|\bUS\$|(?<![A-Za-z])\$)/i.test(text);
    const salaryText = texts
      .filter(
        (text) =>
          !/\b(?:AUD|CAD|EUR|GBP|NZD)\b/i.test(text) &&
          hasUsdMarker(text) &&
          /(?:\/\s*(?:yr|year|hr|hour)|per\s+(?:year|hour)|annually|hourly)/i.test(
            text,
          ),
      )
      .sort((a, b) => a.length - b.length)[0];
    if (!salaryText) return undefined;

    const values = Array.from(
      salaryText.matchAll(
        /(?:\bUSD\s*\$?|\bUS\$|(?<![A-Za-z])\$)\s*([\d,.]+)\s*([kK])?/gi,
      ),
    )
      .map((match) => {
        const parsed = Number((match[1] ?? '').replace(/,/g, ''));
        return Number.isFinite(parsed)
          ? parsed * (match[2]?.toLowerCase() === 'k' ? 1000 : 1)
          : undefined;
      })
      .filter((value): value is number => value !== undefined);
    const min = values[0];
    if (min === undefined) return undefined;

    const type = /(?:\/\s*(?:hr|hour)|per\s+hour|hourly)/i.test(salaryText)
      ? 'hourly'
      : 'annual';
    return {
      text: salaryText,
      type,
      min,
      max: values[1] ?? min,
    };
  }

  function linkedinLocationScore(text: string): number {
    const normalized = text.toLowerCase();
    if (
      /\b(ago|applicant|reposted|promoted|viewed|connections?)\b/.test(
        normalized,
      )
    ) {
      return 0;
    }

    let score = 0;
    if (
      /^(united states|canada|north america|european union|united kingdom)$/i.test(
        text,
      )
    ) {
      score = 2;
    }
    if (/\b(remote|hybrid|on-site|onsite)\b/.test(normalized)) score = 3;
    if (/\b(area|region|district|metro|metropolitan)\b/.test(normalized)) {
      score = 4;
    }
    if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+\b/.test(text)) {
      score = 5;
    }
    if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(text)) score = 6;
    if (/[·|]/.test(text)) score -= 2;
    if (text.length > 120) score -= 2;
    return Math.max(score, 0);
  }

  function findLinkedinLocation(): Element | undefined {
    const lazyColumn = findLastLinkedinLazyColumn();
    if (!lazyColumn) return undefined;

    for (const paragraph of Array.from(lazyColumn.querySelectorAll('p'))) {
      const paragraphText = textOf(paragraph);
      if (!paragraphText || !/[·|]/.test(paragraphText)) continue;
      if (
        !/\b(ago|applicant|apply|clicked|reposted|promoted|viewed)\b/i.test(
          paragraphText,
        )
      ) {
        continue;
      }

      const firstSpan = Array.from(paragraph.querySelectorAll('span')).find(
        (span) => {
          const text = textOf(span);
          return text ? linkedinLocationScore(text) > 0 : false;
        },
      );
      if (firstSpan) return firstSpan;
    }

    const candidates = Array.from(lazyColumn.querySelectorAll('p, span'))
      .map((el, index) => {
        const text = textOf(el);
        return {
          el,
          index,
          score: text ? linkedinLocationScore(text) : 0,
        };
      })
      .filter((candidate) => candidate.score > 0);

    candidates.sort((a, b) => b.score - a.score || b.index - a.index);
    return candidates[0]?.el;
  }

  function headingLevel(el: Element): number | undefined {
    const match = /^H([1-6])$/.exec(el.tagName);
    return match?.[1] ? Number(match[1]) : undefined;
  }

  function isLinkedinCompanyInsightsUpsellLink(href: string | null): boolean {
    if (!href) return false;
    try {
      const url = new URL(href, document.baseURI);
      const trackingValues = [
        url.searchParams.get('upsellOrderOrigin'),
        url.searchParams.get('upsellSlotId'),
      ];
      return (
        /(^|\.)linkedin\.com$/i.test(url.hostname) &&
        url.pathname.startsWith('/premium/') &&
        trackingValues.some((value) =>
          value?.toLowerCase().includes('jdp_aiq_company_insights'),
        )
      );
    } catch {
      return false;
    }
  }

  function hasLinkedinCompanyInsightsCardStructure(
    candidate: Element,
  ): boolean {
    if (!/^(ASIDE|ARTICLE|DIV|SECTION)$/.test(candidate.tagName)) return false;

    const directChildren = Array.from(candidate.children);
    const paragraphCount = directChildren.filter(
      (child) => child.tagName === 'P',
    ).length;
    const hasInsightSkeleton = directChildren
      .filter((child) => /^(OL|UL)$/.test(child.tagName))
      .some((list) => {
        const items = Array.from(list.children).filter(
          (child) => child.tagName === 'LI',
        );
        return (
          items.length >= 3 &&
          items.every((item) => !(item.textContent ?? '').trim())
        );
      });

    return paragraphCount >= 3 && hasInsightSkeleton;
  }

  // LinkedIn inserts this card inside the bounded About-the-job range without
  // a heading of its own. Keep this cleanup provider-local, and require both
  // its tracked CTA and observed direct-child structure before removing the
  // nearest card. A CTA inside a general description wrapper is left intact.
  function removeLinkedinCompanyInsightsUpsell(root: ParentNode): void {
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!isLinkedinCompanyInsightsUpsellLink(link.getAttribute('href'))) {
        continue;
      }

      let candidate = link.parentElement;
      while (candidate) {
        if (hasLinkedinCompanyInsightsCardStructure(candidate)) {
          candidate.remove();
          break;
        }
        if (candidate.parentNode === root) break;
        candidate = candidate.parentElement;
      }
    }
  }

  // LinkedIn can render the "About the job" heading inside a broad details
  // container that also includes adjacent sections. Read text after the
  // heading in document order, stopping at the next same-or-higher-level
  // heading, so neighboring sections do not leak into job_description.
  function descriptionMarkdownAfterHeading(
    heading: Element,
  ): string | undefined {
    const startLevel = headingLevel(heading) ?? 2;
    const scope =
      findLastLinkedinLazyColumn() ??
      heading.closest('article, section, main') ??
      heading.parentElement;
    let fallbackMarkdown: string | undefined;

    for (
      let boundary = heading.parentElement;
      boundary && boundary !== document.body.parentElement;
      boundary = boundary.parentElement
    ) {
      const stopHeading = Array.from(
        boundary.querySelectorAll('h1, h2, h3, h4, h5, h6'),
      ).find(
        (candidate) =>
          candidate !== heading &&
          Boolean(
            heading.compareDocumentPosition(candidate) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ) &&
          (headingLevel(candidate) ?? 7) <= startLevel,
      );

      const range = document.createRange();
      range.setStartAfter(heading);
      if (stopHeading) {
        range.setEndBefore(stopHeading);
      } else {
        range.setEnd(boundary, boundary.childNodes.length);
      }

      const descriptionFragment = range.cloneContents();
      removeLinkedinCompanyInsightsUpsell(descriptionFragment);
      const markdown = htmlToSafeMarkdown(descriptionFragment);
      if (markdown) fallbackMarkdown = markdown;
      if (stopHeading && markdown) return markdown;
      if (boundary === scope) break;
    }
    return fallbackMarkdown;
  }

  async function extractLinkedinDom(): Promise<void> {
    const { company, title } = parseLinkedinPageTitle(document.title);
    // Both fields come from an unambiguous pipe-delimited split, so both
    // are as trustworthy as any other platform's dom-sourced high-confidence
    // candidate.
    addCandidate('company_name', company, 'dom', 'high');
    addCandidate('job_title', title, 'dom', 'high');

    // Secondary signal for company_name: the employer's own profile link is
    // the only stable, hash-free DOM selector on LinkedIn's job pages, and
    // covers cases where <title> doesn't follow the pipe-delimited pattern
    // (e.g. a split-view search results page that hasn't navigated to a
    // dedicated job URL). Scope it to the selected lazy column so search
    // result cards do not leak into the active job. job_location and
    // job_description have no page-title source at all, so their DOM
    // selectors (rendered after the SPA hydrates) are the only signal
    // available -- wait on all three together in one observer.
    const [companyEl, locationEl, descriptionEl] = await waitForEach(
      [findLinkedinCompany, findLinkedinLocation, findAboutTheJobHeading],
      800,
    );
    addCandidate('company_name', textOf(companyEl), 'dom', 'high');
    addCandidate('job_location', textOf(locationEl), 'dom', 'medium');
    const description = descriptionEl
      ? descriptionMarkdownAfterHeading(descriptionEl)
      : undefined;
    addCandidate('job_description', description, 'dom', 'high');

    const selectedPane = findLastLinkedinLazyColumn();
    if (!selectedPane) return;

    const compactTexts = linkedinCompactTexts(selectedPane, descriptionEl);
    addCandidate('job_type', mapLinkedinJobType(compactTexts), 'dom', 'high');
    addCandidate(
      'is_remote',
      detectLinkedinRemote(compactTexts),
      'dom',
      'high',
    );

    const structuredExperience = mapLinkedinExperienceLevel(compactTexts);
    addCandidate('experience_level', structuredExperience, 'dom', 'high');
    if (!structuredExperience) {
      addCandidate(
        'experience_level',
        inferExperienceFromTitle(
          title ?? textOf(selectedPane.querySelector('h1')),
        ),
        'dom',
        'medium',
      );
    }

    addCandidate(
      'security_clearance_req',
      detectClearanceRequirement(description),
      'dom',
      'medium',
    );

    const salary = parseLinkedinSalary(compactTexts);
    if (salary) {
      addCandidate('salary_text', salary.text, 'dom', 'high');
      addCandidate('salary_type', salary.type, 'dom', 'high');
      if (salary.type === 'annual') {
        addCandidate('salary_min', Math.round(salary.min * 100), 'dom', 'high');
        addCandidate('salary_max', Math.round(salary.max * 100), 'dom', 'high');
      } else {
        addCandidate('hourly_rate_min', salary.min, 'dom', 'high');
        addCandidate('hourly_rate_max', salary.max, 'dom', 'high');
      }
    }
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
        (() => {
          const description = container.querySelector(
            'section, [role="article"]',
          );
          return description ? elementToSafeMarkdown(description) : undefined;
        })(),
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
      addCandidate(
        'job_description',
        htmlToSafeMarkdown(description),
        'jsonld',
        'high',
      );
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
  addCandidate(
    'job_description',
    metaDescription ? plainTextToSafeMarkdown(metaDescription) : undefined,
    'meta',
    'medium',
  );

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
    detection.externalJobId ?? inferExternalId(href, titleForId),
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
    linkedin: extractLinkedinDom,
    indeed: extractIndeedDom,
    glassdoor: extractGlassdoorDom,
    dice: extractDiceDom,
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
  addCandidate(
    'job_description',
    bodyText ? plainTextToSafeMarkdown(bodyText) : undefined,
    'visible-text',
    'low',
  );

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
