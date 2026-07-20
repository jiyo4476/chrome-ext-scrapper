// Type declarations for sync-taxonomy-catalog.mjs so TypeScript consumers
// (notably the parity test in src/lib/extraction/taxonomyCatalog.test.ts) can
// reuse the catalog-loading and hashing helpers instead of duplicating the
// transpile + vm machinery.

export interface CatalogEntry {
  readonly canonical: string;
  readonly aliases?: readonly string[];
}

/** A raw catalog per category, as authored in the backend source. */
export interface RawCatalogs {
  skills: readonly CatalogEntry[];
  software: readonly CatalogEntry[];
  certifications: readonly CatalogEntry[];
  keywords: readonly CatalogEntry[];
}

/** An entry normalized to a stable key order for hashing. */
export interface NormalizedCatalogEntry {
  canonical: string;
  aliases?: string[];
}

/** The four catalogs after normalization; the unit that gets hashed. */
export interface NormalizedCatalogs {
  skills: NormalizedCatalogEntry[];
  software: NormalizedCatalogEntry[];
  certifications: NormalizedCatalogEntry[];
  keywords: NormalizedCatalogEntry[];
}

/** Absolute path to the sibling backend catalog source (nlp-extract.ts). */
export const DEFAULT_BACKEND_CATALOG_PATH: string;

/** Transpiles the backend module and reads its four exported catalogs. */
export function loadBackendCatalogs(sourcePath: string): NormalizedCatalogs;

/** Normalizes raw catalogs to `{ canonical, aliases? }` with stable key order. */
export function normalizeCatalogs(catalogs: RawCatalogs): NormalizedCatalogs;

/** SHA-256 over the canonical JSON of the normalized catalogs. */
export function catalogContentHash(catalogs: NormalizedCatalogs): string;

/** Renders the generated taxonomyCatalog.ts module source. */
export function renderCatalogModule(catalogs: NormalizedCatalogs): string;
