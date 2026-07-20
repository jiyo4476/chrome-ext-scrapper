import {
  CERTIFICATIONS,
  KEYWORDS,
  SKILLS,
  SOFTWARE,
  type TaxonomyEntry,
} from './taxonomyCatalog';

interface CompiledTaxonomyEntry {
  canonical: string;
  patterns: RegExp[];
}

/**
 * Category-owned extraction result. Every value stays in the category that
 * owns it: a credential is never emitted as software, a tool is never
 * emitted as a skill, and keywords are contextual labels that may
 * intentionally repeat a term from another category (e.g. "microservices").
 */
export interface ExtractedTaxonomy {
  skills: string[];
  software: string[];
  certifications: string[];
  keywords: string[];
}

export const TAXONOMY_CATEGORIES = [
  'skills',
  'software',
  'certifications',
  'keywords',
] as const;

export type TaxonomyCategory = (typeof TAXONOMY_CATEGORIES)[number];

// Keep this aligned with MAX_TAGS_PER_FIELD in schemas.ts. Importing the
// runtime schema here would pull Zod into the injected content-script bundle.
export const MAX_EXTRACTED_TAGS = 100;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTaxonomy(
  entries: readonly TaxonomyEntry[],
): CompiledTaxonomyEntry[] {
  return entries.map(({ canonical, aliases = [] }) => ({
    canonical,
    patterns: [canonical, ...aliases].map(
      (term) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
          'iu',
        ),
    ),
  }));
}

// Structured taxonomies (skills, software, certifications) must not share a
// term: each canonical name or alias has exactly one owning category, so a
// detected mention can never be filed under two structured categories.
// KEYWORDS are deliberately excluded from this check -- they are contextual
// labels, and overlapping a skill (e.g. 'microservices') is intended.
function assertExclusiveOwnership(
  taxonomies: readonly (readonly TaxonomyEntry[])[],
): void {
  const owners = new Map<string, number>();
  taxonomies.forEach((entries, taxonomyIndex) => {
    entries.forEach(({ canonical, aliases = [] }) => {
      for (const term of [canonical, ...aliases]) {
        const key = term.toLocaleLowerCase();
        const owner = owners.get(key);
        if (owner !== undefined && owner !== taxonomyIndex) {
          throw new Error(`Taxonomy term has multiple owners: ${term}`);
        }
        owners.set(key, taxonomyIndex);
      }
    });
  });
}

assertExclusiveOwnership([SKILLS, SOFTWARE, CERTIFICATIONS]);

const COMPILED_SKILLS = compileTaxonomy(SKILLS);
const COMPILED_SOFTWARE = compileTaxonomy(SOFTWARE);
const COMPILED_CERTIFICATIONS = compileTaxonomy(CERTIFICATIONS);
const COMPILED_KEYWORDS = compileTaxonomy(KEYWORDS);

function matchTaxonomy(
  description: string,
  entries: readonly CompiledTaxonomyEntry[],
): string[] {
  return entries
    .filter(({ patterns }) =>
      patterns.some((pattern) => pattern.test(description)),
    )
    .map(({ canonical }) => canonical)
    .slice(0, MAX_EXTRACTED_TAGS);
}

function maskTaxonomyMentions(
  description: string,
  entries: readonly CompiledTaxonomyEntry[],
): string {
  return entries.reduce(
    (masked, { patterns }) =>
      patterns.reduce(
        (value, pattern) =>
          value.replace(new RegExp(pattern.source, 'giu'), (match) =>
            ' '.repeat(match.length),
          ),
        masked,
      ),
    description,
  );
}

// Mirrors the backend's suppressGenericCertifications(): drop an umbrella
// credential (e.g. 'AWS Certified', 'CompTIA') when a more specific
// certification from the same family also matched.
function suppressGenericCertifications(matched: string[]): string[] {
  return matched.filter(
    (name) =>
      !matched.some((other) => other !== name && other.startsWith(`${name} `)),
  );
}

export function extractTaxonomy(description: string): ExtractedTaxonomy {
  const certifications = suppressGenericCertifications(
    matchTaxonomy(description, COMPILED_CERTIFICATIONS),
  );
  // A credential name can contain a platform name (for example, "AWS
  // Certified Solutions Architect" or "Certified Kubernetes Administrator").
  // Mask the credential phrase before software matching so the credential
  // alone does not fabricate a second category match. Independent platform
  // mentions elsewhere in the description still match normally.
  const descriptionWithoutCertifications = maskTaxonomyMentions(
    description,
    COMPILED_CERTIFICATIONS,
  );

  return {
    skills: matchTaxonomy(description, COMPILED_SKILLS),
    software: matchTaxonomy(
      descriptionWithoutCertifications,
      COMPILED_SOFTWARE,
    ),
    certifications,
    keywords: matchTaxonomy(description, COMPILED_KEYWORDS),
  };
}
