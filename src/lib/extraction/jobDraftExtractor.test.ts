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

  it('prefers the JobPosting whose own url matches the current page over a richer but unrelated block', async () => {
    setLocation('https://example.com/jobs/thin-posting');
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Thin Posting",
          "url": "https://example.com/jobs/thin-posting"
        }
      </script>
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Unrelated Recommended Job",
          "hiringOrganization": { "@type": "Organization", "name": "Other Co" },
          "description": "A completely different job from a related-jobs widget.",
          "datePosted": "2026-07-01",
          "url": "https://example.com/jobs/unrelated"
        }
      </script>
    `);

    const { draft } = await extractJobDraft(OTHER);

    expect(draft.job_title).toBe('Thin Posting');
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

    // Use a job-board platform with no dom-extraction block (dice) so this
    // test isn't incidentally taxed by another platform's dynamic-wait
    // timeout -- the guard itself is platform-agnostic across the whole
    // JOB_BOARD_PLATFORMS set, which is exercised more broadly below.
    const { draft } = await extractJobDraft({
      platform: 'dice',
      confidence: 'high',
    });

    expect(draft.company_name).not.toBe('Indeed');
  });

  it.each([
    'linkedin',
    'indeed',
    'glassdoor',
    'dice',
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

  it.each(['lever', 'greenhouse', 'workday'] as const)(
    "uses og:site_name as company_name for platform %s (white-labeled ATS embeds carry the employer's own brand there)",
    async (platform) => {
      setHead('<meta property="og:site_name" content="Acme Corp" />');

      const { draft } = await extractJobDraft({ platform, confidence: 'high' });

      expect(draft.company_name).toBe('Acme Corp');
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

describe('extractJobDraft — source_platform', () => {
  it('sets source_platform and its confidence directly from the detection argument', async () => {
    const { draft } = await extractJobDraft({
      platform: 'dice',
      confidence: 'low',
    });

    expect(draft.source_platform).toBe('dice');
    expect(draft.extraction_confidence?.source_platform).toBe('low');
  });
});

describe('extractJobDraft — merge priority', () => {
  it('prefers a dom-sourced value over an equal-confidence jsonld value (stale JSON-LD from a prior SPA view should not win)', async () => {
    setHead(`
      <script type="application/ld+json">
        { "@type": "JobPosting", "title": "Stale JSON-LD Title" }
      </script>
    `);
    setBody(`
      <h1 class="jobsearch-JobInfoHeader-title">Fresh DOM Title</h1>
      <div id="jobDescriptionText">Fresh description.</div>
    `);

    const { draft, candidates } = await extractJobDraft({
      platform: 'indeed',
      confidence: 'high',
    });

    expect(draft.job_title).toBe('Fresh DOM Title');
    // The h1 is also picked up by the generic visible-text fallback (same
    // value as the dom candidate), alongside the stale jsonld value.
    expect(candidates.job_title?.map((c) => c.source).sort()).toEqual([
      'dom',
      'jsonld',
      'visible-text',
    ]);
  });
});

describe('extractJobDraft — LinkedIn DOM extraction', () => {
  const LINKEDIN = {
    platform: 'linkedin' as const,
    confidence: 'high' as const,
  };

  // None of these set the company profile-link anchor, location column, or
  // "About the job" section, so the secondary waitForEach call always runs
  // out its full timeout -- use fake timers to avoid paying that 800ms in
  // real wall-clock time per test.

  it('extracts job_title and company_name from the pipe-delimited page title', async () => {
    document.title = 'Senior Software Engineer | Acme Corp | LinkedIn';

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.job_title).toBe('Senior Software Engineer');
    expect(draft.company_name).toBe('Acme Corp');
  });

  it('strips a leading unread-notification badge from the page title', async () => {
    document.title = '(3) Senior Software Engineer | Acme Corp | LinkedIn';

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.job_title).toBe('Senior Software Engineer');
    expect(draft.company_name).toBe('Acme Corp');
  });

  it('adds no page-title candidate when the title has fewer than 3 pipe-delimited segments', async () => {
    document.title = 'Software Engineer jobs in United States | LinkedIn';
    setBody('<h1>Software Engineer jobs in United States</h1>');

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.company_name).toBeUndefined();
  });

  it('adds no page-title candidate when the last segment is not "LinkedIn"', async () => {
    document.title = 'Senior Software Engineer | Acme Corp | Careers';

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.company_name).toBeUndefined();
    expect(draft.job_title).toBeUndefined();
  });

  it('extracts company_name from the employer profile link', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <div data-testid="lazy-column">
        <a href="https://www.linkedin.com/company/acme-corp/life">Acme Corp</a>
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.company_name).toBe('Acme Corp');
    expect(draft.job_location).toBe('Austin, TX');
  });

  it('extracts LinkedIn company_name from the selected last lazy column', async () => {
    document.title = 'Software Engineer jobs in United States | LinkedIn';
    setBody(`
      <h1>Software Engineer jobs in United States</h1>
      <div data-testid="lazy-column">
        <a href="https://www.linkedin.com/company/wrong-company/">Wrong Company</a>
        <p><span>San Francisco Bay Area</span></p>
      </div>
      <div data-testid="lazy-column">
        <a href="https://www.linkedin.com/company/acme-corp/life">Acme Corp</a>
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.company_name).toBe('Acme Corp');
  });

  it('resolves the company link after it appears asynchronously', async () => {
    setBody('<h1>Senior Software Engineer</h1>');

    const pending = extractJobDraft(LINKEDIN);
    setTimeout(() => {
      // Also populate the location column and description section in the
      // same tick -- otherwise those still-pending groups would hold this
      // waitForEach call open for its full real 800ms timeout before
      // resolving.
      setBody(
        document.body.innerHTML +
          '<div data-testid="lazy-column"><a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a><p><span>Austin, TX</span></p><div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div></div>',
      );
    }, 0);

    const { draft } = await pending;
    expect(draft.company_name).toBe('Acme Corp');
    expect(draft.job_location).toBe('Austin, TX');
  });

  it('falls back to no dom company_name candidate when the link never appears', async () => {
    setBody('<h1>Senior Software Engineer</h1>');

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.company_name).toBeUndefined();
  });

  it('extracts job_location from the lazy-loaded detail column', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('Austin, TX');
  });

  it('extracts LinkedIn job_location from the location paragraph instead of preceding metadata', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Posted 2 weeks ago</span></p>
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('Austin, TX');
  });

  it('extracts LinkedIn job_location from the last lazy column', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>San Francisco Bay Area</span></p>
      </div>
      <div data-testid="lazy-column">
        <p><span>Posted 2 weeks ago</span></p>
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('Austin, TX');
  });

  it('prefers the specific LinkedIn location when the paragraph above also looks location-like', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>San Francisco Bay Area</span></p>
        <p><span>Austin, TX</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('Austin, TX');
  });

  it('extracts LinkedIn job_location for non-comma region formats', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Over 100 applicants</span></p>
        <p><span>New York City Metropolitan Area</span></p>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('New York City Metropolitan Area');
  });

  it('extracts LinkedIn job_location from the first span in the metadata row instead of the remote chip', async () => {
    setBody(`
      <h1>Software Developer</h1>
      <a href="https://www.linkedin.com/company/intelex-technologies-ulc/life/">Intelex Technologies ULC</a>
      <div data-testid="lazy-column">
        <p>
          <a href="https://www.linkedin.com/jobs/view/4402229024/">Software Developer</a>
        </p>
        <p>
          <span>United States</span>
          <span> </span>·<span> </span>
          <span><strong>Reposted 13 hours ago</strong></span>
          <span> </span>·<span> </span>
          <span>Over 100 people clicked apply</span>
        </p>
        <a href="/jobs/search-results/?keywords=remote"><span>Remote</span></a>
        <a href="/jobs/search-results/?keywords=full-time"><span>Full-time</span></a>
        <div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_location).toBe('United States');
  });

  it('resolves job_location after the detail column appears asynchronously', async () => {
    setBody('<h1>Senior Software Engineer</h1>');

    const pending = extractJobDraft(LINKEDIN);
    setTimeout(() => {
      // Also populate the company anchor and description section in the
      // same tick -- otherwise those still-pending groups would hold this
      // waitForEach call open for its full real 800ms timeout before
      // resolving.
      setBody(
        document.body.innerHTML +
          '<a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>' +
          '<div data-testid="lazy-column"><p><span>Remote</span></p><div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div></div>',
      );
    }, 0);

    const { draft } = await pending;
    expect(draft.job_location).toBe('Remote');
  });

  it('falls back to no dom job_location candidate when the detail column never appears', async () => {
    setBody('<h1>Senior Software Engineer</h1>');

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.job_location).toBeUndefined();
  });

  it('extracts job_description from the "About the job" section, excluding the heading text', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Austin, TX</span></p>
        <div class="jobs-description">
          <h2>About the job</h2>
          <p>Build great products for millions of members.</p>
        </div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_description).toBe(
      'Build great products for millions of members.',
    );
    expect(draft.job_description).not.toContain('About the job');
  });

  it('stops LinkedIn job_description before the next peer section heading', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Austin, TX</span></p>
        <div class="jobs-details">
        <h2>About the job</h2>
        <p>Build reliable product systems.</p>
        <h3>Responsibilities</h3>
        <p>Own backend services.</p>
        <h2>About the company</h2>
        <p>Acme was founded in 2005.</p>
        </div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_description).toBe(
      'Build reliable product systems. Responsibilities Own backend services.',
    );
    expect(draft.job_description).not.toContain('About the company');
    expect(draft.job_description).not.toContain('Acme was founded');
  });

  it('extracts LinkedIn job_description when the heading is wrapped separately from the body', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column">
        <p><span>Austin, TX</span></p>
        <div class="jobs-details">
          <div class="heading-wrapper"><h2>About the job</h2></div>
          <div><p>Build reliable product systems.</p></div>
          <h2>About the company</h2>
          <p>Acme was founded in 2005.</p>
        </div>
      </div>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_description).toBe('Build reliable product systems.');
  });

  it('extracts LinkedIn job_description from a search split-view details pane only', async () => {
    document.title = 'Software Engineer jobs in United States | LinkedIn';
    setBody(`
      <main>
        <ul class="jobs-search-results-list">
          <li>
            <h3>Software Engineer</h3>
            <p>Search result card teaser that should not be scraped.</p>
          </li>
        </ul>
        <section class="jobs-search__job-details">
          <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
          <div data-testid="lazy-column">
            <p><span>San Francisco Bay Area</span></p>
            <article class="jobs-description">
              <h2>About the job</h2>
              <p>Earlier lazy-column description that should not be scraped.</p>
            </article>
          </div>
          <div data-testid="lazy-column">
            <p><span>Austin, TX</span></p>
            <article class="jobs-description">
              <div><h2>About the job</h2></div>
              <div>
                <p>Build reliable product systems.</p>
                <h3>What you will do</h3>
                <p>Improve the selected job workflow.</p>
              </div>
              <h2>About the company</h2>
              <p>Company profile text should not be scraped.</p>
            </article>
          </div>
        </section>
        <aside>
          <h2>Similar jobs</h2>
          <p>Another posting description that should not be scraped.</p>
        </aside>
      </main>
    `);

    const { draft } = await extractJobDraft(LINKEDIN);

    expect(draft.job_description).toBe(
      'Build reliable product systems. What you will do Improve the selected job workflow.',
    );
    expect(draft.job_location).toBe('Austin, TX');
    expect(draft.job_description).not.toContain('Search result card teaser');
    expect(draft.job_description).not.toContain('Earlier lazy-column');
    expect(draft.job_description).not.toContain('Company profile text');
    expect(draft.job_description).not.toContain('Another posting description');
  });

  it('resolves job_description after the section appears asynchronously', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column"><p><span>Austin, TX</span></p></div>
    `);

    const pending = extractJobDraft(LINKEDIN);
    setTimeout(() => {
      setBody(
        document.body.innerHTML.replace(
          '</div>',
          '<div class="jobs-description"><h2>About the job</h2><p>Build great things.</p></div></div>',
        ),
      );
    }, 0);

    const { draft } = await pending;
    expect(draft.job_description).toBe('Build great things.');
  });

  it('falls back to no dom job_description candidate when no "About the job" heading appears', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column"><p><span>Austin, TX</span></p></div>
    `);

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    // The generic low-confidence visible-text fallback still fills
    // job_description from the whole body -- what matters here is that no
    // high-confidence 'dom' candidate was fabricated to win over it.
    expect(draft.extraction_confidence?.job_description).not.toBe('high');
  });

  it('ignores an unrelated heading like "About the company"', async () => {
    setBody(`
      <h1>Senior Software Engineer</h1>
      <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
      <div data-testid="lazy-column"><p><span>Austin, TX</span></p></div>
      <div class="jobs-about-company"><h2>About the company</h2><p>Founded in 2005.</p></div>
    `);

    vi.useFakeTimers();
    const pending = extractJobDraft(LINKEDIN);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    // The generic low-confidence visible-text fallback picks up the whole
    // page body (including this unrelated section), which is expected --
    // what this test guards is that the DOM extractor itself didn't treat
    // "About the company" as a match for "About the job".
    expect(draft.extraction_confidence?.job_description).not.toBe('high');
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

    vi.useFakeTimers();
    const pending = extractJobDraft(GLASSDOOR);
    await vi.advanceTimersByTimeAsync(800);
    const { draft } = await pending;

    expect(draft.job_title).toBe('Frontend Developer');
    expect(draft.company_name).toBeUndefined();
  });
});

describe('extractJobDraft — Dice DOM extraction', () => {
  const DICE = { platform: 'dice' as const, confidence: 'high' as const };

  it('extracts a Dice detail page within the matching job container', async () => {
    window.history.replaceState(
      {},
      '',
      '/job-detail/123e4567-e89b-12d3-a456-426614174000',
    );
    document.body.innerHTML = `
      <main>
        <a href="/job-detail/123e4567-e89b-12d3-a456-426614174000">
          <h1>Senior Software Engineer</h1>
        </a>
        <a href="/company-profile/acme">Acme Corp</a>
        <p data-testid="job-location">Denver, Colorado</p>
        <section data-testid="job-description">Build secure browser tooling.</section>
      </main>
    `;

    const { draft } = await extractJobDraft(DICE);

    expect(draft).toMatchObject({
      source_platform: 'dice',
      external_job_id: '123e4567-e89b-12d3-a456-426614174000',
      company_name: 'Acme Corp',
      job_title: 'Senior Software Engineer',
      job_location: 'Denver, Colorado',
      job_description: 'Build secure browser tooling.',
    });
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

  it('prefers the scoped dom description over a generic page-level meta description', async () => {
    setHead(
      '<meta name="description" content="Search results for Software Engineer jobs" />',
    );
    setBody(`
      <div>
        <div role="heading" aria-level="2">Product Engineer</div>
        <div>Northstar Apps</div>
        <section>Build delightful product experiences.</section>
      </div>
    `);

    const { draft } = await extractJobDraft(GOOGLE);

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
    expect(draft.job_description).toBe('The job the user opened.');
  });

  it('picks up selection state applied to an existing card via attribute mutation, not just element insertion', async () => {
    setBody(`
      <div>
        <div role="heading" aria-level="2">First Listed Job</div>
        <div>Wrong Co</div>
      </div>
      <div>
        <div role="heading" aria-level="2">Actually Selected Job</div>
        <div>Correct Co</div>
        <section>The job the user opened.</section>
      </div>
    `);
    const secondCard = document.body.children[1];
    if (!secondCard) throw new Error('expected a second card in the fixture');

    const pending = extractJobDraft(GOOGLE);
    // Some SPAs mark the active card by toggling an attribute on an
    // already-mounted node rather than inserting new elements -- the
    // observer must react to this, not just to childList changes.
    setTimeout(() => {
      secondCard.setAttribute('aria-selected', 'true');
    }, 0);

    const { draft } = await pending;

    expect(draft.job_title).toBe('Actually Selected Job');
    expect(draft.company_name).toBe('Correct Co');
    expect(draft.job_description).toBe('The job the user opened.');
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
