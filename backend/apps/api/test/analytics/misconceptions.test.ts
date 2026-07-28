import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeMasteryByTopic,
  detectFindings,
  detectFindingsForTopic,
  isFindingResolved,
  rankFindings,
} from '../../src/modules/analytics/index.js';
import { resetIds, response, sequence } from './helpers.js';

beforeEach(resetIds);

describe('detectFindingsForTopic', () => {
  it('returns nothing for empty input', () => {
    expect(detectFindingsForTopic('topic_a', [])).toEqual([]);
  });

  it('does not fire on a single occurrence of a tag', () => {
    const responses = [
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 0 }),
      response({ isCorrect: true, minutesAfterT0: 10 }),
    ];

    expect(detectFindingsForTopic('topic_a', responses)).toEqual([]);
  });

  it('fires at exactly 2 occurrences inside the window', () => {
    const responses = [
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 0 }),
      response({ isCorrect: true, minutesAfterT0: 10 }),
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 20 }),
    ];

    const findings = detectFindingsForTopic('topic_a', responses);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.tag).toBe('assignment_vs_comparison');
    expect(findings[0]!.occurrences).toBe(2);
    expect(findings[0]!.windowSize).toBe(3);
  });

  it('reports evidence newest first', () => {
    const responses = [
      response({ id: 'old', isCorrect: false, misconceptionTag: 'tag_x', minutesAfterT0: 0 }),
      response({ id: 'mid', isCorrect: false, misconceptionTag: 'tag_x', minutesAfterT0: 10 }),
      response({ id: 'new', isCorrect: false, misconceptionTag: 'tag_x', minutesAfterT0: 20 }),
    ];

    const finding = detectFindingsForTopic('topic_a', responses)[0]!;

    expect(finding.evidenceResponseIds).toEqual(['new', 'mid', 'old']);
    expect(finding.occurrences).toBe(3);
  });

  it('only considers the 5 most recent responses', () => {
    // Two old errors with the same tag, then five recent correct answers.
    const responses = [
      response({ isCorrect: false, misconceptionTag: 'stale_tag', minutesAfterT0: 0 }),
      response({ isCorrect: false, misconceptionTag: 'stale_tag', minutesAfterT0: 10 }),
      ...sequence([true, true, true, true, true]).map((r, i) => ({
        ...r,
        answeredAt: new Date(r.answeredAt.getTime() + (i + 3) * 60_000 * 10),
      })),
    ];

    // The window is the 5 newest, all correct — the old errors fall out of it.
    expect(detectFindingsForTopic('topic_a', responses)).toEqual([]);
  });

  it('caps windowSize at 5 even with a long history', () => {
    const responses = Array.from({ length: 12 }, (_, i) =>
      response({ isCorrect: false, misconceptionTag: 'tag_x', minutesAfterT0: i * 10 }),
    );

    const finding = detectFindingsForTopic('topic_a', responses)[0]!;

    expect(finding.windowSize).toBe(5);
    expect(finding.occurrences).toBe(5);
  });

  it('ignores correct answers even if they somehow carry a tag', () => {
    const responses = [
      response({ isCorrect: true, misconceptionTag: 'tag_x', minutesAfterT0: 0 }),
      response({ isCorrect: true, misconceptionTag: 'tag_x', minutesAfterT0: 10 }),
    ];

    expect(detectFindingsForTopic('topic_a', responses)).toEqual([]);
  });

  it('ignores untagged wrong answers', () => {
    const responses = [
      response({ isCorrect: false, misconceptionTag: null, minutesAfterT0: 0 }),
      response({ isCorrect: false, misconceptionTag: null, minutesAfterT0: 10 }),
    ];

    expect(detectFindingsForTopic('topic_a', responses)).toEqual([]);
  });

  it('produces the seeded demo case: 3 occurrences in a 5-response window', () => {
    const responses = [
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 0 }),
      response({ isCorrect: true, minutesAfterT0: 10 }),
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 20 }),
      response({ isCorrect: true, minutesAfterT0: 30 }),
      response({ isCorrect: false, misconceptionTag: 'assignment_vs_comparison', minutesAfterT0: 40 }),
    ];

    const finding = detectFindingsForTopic('topic_conditionals', [
      ...responses.map((r) => ({ ...r, topicId: 'topic_conditionals' })),
    ])[0]!;

    expect(finding.occurrences).toBe(3);
    expect(finding.windowSize).toBe(5);
  });
});

describe('detectFindings across topics', () => {
  it('detects independently per topic', () => {
    const responses = [
      ...[0, 10].map((m) =>
        response({ topicId: 'topic_a', isCorrect: false, misconceptionTag: 'tag_a', minutesAfterT0: m }),
      ),
      ...[0, 10].map((m) =>
        response({ topicId: 'topic_b', isCorrect: false, misconceptionTag: 'tag_b', minutesAfterT0: m }),
      ),
    ];

    const findings = detectFindings(responses);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.topicId).sort()).toEqual(['topic_a', 'topic_b']);
  });

  it('does not merge the same tag across different topics', () => {
    const responses = [
      response({ topicId: 'topic_a', isCorrect: false, misconceptionTag: 'shared', minutesAfterT0: 0 }),
      response({ topicId: 'topic_b', isCorrect: false, misconceptionTag: 'shared', minutesAfterT0: 10 }),
    ];

    // One occurrence in each topic — neither reaches the threshold.
    expect(detectFindings(responses)).toEqual([]);
  });
});

describe('rankFindings', () => {
  it('ranks by occurrences descending first', () => {
    const responses = [
      ...[0, 10].map((m) =>
        response({ topicId: 'topic_a', isCorrect: false, misconceptionTag: 'tag_a', minutesAfterT0: m }),
      ),
      ...[0, 10, 20].map((m) =>
        response({ topicId: 'topic_b', isCorrect: false, misconceptionTag: 'tag_b', minutesAfterT0: m }),
      ),
    ];

    const ranked = rankFindings(detectFindings(responses));

    expect(ranked[0]!.occurrences).toBe(3);
    expect(ranked[1]!.occurrences).toBe(2);
  });

  it('breaks an occurrence tie by recency', () => {
    const responses = [
      // topic_a: older pair
      ...[0, 10].map((m) =>
        response({ topicId: 'topic_a', isCorrect: false, misconceptionTag: 'tag_a', minutesAfterT0: m }),
      ),
      // topic_b: more recent pair
      ...[100, 110].map((m) =>
        response({ topicId: 'topic_b', isCorrect: false, misconceptionTag: 'tag_b', minutesAfterT0: m }),
      ),
    ];

    const ranked = rankFindings(detectFindings(responses));

    expect(ranked[0]!.topicId).toBe('topic_b');
    expect(ranked[1]!.topicId).toBe('topic_a');
  });

  it('breaks a full tie by lower mastery score', () => {
    // Two tags, same topic, same occurrence count and identical timestamps.
    const sameTime = 50;
    const findings = [
      {
        topicId: 'topic_strong',
        tag: 'tag_1',
        occurrences: 2,
        windowSize: 5,
        evidenceResponseIds: ['a', 'b'],
        lastOccurredAt: new Date(sameTime),
      },
      {
        topicId: 'topic_weak',
        tag: 'tag_2',
        occurrences: 2,
        windowSize: 5,
        evidenceResponseIds: ['c', 'd'],
        lastOccurredAt: new Date(sameTime),
      },
    ];

    const mastery = computeMasteryByTopic(
      ['topic_strong', 'topic_weak'],
      [
        ...sequence([true, true, true], { topicId: 'topic_strong' }),
        ...sequence([false, false, false], { topicId: 'topic_weak' }),
      ],
    );

    const ranked = rankFindings(findings, mastery);

    expect(ranked[0]!.topicId).toBe('topic_weak');
  });

  it('does not mutate its input', () => {
    const findings = [
      {
        topicId: 't1',
        tag: 'a',
        occurrences: 1,
        windowSize: 5,
        evidenceResponseIds: [],
        lastOccurredAt: new Date(0),
      },
      {
        topicId: 't2',
        tag: 'b',
        occurrences: 9,
        windowSize: 5,
        evidenceResponseIds: [],
        lastOccurredAt: new Date(0),
      },
    ];
    const snapshot = [...findings];

    rankFindings(findings);

    expect(findings).toEqual(snapshot);
  });
});

describe('isFindingResolved — the detected/practiced/resolved loop', () => {
  it('resolves after 3 consecutive correct answers on questions carrying the tag', () => {
    const responses = sequence([false, true, true, true], {
      tag: 'assignment_vs_comparison',
      distractorTags: ['assignment_vs_comparison'],
    });

    expect(isFindingResolved(responses, 'topic_a', 'assignment_vs_comparison')).toBe(true);
  });

  it('does not resolve at only 2 consecutive correct', () => {
    const responses = sequence([false, true, true], {
      tag: 'assignment_vs_comparison',
      distractorTags: ['assignment_vs_comparison'],
    });

    expect(isFindingResolved(responses, 'topic_a', 'assignment_vs_comparison')).toBe(false);
  });

  it('does not resolve when the streak is broken by a recent error', () => {
    // oldest -> newest: correct, correct, correct, WRONG
    const responses = sequence([true, true, true, false], {
      tag: 'assignment_vs_comparison',
      distractorTags: ['assignment_vs_comparison'],
    });

    expect(isFindingResolved(responses, 'topic_a', 'assignment_vs_comparison')).toBe(false);
  });

  it('only counts questions that actually carried the tag as a distractor', () => {
    const responses = [
      // Three correct answers, but on questions that never offered this tag.
      ...sequence([true, true, true], { distractorTags: ['some_other_tag'] }),
    ];

    expect(isFindingResolved(responses, 'topic_a', 'assignment_vs_comparison')).toBe(false);
  });

  it('is scoped to the topic', () => {
    const responses = sequence([true, true, true], {
      topicId: 'topic_b',
      distractorTags: ['assignment_vs_comparison'],
    });

    expect(isFindingResolved(responses, 'topic_a', 'assignment_vs_comparison')).toBe(false);
  });

  it('returns false with no responses at all', () => {
    expect(isFindingResolved([], 'topic_a', 'any_tag')).toBe(false);
  });
});
