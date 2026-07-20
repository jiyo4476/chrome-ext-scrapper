// Regenerates src/lib/extraction/taxonomyCatalog.ts from the backend's
// canonical taxonomy catalog (job-tracker-nextjs/src/lib/nlp-extract.ts).
//
// The extension must never depend on the API at runtime to know the
// taxonomy, so the catalog is checked in as generated source. This script
// is the only supported way to update it:
//
//   npm run sync:catalog
//   npm run sync:catalog -- /path/to/nlp-extract.ts
//
// CATALOG_HASH is a SHA-256 over the canonical JSON of the four catalogs;
// taxonomyCatalog.test.ts recomputes it to reject hand edits, and (when the
// backend repo is checked out next to this one) re-derives the backend
// catalogs to detect drift.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_BACKEND_CATALOG_PATH = resolve(
  repoRoot,
  '../job-tracker-nextjs/src/lib/nlp-extract.ts',
);

const OUTPUT_PATH = resolve(repoRoot, 'src/lib/extraction/taxonomyCatalog.ts');

/** Loads the four catalogs from the backend module's own exports. */
export function loadBackendCatalogs(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const moduleShim = { exports: {} };
  vm.runInNewContext(transpiled, {
    module: moduleShim,
    exports: moduleShim.exports,
    require,
  });

  const {
    SKILL_CATALOG,
    SOFTWARE_CATALOG,
    CERTIFICATION_CATALOG,
    KEYWORD_CATALOG,
  } = moduleShim.exports;

  for (const [name, value] of Object.entries({
    SKILL_CATALOG,
    SOFTWARE_CATALOG,
    CERTIFICATION_CATALOG,
    KEYWORD_CATALOG,
  })) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`Backend catalog export ${name} is missing or empty`);
    }
  }

  return normalizeCatalogs({
    skills: SKILL_CATALOG,
    software: SOFTWARE_CATALOG,
    certifications: CERTIFICATION_CATALOG,
    keywords: KEYWORD_CATALOG,
  });
}

/**
 * Normalizes entries to `{ canonical, aliases? }` with a stable key order so
 * the hash is a pure function of catalog content, not source formatting.
 */
export function normalizeCatalogs({
  skills,
  software,
  certifications,
  keywords,
}) {
  const normalizeEntries = (entries) =>
    entries.map(({ canonical, aliases }) =>
      Array.isArray(aliases) && aliases.length > 0
        ? { canonical, aliases: [...aliases] }
        : { canonical },
    );

  return {
    skills: normalizeEntries(skills),
    software: normalizeEntries(software),
    certifications: normalizeEntries(certifications),
    keywords: normalizeEntries(keywords),
  };
}

/** Must stay in lockstep with catalogContentHash() in taxonomyCatalog.test.ts. */
export function catalogContentHash(catalogs) {
  return createHash('sha256').update(JSON.stringify(catalogs)).digest('hex');
}

function renderEntry(entry) {
  const canonical = JSON.stringify(entry.canonical);
  if (!entry.aliases) return `  { canonical: ${canonical} },`;
  const aliases = entry.aliases.map((alias) => JSON.stringify(alias));
  return `  { canonical: ${canonical}, aliases: [${aliases.join(', ')}] },`;
}

export function renderCatalogModule(catalogs) {
  const hash = catalogContentHash(catalogs);
  const version = `sha256:${hash.slice(0, 12)}`;

  const lines = [
    '// GENERATED FILE - DO NOT EDIT BY HAND.',
    '//',
    '// Canonical taxonomy catalog, synced from the backend catalog in',
    '// job-tracker-nextjs/src/lib/nlp-extract.ts. Regenerate with:',
    '//',
    '//   npm run sync:catalog',
    '//',
    '// taxonomyCatalog.test.ts verifies CATALOG_HASH against this content and',
    '// compares against the backend source when that repo is available. This',
    '// module must stay dependency-free: it is bundled into the injected',
    '// content script.',
    '',
    'export interface TaxonomyEntry {',
    '  readonly canonical: string;',
    '  readonly aliases?: readonly string[];',
    '}',
    '',
    '/** SHA-256 of the canonical JSON of the four catalogs below. */',
    `export const CATALOG_HASH = ${JSON.stringify(hash)};`,
    '',
    '/** Human-readable catalog version; changes exactly when content changes. */',
    `export const CATALOG_VERSION = ${JSON.stringify(version)};`,
    '',
    '// Skills: languages, practices, methods, and capabilities.',
    'export const SKILLS: readonly TaxonomyEntry[] = [',
    ...catalogs.skills.map(renderEntry),
    '];',
    '',
    '// Software: named tools, products, platforms, frameworks, and services.',
    'export const SOFTWARE: readonly TaxonomyEntry[] = [',
    ...catalogs.software.map(renderEntry),
    '];',
    '',
    '// Certifications: named credentials and licenses only.',
    'export const CERTIFICATIONS: readonly TaxonomyEntry[] = [',
    ...catalogs.certifications.map(renderEntry),
    '];',
    '',
    '// Keywords: contextual labels, not a structured taxonomy. Overlap with',
    '// skills (e.g. "microservices") is intentional and allowed.',
    'export const KEYWORDS: readonly TaxonomyEntry[] = [',
    ...catalogs.keywords.map(renderEntry),
    '];',
    '',
  ];

  return lines.join('\n');
}

function main() {
  const sourcePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_BACKEND_CATALOG_PATH;

  const catalogs = loadBackendCatalogs(sourcePath);
  writeFileSync(OUTPUT_PATH, renderCatalogModule(catalogs), 'utf8');
  console.log(
    `Wrote ${OUTPUT_PATH}\n  version sha256:${catalogContentHash(catalogs).slice(0, 12)}`,
  );
  console.log('Run prettier if formatting changed: npx prettier --write .');
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
