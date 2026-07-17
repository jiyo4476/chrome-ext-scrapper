import { describe, expect, it } from 'vitest';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_FIELD } from './schemas';
import {
  addTag,
  joinTagList,
  mergeTaxonomyTags,
  parseTagList,
  removeTagAt,
  TAXONOMY_FIELDS,
  TAXONOMY_GROUP_COPY,
  validateTagList,
} from './taxonomyFields';

describe('taxonomy group copy', () => {
  it('defines category-specific copy for all four groups', () => {
    expect(TAXONOMY_FIELDS).toEqual([
      'skills',
      'software',
      'certifications',
      'keywords',
    ]);

    for (const field of TAXONOMY_FIELDS) {
      const copy = TAXONOMY_GROUP_COPY[field];
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.helpText.length).toBeGreaterThan(0);
      expect(copy.emptyState.length).toBeGreaterThan(0);
      expect(copy.addLabel.length).toBeGreaterThan(0);
    }

    // No generic "tags" group exists.
    expect(TAXONOMY_FIELDS).not.toContain('tags');
    const labels = TAXONOMY_FIELDS.map((f) =>
      TAXONOMY_GROUP_COPY[f].label.toLowerCase(),
    );
    expect(labels).not.toContain('tags');
  });
});

describe('parseTagList / joinTagList', () => {
  it('round-trips comma-separated values, trimming blanks', () => {
    expect(parseTagList(' TypeScript ,, React ,  ')).toEqual([
      'TypeScript',
      'React',
    ]);
    expect(joinTagList(['TypeScript', 'React'])).toBe('TypeScript, React');
    expect(parseTagList('')).toEqual([]);
  });
});

describe('addTag', () => {
  it('appends a trimmed, whitespace-collapsed value', () => {
    const result = addTag('skills', ['Python'], '  Unit   Testing  ');
    expect(result).toEqual({ ok: true, tags: ['Python', 'Unit Testing'] });
  });

  it('rejects blank input with category-specific copy', () => {
    const result = addTag('certifications', [], '   ');
    expect(result).toEqual({
      ok: false,
      error: 'Enter a certification to add.',
    });
  });

  it('rejects case-insensitive duplicates within the category', () => {
    const result = addTag('software', ['Docker'], 'docker');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already listed under Software');
    }
  });

  it('allows the same name to be added to a different category', () => {
    // "microservices" already exists under skills; keywords is independent.
    expect(addTag('keywords', [], 'microservices')).toEqual({
      ok: true,
      tags: ['microservices'],
    });
    expect(addTag('skills', ['microservices'], 'microservices').ok).toBe(false);
  });

  it('rejects over-long values and full categories', () => {
    const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
    expect(addTag('skills', [], long).ok).toBe(false);

    const full = Array.from({ length: MAX_TAGS_PER_FIELD }, (_, i) =>
      String(i),
    );
    expect(addTag('skills', full, 'one-more').ok).toBe(false);
  });
});

describe('removeTagAt', () => {
  it('removes only the targeted index and returns a new array', () => {
    const tags = ['a', 'b', 'c'];
    expect(removeTagAt(tags, 1)).toEqual(['a', 'c']);
    expect(tags).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeTaxonomyTags', () => {
  it('keeps user values first and appends new extracted values', () => {
    expect(
      mergeTaxonomyTags(['My Custom Skill', 'Python'], ['python', 'CI/CD']),
    ).toEqual(['My Custom Skill', 'Python', 'CI/CD']);
  });

  it('deduplicates case-insensitively within the category and caps at the payload limit', () => {
    const current = Array.from({ length: MAX_TAGS_PER_FIELD - 1 }, (_, i) =>
      String(i),
    );
    const merged = mergeTaxonomyTags(current, ['new-1', 'new-2']);
    expect(merged).toHaveLength(MAX_TAGS_PER_FIELD);
    expect(merged.at(-1)).toBe('new-1');
  });
});

describe('validateTagList', () => {
  it('accepts a valid list', () => {
    expect(validateTagList('skills', ['Python', 'CI/CD'])).toBeUndefined();
  });

  it('flags duplicates within a category only', () => {
    expect(validateTagList('skills', ['Python', 'python'])).toContain(
      'more than once under Skills',
    );
    // Cross-category duplication is legal by design: each category
    // validates in isolation.
    expect(validateTagList('keywords', ['python'])).toBeUndefined();
  });

  it('flags over-long values and oversized lists', () => {
    expect(
      validateTagList('software', ['x'.repeat(MAX_TAG_LENGTH + 1)]),
    ).toBeDefined();
    expect(
      validateTagList(
        'software',
        Array.from({ length: MAX_TAGS_PER_FIELD + 1 }, (_, i) => String(i)),
      ),
    ).toBeDefined();
  });
});
