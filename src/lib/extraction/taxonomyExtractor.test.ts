import { describe, expect, it } from 'vitest';
import { extractTaxonomy } from './taxonomyExtractor';

describe('extractTaxonomy', () => {
  it('extracts canonical skills, software, and certifications', () => {
    const result = extractTaxonomy(`
      Build services with TypeScript, React, k8s, and PostgreSQL.
      The team uses GitHub, Jira, and Visual Studio Code.
      AWS Certified and CKA credentials are preferred.
    `);

    expect(result).toEqual({
      skills: ['TypeScript', 'React', 'PostgreSQL', 'Kubernetes', 'AWS'],
      software: ['Jira', 'VS Code', 'GitHub'],
      certifications: ['AWS Certified', 'Kubernetes Administrator'],
    });
  });

  it('deduplicates aliases under their canonical taxonomy name', () => {
    const result = extractTaxonomy(
      'Kubernetes and k8s; PostgreSQL and Postgres; CKA and Kubernetes Administrator.',
    );

    expect(result.skills).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(result.certifications).toEqual(['Kubernetes Administrator']);
  });

  it('matches terms case-insensitively without matching word substrings', () => {
    const result = extractTaxonomy(
      'typescript, DOCKER, and jira are required; githubber and rediscover are unrelated words.',
    );

    expect(result.skills).toEqual(['TypeScript', 'Docker']);
    expect(result.software).toEqual(['Jira']);
  });

  it('returns empty arrays when no curated taxonomy terms appear', () => {
    expect(
      extractTaxonomy('Communicate clearly and build reliable products.'),
    ).toEqual({
      skills: [],
      software: [],
      certifications: [],
    });
  });
});
