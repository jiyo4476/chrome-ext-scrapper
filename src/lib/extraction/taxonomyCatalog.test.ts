import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_HASH,
  CATALOG_VERSION,
  CERTIFICATIONS,
  KEYWORDS,
  SKILLS,
  SOFTWARE,
  type TaxonomyEntry,
} from './taxonomyCatalog';

// Mirrors scripts/sync-taxonomy-catalog.mjs: normalize + canonical JSON +
// SHA-256. Keep the two in lockstep.
interface CatalogShape {
  skills: TaxonomyEntry[];
  software: TaxonomyEntry[];
  certifications: TaxonomyEntry[];
  keywords: TaxonomyEntry[];
}

function normalizeEntries(entries: readonly TaxonomyEntry[]): TaxonomyEntry[] {
  return entries.map(({ canonical, aliases }) =>
    aliases && aliases.length > 0
      ? { canonical, aliases: [...aliases] }
      : { canonical },
  );
}

function checkedInCatalogs(): CatalogShape {
  return {
    skills: normalizeEntries(SKILLS),
    software: normalizeEntries(SOFTWARE),
    certifications: normalizeEntries(CERTIFICATIONS),
    keywords: normalizeEntries(KEYWORDS),
  };
}

function catalogContentHash(catalogs: CatalogShape): string {
  return createHash('sha256').update(JSON.stringify(catalogs)).digest('hex');
}

const testDir = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const BACKEND_CATALOG_PATH = resolve(
  testDir,
  '../../../../job-tracker-nextjs/src/lib/nlp-extract.ts',
);

function loadBackendCatalogs(sourcePath: string): CatalogShape {
  const source = readFileSync(sourcePath, 'utf8');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  vm.runInNewContext(transpiled, {
    module: moduleShim,
    exports: moduleShim.exports,
    require: nodeRequire,
  });

  return {
    skills: normalizeEntries(
      moduleShim.exports.SKILL_CATALOG as TaxonomyEntry[],
    ),
    software: normalizeEntries(
      moduleShim.exports.SOFTWARE_CATALOG as TaxonomyEntry[],
    ),
    certifications: normalizeEntries(
      moduleShim.exports.CERTIFICATION_CATALOG as TaxonomyEntry[],
    ),
    keywords: normalizeEntries(
      moduleShim.exports.KEYWORD_CATALOG as TaxonomyEntry[],
    ),
  };
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
describe.skipIf(!existsSync(BACKEND_CATALOG_PATH))(
  'taxonomyCatalog backend parity',
  () => {
    it('matches the backend canonical catalog exactly', () => {
      const backend = loadBackendCatalogs(BACKEND_CATALOG_PATH);
      expect(checkedInCatalogs()).toEqual(backend);
      expect(catalogContentHash(backend)).toBe(CATALOG_HASH);
    });
  },
);
