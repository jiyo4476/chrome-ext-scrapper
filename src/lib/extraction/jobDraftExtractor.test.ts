// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJobDraft } from './jobDraftExtractor';

function setHead(html: string): void {
  document.head.innerHTML = html;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function setLocation(url: string): void {
  vi.stubGlobal('location', new URL(url));
}

const OTHER = { platform: 'other' as const, confidence: 'low' as const };

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('extractJobDraft — JSON-LD source', () => {
  it('extracts fields from a JobPosting JSON-LD block', async () => {
    setHead(`
      <title>Data Engineer - Data Co</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Data Engineer",
          "hiringOrganization": { "@type": "Organization", "name": "Data Co" },
          "datePosted": "2026-07-01",
          "description": "<p>Build <strong>data</strong> pipelines.</p>",
          "url": "https://example.com/jobs/data-engineer",
          "identifier": { "@type": "PropertyValue", "value": "job-42" },
          "employmentType": "FULL_TIME",
          "jobLocation": {
            "@type": "Place",
            "address": { "addressLocality": "Austin", "addressRegion": "TX" }
          }
        }
      </script>
    `);
    setBody('<main><h1>Data Engineer</h1></main>');

    const { draft, candidates } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('Data Engineer');
    expect(draft.company_name).toBe('Data Co');
    expect(draft.date_posted).toBe('2026-07-01');
    expect(draft.job_description).toBe('Build data pipelines.');
    expect(draft.job_link).toBe('https://example.com/jobs/data-engineer');
    expect(draft.external_job_id).toBe('job-42');
    expect(draft.job_type).toBe('full_time');
    expect(draft.job_location).toBe('Austin, TX');
    expect(draft.extraction_confidence?.job_title).toBe('high');
    expect(draft.extraction_confidence?.company_name).toBe('high');

    // job_title only has a single jsonld candidate here (h1 text matches
    // exactly, so it collapses to one distinct value) -- no picker needed.
    expect(candidates.company_name).toBeUndefined();
  });

  it('marks TELECOMMUTE jobLocationType as remote', async () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Remote Engineer",
          "jobLocationType": "TELECOMMUTE"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.is_remote).toBe(true);
  });

  it('finds a JobPosting nested inside @graph', async () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebPage", "name": "Careers" },
            { "@type": "JobPosting", "title": "Graph Engineer" }
          ]
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.job_title).toBe('Graph Engineer');
  });

  it('picks the richest JobPosting when multiple are present', async () => {
    setHead(`
      <script type="application/ld+json">
        { "@type": "JobPosting", "title": "Thin Posting" }
      </script>
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Rich Posting",
          "hiringOrganization": { "@type": "Organization", "name": "Rich Co" },
          "description": "Full description here.",
          "datePosted": "2026-07-01"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('Rich Posting');
    expect(draft.company_name).toBe('Rich Co');
  });

  it('resolves a relative JSON-LD url against the page location', async () => {
    setLocation('https://example.com/jobs/data-engineer');
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "url": "/jobs/data-engineer"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.job_link).toBe('https://example.com/jobs/data-engineer');
  });
});

describe('extractJobDraft — salary handling', () => {
  it('converts an annual salary range to integer cents', async () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "baseSalary": {
            "@type": "MonetaryAmount",
            "currency": "USD",
            "value": {
              "@type": "QuantitativeValue",
              "minValue": 100000,
              "maxValue": 150000,
              "unitText": "YEAR"
            }
          }
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.salary_type).toBe('annual');
    expect(draft.salary_min).toBe(10_000_000);
    expect(draft.salary_max).toBe(15_000_000);
  });

  it('passes hourly rates through without conversion', async () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Contractor",
          "baseSalary": {
            "@type": "MonetaryAmount",
            "currency": "USD",
            "value": {
              "@type": "QuantitativeValue",
              "minValue": 45.5,
              "maxValue": 60,
              "unitText": "HOUR"
            }
          }
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.salary_type).toBe('hourly');
    expect(draft.hourly_rate_min).toBe(45.5);
    expect(draft.hourly_rate_max).toBe(60);
  });
});

describe('extractJobDraft — employmentType mapping', () => {
  it.each([
    ['FULL_TIME', 'full_time'],
    ['PART_TIME', 'part_time'],
    ['CONTRACTOR', 'contract'],
    ['INTERN', 'internship'],
    ['TEMPORARY', 'temp'],
  ])('maps schema.org %s to %s', async (schemaValue, expected) => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "employmentType": "${schemaValue}"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.job_type).toBe(expected);
  });

  it('omits unknown employmentType values', async () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "employmentType": "PER_DIEM"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);
    expect(draft.job_type).toBeUndefined();
  });
});

describe('extractJobDraft — OpenGraph fallback', () => {
  it('extracts from meta tags when no JSON-LD is present', async () => {
    setHead(`
      <meta property="og:title" content="Platform Engineer" />
      <meta name="description" content="Own our deployment platform." />
      <meta property="og:url" content="https://example.com/jobs/platform-engineer" />
    `);

    const { draft, candidates } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('Platform Engineer');
    expect(draft.job_description).toBe('Own our deployment platform.');
    expect(draft.extraction_confidence?.job_title).toBe('medium');
    expect(candidates.job_title).toBeUndefined();
  });

  it('does not use og:site_name as company_name on a known job board', async () => {
    setHead(`
      <meta property="og:title" content="Software Engineer" />
      <meta property="og:site_name" content="Indeed" />
    `);

    // Use a job-board platform with no dom-extraction block (linkedin) so
    // this test isn't incidentally taxed by another platform's dynamic-wait
    // timeout -- the guard itself is platform-agnostic across the whole
    // JOB_BOARD_PLATFORMS set, which is exercised more broadly below.
    const { draft } = await extractJobDraft({
      platform: 'linkedin',
      confidence: 'high',
    });

    expect(draft.company_name).not.toBe('Indeed');
  });

  it.each([
    'linkedin',
    'indeed',
    'glassdoor',
    'dice',
    'lever',
    'greenhouse',
    'workday',
    'angellist',
    'google',
  ] as const)(
    'does not use og:site_name as company_name for platform %s',
    async (platform) => {
      setHead('<meta property="og:site_name" content="Should Not Be Used" />');

      // Some platforms (indeed/glassdoor/google) run a dom-extraction block
      // that waits on a MutationObserver+timeout before giving up -- fake
      // the timers so this parametrized case doesn't pay real wall-clock
      // cost for platforms that have nothing to find. A no-op for
      // platforms with no wait block.
      vi.useFakeTimers();
      const pending = extractJobDraft({ platform, confidence: 'high' });
      await vi.advanceTimersByTimeAsync(1800);
      const { draft } = await pending;

      expect(draft.company_name).not.toBe('Should Not Be Used');
    },
  );

  it('uses og:site_name as company_name on an unrecognized site', async () => {
    setHead(`
      <meta property="og:title" content="Software Engineer" />
      <meta property="og:site_name" content="Acme Careers" />
    `);

    const { draft } = await extractJobDraft(OTHER);

    expect(draft.company_name).toBe('Acme Careers');
  });
});

describe('extractJobDraft — visible-text fallback', () => {
  it('falls back to h1 and page body text when nothing else is present', async () => {
    setBody(`
      <main>
        <h1>Fallback Title</h1>
        <p>This role has no structured data at all, just plain text.</p>
      </main>
    `);

    const { draft } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('Fallback Title');
    expect(draft.job_description).toContain(
      'This role has no structured data at all, just plain text.',
    );
    expect(draft.extraction_confidence?.job_title).toBe('low');
  });
});

describe('extractJobDraft — candidate review mode', () => {
  it('produces two title candidates when JSON-LD and meta tags disagree', async () => {
    setHead(`
      <script type="application/ld+json">
        { "@type": "JobPosting", "title": "JSON-LD Title" }
      </script>
      <meta property="og:title" content="Meta Title" />
    `);

    const { draft, candidates } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('JSON-LD Title');
    expect(candidates.job_title).toHaveLength(2);
    expect(candidates.job_title?.map((c) => c.source).sort()).toEqual([
      'jsonld',
      'meta',
    ]);
    expect(candidates.job_title).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'JSON-LD Title',
          source: 'jsonld',
          confidence: 'high',
        }),
        expect.objectContaining({
          value: 'Meta Title',
          source: 'meta',
          confidence: 'medium',
        }),
      ]),
    );
  });
});

describe('extractJobDraft — Indeed DOM extraction', () => {
  const INDEED = { platform: 'indeed' as const, confidence: 'high' as const };

  it('extracts title, company, location, and description from Indeed selectors', async () => {
    setBody(`
      <h1 class="jobsearch-JobInfoHeader-title">Backend Engineer</h1>
      <div data-testid="inlineHeader-companyName">Acme Corp</div>
      <div data-testid="inlineHeader-companyLocation">Austin, TX</div>
      <div id="jobDescriptionText">Build backend services.</div>
    `);

    const { draft, candidates } = await extractJobDraft(INDEED);

    expect(draft.job_title).toBe('Backend Engineer');
    expect(draft.company_name).toBe('Acme Corp');
    expect(draft.job_location).toBe('Austin, TX');
    expect(draft.job_description).toBe('Build backend services.');
    expect(candidates.job_title).toBeUndefined();
  });

  it('prefers the dom-sourced title over a competing meta title', async () => {
    setHead('<meta property="og:title" content="Wrong Title" />');
    setBody(`
      <h1 class="jobsearch-JobInfoHeader-title">Correct Title</h1>
      <div id="jobDescriptionText">Description.</div>
    `);

    const { draft, candidates } = await extractJobDraft(INDEED);

    expect(draft.job_title).toBe('Correct Title');
    // The h1 is also picked up by the generic visible-text fallback (same
    // value as the dom candidate), alongside the competing meta value.
    expect(candidates.job_title?.map((c) => c.source).sort()).toEqual([
      'dom',
      'meta',
      'visible-text',
    ]);
  });

  it('resolves the Indeed title after it appears asynchronously', async () => {
    setBody('<div id="jobDescriptionText">Description.</div>');

    const pending = extractJobDraft(INDEED);
    setTimeout(() => {
      setBody(
        document.body.innerHTML +
          '<h1 class="jobsearch-JobInfoHeader-title">Late Title</h1>',
      );
    }, 0);

    const { draft } = await pending;
    expect(draft.job_title).toBe('Late Title');
  });

  it('falls back to no dom title candidate when nothing appears before the timeout', async () => {
    setBody('<div id="jobDescriptionText">Description only.</div>');

    vi.useFakeTimers();
    const pending = extractJobDraft(INDEED);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.job_description).toBe('Description only.');
    expect(draft.job_title).toBeUndefined();
  });
});

describe('extractJobDraft — Glassdoor DOM extraction', () => {
  const GLASSDOOR = {
    platform: 'glassdoor' as const,
    confidence: 'high' as const,
  };

  it('extracts title, company, location, and description from Glassdoor selectors', async () => {
    setBody(`
      <h1 data-test="job-title">Frontend Developer</h1>
      <div data-test="employer-name">Example Labs</div>
      <div data-test="location">Remote</div>
      <div data-test="jobDescriptionContent">Own our UI.</div>
    `);

    const { draft } = await extractJobDraft(GLASSDOOR);

    expect(draft.job_title).toBe('Frontend Developer');
    expect(draft.company_name).toBe('Example Labs');
    expect(draft.job_location).toBe('Remote');
    expect(draft.job_description).toBe('Own our UI.');
  });

  it('extracts a partial draft when only some Glassdoor selectors are present', async () => {
    setBody('<h1 data-test="job-title">Frontend Developer</h1>');

    const { draft } = await extractJobDraft(GLASSDOOR);

    expect(draft.job_title).toBe('Frontend Developer');
    expect(draft.company_name).toBeUndefined();
  });
});

describe('extractJobDraft — Google Jobs DOM extraction', () => {
  const GOOGLE = { platform: 'google' as const, confidence: 'high' as const };

  it('extracts the selected job title, company, and description via ARIA structure', async () => {
    setBody(`
      <div>
        <div role="heading" aria-level="2">Product Engineer</div>
        <div>Northstar Apps</div>
        <section>Build delightful product experiences.</section>
      </div>
    `);

    const { draft } = await extractJobDraft(GOOGLE);

    expect(draft.job_title).toBe('Product Engineer');
    expect(draft.company_name).toBe('Northstar Apps');
    expect(draft.job_description).toBe('Build delightful product experiences.');
  });

  it('prefers the aria-selected job card over the first card in a multi-result list', async () => {
    setBody(`
      <div>
        <div role="heading" aria-level="2">First Listed Job</div>
        <div>Wrong Co</div>
      </div>
      <div aria-selected="true">
        <div role="heading" aria-level="2">Actually Selected Job</div>
        <div>Correct Co</div>
        <section>The job the user opened.</section>
      </div>
    `);

    const { draft } = await extractJobDraft(GOOGLE);

    expect(draft.job_title).toBe('Actually Selected Job');
    expect(draft.company_name).toBe('Correct Co');
  });

  it('does not fabricate a description candidate when no bounded container exists', async () => {
    setBody(`
      <span>
        <span role="heading" aria-level="2">Product Engineer</span>
        <span>Northstar Apps</span>
      </span>
      <section>Unrelated footer legal disclaimer text, not a job description.</section>
    `);

    const { draft } = await extractJobDraft(GOOGLE);

    expect(draft.job_title).toBe('Product Engineer');
    expect(draft.job_description).not.toBe(
      'Unrelated footer legal disclaimer text, not a job description.',
    );
  });

  it('does not extract a dom title when no ARIA heading appears before the timeout', async () => {
    setBody('<div>No structured job panel here.</div>');

    vi.useFakeTimers();
    const pending = extractJobDraft(GOOGLE);
    await vi.advanceTimersByTimeAsync(1800);
    const { draft } = await pending;

    expect(draft.job_title).toBeUndefined();
  });
});
