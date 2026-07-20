import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Reuse the loader/normalizer/hasher from the sync script so this parity test
// and the generator share one implementation of the transpile + hashing
// machinery; there is nothing to keep "in lockstep" by hand.
import {
  catalogContentHash,
  DEFAULT_BACKEND_CATALOG_PATH,
  loadBackendCatalogs,
  normalizeCatalogs,
} from '../../../scripts/sync-taxonomy-catalog.mjs';
import {
  CATALOG_HASH,
  CATALOG_VERSION,
  CERTIFICATIONS,
  KEYWORDS,
  SKILLS,
  SOFTWARE,
  type TaxonomyEntry,
} from './taxonomyCatalog';

function checkedInCatalogs() {
  return normalizeCatalogs({
    skills: SKILLS,
    software: SOFTWARE,
    certifications: CERTIFICATIONS,
    keywords: KEYWORDS,
  });
}

describe('taxonomyCatalog integrity', () => {
  it('CATALOG_HASH matches the checked-in catalog content (no hand edits)', () => {
    expect(catalogContentHash(checkedInCatalogs())).toBe(CATALOG_HASH);
  });

  it('CATALOG_VERSION is derived from CATALOG_HASH', () => {
    expect(CATALOG_VERSION).toBe(`sha256:${CATALOG_HASH.slice(0, 12)}`);
  });

  it('keeps the four categories non-empty', () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    expect(SOFTWARE.length).toBeGreaterThan(0);
    expect(CERTIFICATIONS.length).toBeGreaterThan(0);
    expect(KEYWORDS.length).toBeGreaterThan(0);
  });

  it('owns the fixture-rule anchors in their required categories', () => {
    const canonicalsOf = (entries: readonly TaxonomyEntry[]) =>
      entries.map((entry) => entry.canonical);

    expect(canonicalsOf(CERTIFICATIONS)).toContain('CISSP');
    expect(canonicalsOf(SOFTWARE)).toContain('Docker');
    expect(canonicalsOf(SKILLS)).toContain('Python');
    expect(canonicalsOf(KEYWORDS)).toContain('remote');
  });
});

// Runs only when the backend repo is checked out next to this one (local
// workspaces); CI for this standalone repo skips it. The CATALOG_HASH test
// above still guards the checked-in content everywhere.
describe.skipIf(!existsSync(DEFAULT_BACKEND_CATALOG_PATH))(
  'taxonomyCatalog backend parity',
  () => {
    it('matches the backend canonical catalog exactly', () => {
      const backend = loadBackendCatalogs(DEFAULT_BACKEND_CATALOG_PATH);
      expect(checkedInCatalogs()).toEqual(backend);
      expect(catalogContentHash(backend)).toBe(CATALOG_HASH);
    });
  },
);
