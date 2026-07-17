import { MAX_TAG_LENGTH, MAX_TAGS_PER_FIELD } from './schemas';

/**
 * The four taxonomy categories, in popup display order. These are separate,
 * category-owned fields end to end: there is no generic "tags" field, and a
 * value is never moved between categories implicitly. The same name may
 * exist in two categories at once (e.g. "microservices" as both a skill and
 * a keyword) -- deduplication only ever happens *within* one category.
 */
export const TAXONOMY_FIELDS = [
  'skills',
  'software',
  'certifications',
  'keywords',
] as const;

export type TaxonomyField = (typeof TAXONOMY_FIELDS)[number];

export interface TaxonomyGroupCopy {
  /** Visible group heading. */
  label: string;
  /** Singular noun for per-item messages and accessible names. */
  singular: string;
  /** Category-specific guidance rendered under the heading. */
  helpText: string;
  /** Shown when the category has no values. */
  emptyState: string;
  /** Accessible name for the category's add input. */
  addLabel: string;
}

export const TAXONOMY_GROUP_COPY: Record<TaxonomyField, TaxonomyGroupCopy> = {
  skills: {
    label: 'Skills',
    singular: 'skill',
    helpText:
      'Capabilities, languages, and methods (for example Python or CI/CD).',
    emptyState: 'No skills yet. Extracted skills appear here automatically.',
    addLabel: 'Add a skill',
  },
  software: {
    label: 'Software',
    singular: 'software item',
    helpText:
      'Named tools, platforms, and products (for example Docker or PostgreSQL).',
    emptyState:
      'No software yet. Extracted tools and platforms appear here automatically.',
    addLabel: 'Add a software item',
  },
  certifications: {
    label: 'Certifications',
    singular: 'certification',
    helpText:
      'Credentials and licenses (for example CISSP or PMP). Not security clearances.',
    emptyState:
      'No certifications yet. Extracted credentials appear here automatically.',
    addLabel: 'Add a certification',
  },
  keywords: {
    label: 'Keywords',
    singular: 'keyword',
    helpText:
      'Contextual labels (for example remote or startup). A keyword may repeat a skill.',
    emptyState:
      'No keywords yet. Extracted contextual labels appear here automatically.',
    addLabel: 'Add a keyword',
  },
};

export function isTaxonomyField(field: string): field is TaxonomyField {
  return (TAXONOMY_FIELDS as readonly string[]).includes(field);
}

/** Parses the comma-separated form-value representation into a tag list. */
export function parseTagList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Serializes a tag list back to the comma-separated form-value string. */
export function joinTagList(tags: readonly string[]): string {
  return tags.join(', ');
}

export type AddTagResult =
  { ok: true; tags: string[] } | { ok: false; error: string };

/**
 * Adds a value to one category's tag list. Rejects blank input, over-long
 * values, case-insensitive duplicates within the category, and additions
 * beyond the payload cap. Never inspects any other category: the same value
 * remains addable to a different category.
 */
export function addTag(
  field: TaxonomyField,
  tags: readonly string[],
  rawValue: string,
): AddTagResult {
  const copy = TAXONOMY_GROUP_COPY[field];
  const value = rawValue.replace(/\s+/g, ' ').trim();

  if (!value) {
    return { ok: false, error: `Enter a ${copy.singular} to add.` };
  }
  if (value.length > MAX_TAG_LENGTH) {
    return {
      ok: false,
      error: `Each ${copy.singular} must be ${String(MAX_TAG_LENGTH)} characters or fewer.`,
    };
  }
  if (tags.length >= MAX_TAGS_PER_FIELD) {
    return {
      ok: false,
      error: `${copy.label} is limited to ${String(MAX_TAGS_PER_FIELD)} entries.`,
    };
  }
  const key = value.toLocaleLowerCase();
  if (tags.some((tag) => tag.toLocaleLowerCase() === key)) {
    return {
      ok: false,
      error: `"${value}" is already listed under ${copy.label}.`,
    };
  }

  return { ok: true, tags: [...tags, value] };
}

/** Removes the tag at `index`, returning a new list. */
export function removeTagAt(tags: readonly string[], index: number): string[] {
  return tags.filter((_, i) => i !== index);
}

/**
 * Merges freshly extracted values into the user's current list for one
 * category: user values stay first and unchanged, new extracted values are
 * appended, duplicates are dropped case-insensitively within the category,
 * and the result is capped at the payload limit. Used on re-extract so a
 * rescan never discards manual edits or moves a value between categories.
 */
export function mergeTaxonomyTags(
  current: readonly string[],
  extracted: readonly string[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...current, ...extracted]) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
    if (merged.length === MAX_TAGS_PER_FIELD) break;
  }

  return merged;
}

/**
 * Validates one category's committed tag list, returning an error message or
 * undefined. Mirrors the payload schema constraints so problems surface in
 * the popup instead of as a failed save.
 */
export function validateTagList(
  field: TaxonomyField,
  tags: readonly string[],
): string | undefined {
  const copy = TAXONOMY_GROUP_COPY[field];

  if (tags.length > MAX_TAGS_PER_FIELD) {
    return `${copy.label} is limited to ${String(MAX_TAGS_PER_FIELD)} entries.`;
  }
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    return `Each ${copy.singular} must be ${String(MAX_TAG_LENGTH)} characters or fewer.`;
  }

  const seen = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) {
      return `"${tag}" is listed more than once under ${copy.label}.`;
    }
    seen.add(key);
  }

  return undefined;
}
