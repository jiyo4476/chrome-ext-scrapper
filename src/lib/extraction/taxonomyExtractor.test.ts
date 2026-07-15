import { describe, expect, it } from 'vitest';
import { extractTaxonomy } from './taxonomyExtractor';

describe('extractTaxonomy', () => {
  it('separates certifications, named software, and skills', () => {
    expect(
      extractTaxonomy(`
        Python and incident response experience are required.
        Build React services backed by PostgreSQL and Docker on AWS.
        CISSP or Security+ certification is preferred.
      `),
    ).toEqual({
      skills: ['Python', 'Incident Response'],
      software: ['React', 'PostgreSQL', 'Docker', 'AWS'],
      certifications: ['CompTIA Security+', 'CISSP'],
    });
  });

  it('canonicalizes aliases once within their owned taxonomy', () => {
    const result = extractTaxonomy(
      'PostgreSQL and Postgres; Kubernetes and k8s; Security+ and CompTIA Security Plus; CKA and Kubernetes Administrator.',
    );

    expect(result.skills).toEqual([]);
    expect(result.software).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(result.certifications).toEqual([
      'CompTIA Security+',
      'Kubernetes Administrator',
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
    });
  });

  it('does not infer software solely from a certification name', () => {
    const certificationOnly = extractTaxonomy(
      'AWS Certified Solutions Architect and Kubernetes Administrator are required.',
    );
    expect(certificationOnly.software).toEqual([]);

    const withIndependentSoftwareMention = extractTaxonomy(
      'AWS Certified Solutions Architect is preferred. Production workloads run on AWS.',
    );
    expect(withIndependentSoftwareMention.software).toEqual(['AWS']);
  });
});
