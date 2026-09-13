import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingUpdate,
  planTopicRows,
  wasBuiltWithoutModel,
} from '../../src/modules/ingestion/pipeline.js';
import { selectChunksForTopic } from '../../src/modules/ingestion/lesson-writer.js';
import {
  GENERIC_VOCABULARY,
  normaliseVocabulary,
} from '../../src/modules/ingestion/vocabulary.js';

describe('buildEmbeddingUpdate', () => {
  it('writes a whole batch in one statement', () => {
    const { sql, params } = buildEmbeddingUpdate([
      { id: 'a', vector: [0.1, 0.2] },
      { id: 'b', vector: [0.3, 0.4] },
    ]);

    expect(sql.match(/UPDATE/g)).toHaveLength(1);
    expect(sql).toContain('($1::text, $2::text), ($3::text, $4::text)');
    expect(params).toEqual(['a', '[0.1,0.2]', 'b', '[0.3,0.4]']);
  });
});

describe('planTopicRows', () => {
  const topic = (name: string, prerequisiteSlugs: string[] = []) => ({
    name,
    slug: name.toLowerCase().replace(/\s+/g, '_'),
    summary: `${name} summary`,
    sourcePages: [1],
    prerequisiteSlugs,
    objectives: [`Explain ${name}`, `Apply ${name}`],
    keyTerms: [name],
  });

  it('resolves prerequisite slugs to ids before the insert', () => {
    let n = 0;
    const rows = planTopicRows(
      'm1',
      [topic('State'), topic('Effects', ['State']), topic('Queries', ['state', 'Effects'])],
      () => `id${++n}`,
    );

    expect(rows.map((r) => r.id)).toEqual(['id1', 'id2', 'id3']);
    expect(rows[1]!.prerequisiteTopicIds).toEqual(['id1']);
    expect(rows[2]!.prerequisiteTopicIds).toEqual(['id1', 'id2']);
    expect(rows.map((r) => r.orderIndex)).toEqual([0, 1, 2]);
  });

  it('drops unknown and self references', () => {
    const rows = planTopicRows('m1', [topic('State', ['State', 'Nowhere'])], () => 'only');
    expect(rows[0]!.prerequisiteTopicIds).toEqual([]);
  });
});

describe('normaliseVocabulary', () => {
  const entry = (tag: string) => ({ tag, label: `Label ${tag}`, description: `About ${tag}` });

  it('keeps well-formed tags', () => {
    const tags = normaliseVocabulary([entry('a_b'), entry('c_d'), entry('e_f')]).map((e) => e.tag);
    expect(tags).toEqual(['a_b', 'c_d', 'e_f']);
  });

  it('repairs a tag the model wrote as words instead of dropping the course map', () => {
    const tags = normaliseVocabulary([
      entry('Assignment vs. Comparison'),
      entry('c_d'),
      entry('e_f'),
    ]).map((e) => e.tag);
    expect(tags[0]).toBe('assignment_vs_comparison');
  });

  it('collapses duplicates', () => {
    const tags = normaliseVocabulary([entry('a_b'), entry('a_b'), entry('c_d'), entry('e_f')]);
    expect(tags).toHaveLength(3);
  });

  it('falls back to the generic list when too few survive', () => {
    expect(normaliseVocabulary([entry('a_b'), entry('???')])).toBe(GENERIC_VOCABULARY);
  });
});

describe('selectChunksForTopic', () => {
  const chunks = [1, 2, 3, 4, 5].map((page) => ({ page }));

  it('takes the listed pages', () => {
    expect(selectChunksForTopic(chunks, [2, 4]).map((c) => c.page)).toEqual([2, 4]);
  });

  it('falls back to the range when no listed page has a chunk', () => {
    expect(selectChunksForTopic([{ page: 3 }], [2, 4]).map((c) => c.page)).toEqual([3]);
  });

  it('returns nothing for a topic with no pages', () => {
    expect(selectChunksForTopic(chunks, [])).toEqual([]);
  });
});

describe('wasBuiltWithoutModel', () => {
  it('recognises a material whose course map fell back', () => {
    expect(wasBuiltWithoutModel(GENERIC_VOCABULARY.map((entry) => entry.tag))).toBe(true);
  });

  it('treats a material-specific vocabulary as model-built', () => {
    expect(wasBuiltWithoutModel(['persist_vs_localstorage', 'confusing_similar_terms'])).toBe(false);
  });

  it('does not judge a material with no vocabulary at all', () => {
    expect(wasBuiltWithoutModel([])).toBe(false);
  });
});
