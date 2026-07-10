// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractGenericJobDraft } from './genericExtractor';

function setHead(html: string): void {
  document.head.innerHTML = html;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
});

describe('extractGenericJobDraft — JSON-LD source', () => {
  it('extracts fields from a JobPosting JSON-LD block', () => {
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

    const { draft, candidates } = extractGenericJobDraft();

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

  it('marks TELECOMMUTE jobLocationType as remote', () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Remote Engineer",
          "jobLocationType": "TELECOMMUTE"
        }
      </script>
    `);

    const { draft } = extractGenericJobDraft();
    expect(draft.is_remote).toBe(true);
  });

  it('finds a JobPosting nested inside @graph', () => {
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

    const { draft } = extractGenericJobDraft();
    expect(draft.job_title).toBe('Graph Engineer');
  });
});

describe('extractGenericJobDraft — salary handling', () => {
  it('converts an annual salary range to integer cents', () => {
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

    const { draft } = extractGenericJobDraft();
    expect(draft.salary_type).toBe('annual');
    expect(draft.salary_min).toBe(10_000_000);
    expect(draft.salary_max).toBe(15_000_000);
  });

  it('passes hourly rates through without conversion', () => {
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

    const { draft } = extractGenericJobDraft();
    expect(draft.salary_type).toBe('hourly');
    expect(draft.hourly_rate_min).toBe(45.5);
    expect(draft.hourly_rate_max).toBe(60);
  });
});

describe('extractGenericJobDraft — employmentType mapping', () => {
  it.each([
    ['FULL_TIME', 'full_time'],
    ['PART_TIME', 'part_time'],
    ['CONTRACTOR', 'contract'],
    ['INTERN', 'internship'],
    ['TEMPORARY', 'temp'],
  ])('maps schema.org %s to %s', (schemaValue, expected) => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "employmentType": "${schemaValue}"
        }
      </script>
    `);

    const { draft } = extractGenericJobDraft();
    expect(draft.job_type).toBe(expected);
  });

  it('omits unknown employmentType values', () => {
    setHead(`
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Engineer",
          "employmentType": "PER_DIEM"
        }
      </script>
    `);

    const { draft } = extractGenericJobDraft();
    expect(draft.job_type).toBeUndefined();
  });
});

describe('extractGenericJobDraft — OpenGraph fallback', () => {
  it('extracts from meta tags when no JSON-LD is present', () => {
    setHead(`
      <meta property="og:title" content="Platform Engineer" />
      <meta name="description" content="Own our deployment platform." />
      <meta property="og:url" content="https://example.com/jobs/platform-engineer" />
    `);

    const { draft, candidates } = extractGenericJobDraft();

    expect(draft.job_title).toBe('Platform Engineer');
    expect(draft.job_description).toBe('Own our deployment platform.');
    expect(draft.extraction_confidence?.job_title).toBe('medium');
    expect(candidates.job_title).toBeUndefined();
  });
});

describe('extractGenericJobDraft — visible-text fallback', () => {
  it('falls back to h1 and page body text when nothing else is present', () => {
    setBody(`
      <main>
        <h1>Fallback Title</h1>
        <p>This role has no structured data at all, just plain text.</p>
      </main>
    `);

    const { draft } = extractGenericJobDraft();

    expect(draft.job_title).toBe('Fallback Title');
    expect(draft.job_description).toContain(
      'This role has no structured data at all, just plain text.',
    );
    expect(draft.extraction_confidence?.job_title).toBe('low');
  });
});

describe('extractGenericJobDraft — candidate review mode', () => {
  it('produces two title candidates when JSON-LD and meta tags disagree', () => {
    setHead(`
      <script type="application/ld+json">
        { "@type": "JobPosting", "title": "JSON-LD Title" }
      </script>
      <meta property="og:title" content="Meta Title" />
    `);

    const { draft, candidates } = extractGenericJobDraft();

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
