import { describe, expect, it, beforeEach } from 'vitest';
import {
  aiDisclosureSchema,
  learningPlanSchema,
  lessonSchema,
  materialPageSchema,
  materialSchema,
  misconceptionFindingSchema,
  practiceSetResultSchema,
  practiceSetSchema,
  progressOverviewSchema,
  questionFeedbackSchema,
  topicProgressSchema,
  topicSchema,
} from '@educlm/contracts';
import * as store from './store';

/**
 * Every fixture is parsed through the schema the backend publishes.
 *
 * If a fixture stops validating, the contract changed — and this fails now,
 * rather than at integration time on demo night.
 */
describe('mock fixtures satisfy the published contracts', () => {
  beforeEach(() => store.resetStore());

  it('materials', () => {
    // The library starts empty, so the shape worth checking is the one an
    // upload produces — which is now the only material a student can have.
    store.startUpload('photosynthesis.pdf', null, false);

    const materials = store.listMaterials();
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(() => materialSchema.parse(material)).not.toThrow();
    }
  });

  it('an uploaded material resolves to real topics', () => {
    const uploaded = store.startUpload('photosynthesis.pdf', null, false);
    expect(store.listTopics(uploaded.id).length).toBeGreaterThan(0);
  });

  it('topics carry mastery in the contract shape', () => {
    const topics = store.listTopics(store.MATERIAL_ID);
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) {
      expect(() => topicSchema.parse(topic)).not.toThrow();
    }
  });

  it('lessons', () => {
    for (const topic of store.listTopics(store.MATERIAL_ID)) {
      const lesson = store.getLesson(topic.id);
      expect(lesson).not.toBeNull();
      expect(() => lessonSchema.parse(lesson)).not.toThrow();
    }
  });

  it('material pages', () => {
    expect(() => materialPageSchema.parse(store.getPage(17))).not.toThrow();
  });

  it('progress overview', () => {
    const overview = store.progressOverview(store.MATERIAL_ID);
    expect(() => progressOverviewSchema.parse(overview)).not.toThrow();
  });

  it('plan', () => {
    expect(() => learningPlanSchema.parse(store.getPlan())).not.toThrow();
  });

  it('topic progress', () => {
    expect(() => topicProgressSchema.parse(store.topicProgress('topic_conditionals'))).not.toThrow();
  });

  it('practice set, feedback and result', () => {
    const set = store.createPracticeSet({
      materialId: store.MATERIAL_ID,
      kind: 'focused',
      topicId: 'topic_conditionals',
      count: 3,
    });
    expect(() => practiceSetSchema.parse(set)).not.toThrow();

    const question = set.questions[0]!;
    const feedback = store.submitResponse(set.id, {
      questionId: question.id,
      selectedOptionId: question.options[0]!.id,
      timeSpentMs: 4000,
    });
    expect(() => questionFeedbackSchema.parse(feedback)).not.toThrow();

    const result = store.completePracticeSet(set.id);
    expect(() => practiceSetResultSchema.parse(result)).not.toThrow();
  });

  it('the AI disclosure', () => {
    expect(() => aiDisclosureSchema.parse(store.AI_DISCLOSURE)).not.toThrow();
  });
});

/**
 * The demo path in section 14 depends on these exact numbers. The backend seed
 * asserts them too; if the two ever disagree, mock mode would rehearse a
 * different demo from the one that runs live.
 */
describe('the seeded demo state matches the backend seed', () => {
  beforeEach(() => store.resetStore());

  it('ranks Variables strong and Conditionals needs_attention', () => {
    const overview = store.progressOverview(store.MATERIAL_ID);
    const band = (topicId: string) =>
      overview.masteryByTopic.find((topic) => topic.topicId === topicId)?.band;

    expect(band('topic_variables')).toBe('strong');
    expect(band('topic_functions')).toBe('developing');
    expect(band('topic_conditionals')).toBe('needs_attention');
  });

  it('finds the assignment-vs-comparison misconception, 3 times in 5 answers', () => {
    const overview = store.progressOverview(store.MATERIAL_ID);
    const finding = overview.topFinding;

    expect(finding).not.toBeNull();
    expect(() => misconceptionFindingSchema.parse(finding)).not.toThrow();
    expect(finding?.tag).toBe('assignment_vs_comparison');
    expect(finding?.occurrences).toBe(3);
    expect(finding?.windowSize).toBe(5);
    expect(finding?.evidence).toHaveLength(3);
  });

  it('carries the evidence down to a source page and up to a plan change', () => {
    const overview = store.progressOverview(store.MATERIAL_ID);

    for (const item of overview.topFinding?.evidence ?? []) {
      expect(item.sourcePage).toBeGreaterThan(0);
      expect(item.questionStem.length).toBeGreaterThan(0);
      expect(item.correctOptionText.length).toBeGreaterThan(0);
    }

    expect(overview.plan.lastAdaptation?.triggeredByFindingId).toBe(
      overview.topFinding?.id,
    );
    expect(overview.plan.steps.some((step) => step.insertedByAdaptation)).toBe(true);
  });

  it('reverting an adaptation removes the inserted steps', () => {
    const plan = store.revertAdaptation();
    expect(plan.lastAdaptation).toBeNull();
    expect(plan.steps.some((step) => step.insertedByAdaptation)).toBe(false);
    expect(() => learningPlanSchema.parse(plan)).not.toThrow();
  });

  it('dismissing the finding takes it off the overview', () => {
    const before = store.progressOverview(store.MATERIAL_ID).topFinding;
    expect(before).not.toBeNull();

    store.dismissFinding(before!.id);
    expect(store.progressOverview(store.MATERIAL_ID).topFinding).toBeNull();
  });
});
