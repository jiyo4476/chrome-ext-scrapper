import { describe, expect, it } from 'vitest';
import { extractTaxonomy } from './taxonomyExtractor';

describe('extractTaxonomy', () => {
  it('separates certifications, named software, skills, and keywords', () => {
    expect(
      extractTaxonomy(`
        Python and unit testing experience are required.
        Build React services backed by PostgreSQL and Docker on AWS.
        CISSP or Security+ certification is preferred.
      `),
    ).toEqual({
      skills: ['Python', 'Unit Testing'],
      software: ['React', 'PostgreSQL', 'AWS', 'Docker'],
      certifications: ['CompTIA Security+', 'CISSP'],
      keywords: [],
    });
  });

  it('keeps the fixture-rule anchors in their owning categories', () => {
    const result = extractTaxonomy(
      'Remote role for a Python engineer. Docker experience and an active CISSP are required.',
    );

    expect(result.certifications).toContain('CISSP');
    expect(result.software).toContain('Docker');
    expect(result.skills).toContain('Python');
    expect(result.keywords).toContain('remote');

    // Category ownership is exclusive for structured taxonomies.
    expect(result.skills).not.toContain('CISSP');
    expect(result.skills).not.toContain('Docker');
    expect(result.software).not.toContain('Python');
    expect(result.certifications).not.toContain('Docker');
  });

  it('extracts contextual keywords, which may repeat a structured term', () => {
    const result = extractTaxonomy(
      'Senior backend engineer for a startup building microservices in a hybrid setup.',
    );

    expect(result.keywords).toEqual([
      'hybrid',
      'backend',
      'microservices',
      'startup',
      'senior',
    ]);
    // 'microservices' is also a skill: keywords deliberately overlap the
    // structured taxonomies without stealing ownership from them.
    expect(result.skills).toContain('Microservices');
  });

  it('canonicalizes aliases once within their owned taxonomy', () => {
    const result = extractTaxonomy(
      'PostgreSQL and Postgres; Kubernetes and k8s; Security+ mentioned twice: Security+; CKA and Certified Kubernetes Administrator.',
    );

    expect(result.skills).toEqual([]);
    expect(result.software).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(result.certifications).toEqual([
      'CompTIA Security+',
      'Certified Kubernetes Administrator (CKA)',
    ]);
  });

  it('matches punctuation-heavy terms without matching substrings', () => {
    const result = extractTaxonomy(
      'Use C++, C#, Node.js, .NET-free services, and CI/CD; githubber and rediscover are unrelated.',
    );

    expect(result.skills).toEqual(['C#', 'C++', 'CI/CD']);
    expect(result.software).toEqual(['Node.js']);
    expect(result.software).not.toContain('GitHub');
    expect(result.software).not.toContain('Redis');
  });

  it('returns empty arrays when no canonical terms appear', () => {
    expect(
      extractTaxonomy('Communicate clearly and build reliable products.'),
    ).toEqual({
      skills: [],
      software: [],
      certifications: [],
      keywords: [],
    });
  });

  it('does not infer software solely from a certification name', () => {
    const certificationOnly = extractTaxonomy(
      'AWS Certified Solutions Architect and Certified Kubernetes Administrator credentials are required.',
    );
    expect(certificationOnly.software).toEqual([]);

    const withIndependentSoftwareMention = extractTaxonomy(
      'AWS Certified Solutions Architect is preferred. Production workloads run on AWS.',
    );
    expect(withIndependentSoftwareMention.software).toEqual(['AWS']);
  });

  it('suppresses umbrella certifications when a specific credential matched', () => {
    expect(
      extractTaxonomy('AWS Certified Solutions Architect required.')
        .certifications,
    ).toEqual(['AWS Certified Solutions Architect']);

    // The umbrella term still matches when it appears alone.
    expect(
      extractTaxonomy('Any AWS Certified credential is a plus.').certifications,
    ).toEqual(['AWS Certified']);
  });
});
