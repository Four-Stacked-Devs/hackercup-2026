import 'dotenv/config';
import { DEFAULT_PREFERENCES } from '@educlm/contracts';
import { closeDb, initDb } from '../src/db/client.js';
import { chunkPages } from '../src/modules/ingestion/chunk.js';
import { classifySection } from '../src/modules/ingestion/lessons.js';
import { computeTopicMastery, detectFindingsForTopic } from '../src/modules/analytics/index.js';
import { getEmbedder, toVectorLiteral } from '../src/lib/embeddings.js';
import { DEMO_MATERIAL, DEMO_TOPICS, DEMO_VOCABULARY } from './seed-content.js';
import { DEMO_QUESTIONS } from './seed-questions.js';

/**
 * Seed for the section 12 demo path.
 *
 * Fixed ids so mock mode and live mode look identical to the frontend.
 * Timestamps are relative to now so the trend chart shows recent activity.
 *
 * The response history below is not hand-labelled: it is constructed so that
 * the REAL analytics functions compute the bands section 12 asks for. The
 * assertions at the end fail the seed if that ever stops being true.
 */

const DEVICE_ID = 'demo-device';
const MODEL_LABEL = 'seed-fixture';

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number, hourOffset = 0): Date {
  return new Date(Date.now() - days * DAY + hourOffset * 60 * 60 * 1000);
}

/**
 * Answer histories, oldest -> newest.
 *
 * Chosen so the recency-weighted formula lands on:
 *   Variables    all correct                 -> score 1.00  -> strong
 *   Functions    T,F,T,F,T,T                 -> score ~0.70 -> developing
 *   Conditionals F,F,T,F,T,F                 -> score ~0.35 -> needs_attention
 *                and the 5-response detection window holds three
 *                assignment_vs_comparison errors.
 */
const HISTORY: {
  topicId: string;
  questionIds: string[];
  results: boolean[];
  /** Tag to select when the answer is wrong, per wrong answer in order. */
  wrongTags: string[];
  startDaysAgo: number;
}[] = [
  {
    topicId: 'topic_variables',
    questionIds: [
      'q_variables_1',
      'q_variables_2',
      'q_variables_3',
      'q_variables_4',
      'q_variables_5',
      'q_variables_6',
    ],
    results: [true, true, true, true, true, true],
    wrongTags: [],
    startDaysAgo: 4,
  },
  {
    topicId: 'topic_functions',
    questionIds: [
      'q_functions_1',
      'q_functions_2',
      'q_functions_3',
      'q_functions_4',
      'q_functions_5',
      'q_functions_6',
    ],
    results: [true, false, true, false, true, true],
    // Two different tags, so neither reaches the threshold of 2 — Functions is
    // "developing" without a finding, which keeps the demo's one finding clear.
    wrongTags: ['scope_confusion', 'truthy_falsy'],
    startDaysAgo: 2,
  },
  {
    topicId: 'topic_conditionals',
    // Order matters. The three wrong answers inside the 5-response detection
    // window must land on questions that actually OFFER an
    // assignment_vs_comparison distractor (q1-q4); q5 and q6 are about
    // truthy/falsy and have none, so a wrong answer there would be tagged
    // differently and the finding would only reach 2 occurrences.
    questionIds: [
      'q_conditionals_4',
      'q_conditionals_1',
      'q_conditionals_5',
      'q_conditionals_2',
      'q_conditionals_6',
      'q_conditionals_3',
    ],
    results: [false, false, true, false, true, false],
    wrongTags: [
      'assignment_vs_comparison',
      'assignment_vs_comparison',
      'assignment_vs_comparison',
      'assignment_vs_comparison',
    ],
    startDaysAgo: 1,
  },
];

async function main(): Promise<void> {
  const logger = {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
  };

  const db = await initDb(logger);

  console.log('[seed] resetting demo data');

  const user = await db.user.upsert({
    where: { deviceId: DEVICE_ID },
    update: {},
    create: { deviceId: DEVICE_ID, displayName: 'Demo Student', preferences: DEFAULT_PREFERENCES },
  });

  // Cascades remove chunks, topics, questions, responses, plan and chat.
  await db.material.deleteMany({ where: { id: DEMO_MATERIAL.id } });

  // ── Material ───────────────────────────────────────────────────────────────
  await db.material.create({
    data: {
      id: DEMO_MATERIAL.id,
      userId: user.id,
      title: DEMO_MATERIAL.title,
      originalFilename: DEMO_MATERIAL.filename,
      mimeType: 'application/pdf',
      sizeBytes: 1_482_112,
      storageKey: `${user.id}/seed/${DEMO_MATERIAL.filename}`,
      contentHash: null,
      status: 'READY',
      stage: 'DONE',
      stagePercent: 100,
      pageCount: DEMO_MATERIAL.pageCount,
      createdAt: daysAgo(5),
    },
  });

  // ── Pages ──────────────────────────────────────────────────────────────────
  const pageTexts: string[] = Array.from({ length: DEMO_MATERIAL.pageCount }, () => '');

  for (const topic of DEMO_TOPICS) {
    topic.pages.forEach((page, index) => {
      const pageNumber = topic.firstPage + index;
      pageTexts[pageNumber - 1] = `${page.heading}\n\n${page.body}`;
    });
  }

  await db.pageText.createMany({
    data: pageTexts.map((text, index) => ({
      materialId: DEMO_MATERIAL.id,
      page: index + 1,
      text,
    })),
  });

  // ── Chunks (via the real chunker) ──────────────────────────────────────────
  const drafts = chunkPages(pageTexts);
  await db.chunk.createMany({
    data: drafts.map((chunk) => ({
      materialId: DEMO_MATERIAL.id,
      page: chunk.page,
      orderIndex: chunk.orderIndex,
      content: chunk.content,
      charCount: chunk.charCount,
      sectionTitle: chunk.sectionTitle,
    })),
  });
  console.log(`[seed] ${drafts.length} chunks across ${DEMO_MATERIAL.pageCount} pages`);

  // ── Vocabulary ─────────────────────────────────────────────────────────────
  await db.misconceptionTag.createMany({
    data: DEMO_VOCABULARY.map((entry) => ({ materialId: DEMO_MATERIAL.id, ...entry })),
  });

  // ── Topics + lessons ───────────────────────────────────────────────────────
  const idBySlug = new Map(DEMO_TOPICS.map((t) => [t.slug, t.id]));

  for (const [orderIndex, topic] of DEMO_TOPICS.entries()) {
    const sourcePages = Array.from(
      { length: topic.lastPage - topic.firstPage + 1 },
      (_, i) => topic.firstPage + i,
    );

    await db.topic.create({
      data: {
        id: topic.id,
        materialId: DEMO_MATERIAL.id,
        name: topic.name,
        slug: topic.slug,
        summary: topic.summary,
        orderIndex,
        sourcePages,
        prerequisiteTopicIds: topic.prerequisiteSlugs
          .map((slug) => idBySlug.get(slug))
          .filter((id): id is string => Boolean(id)),
      },
    });

    await db.lessonSection.createMany({
      data: topic.pages.map((page, index) => {
        const { kind, needsReview } = classifySection(page.body);
        return {
          topicId: topic.id,
          heading: page.heading,
          level: 2,
          bodyMarkdown: page.body,
          orderIndex: index,
          sourcePages: [topic.firstPage + index],
          kind: kind.toUpperCase() as 'TEXT' | 'TABLE' | 'EQUATION' | 'FIGURE_DESCRIPTION',
          needsReview,
          generatedBy: MODEL_LABEL,
          generatedAt: daysAgo(5),
        };
      }),
    });
  }
  console.log(`[seed] ${DEMO_TOPICS.length} topics with lessons`);

  // ── Questions ──────────────────────────────────────────────────────────────
  const chunkByPage = new Map<number, string>();
  for (const chunk of await db.chunk.findMany({ where: { materialId: DEMO_MATERIAL.id } })) {
    if (!chunkByPage.has(chunk.page)) chunkByPage.set(chunk.page, chunk.id);
  }

  for (const question of DEMO_QUESTIONS) {
    const created = await db.question.create({
      data: {
        id: question.id,
        materialId: DEMO_MATERIAL.id,
        topicId: question.topicId,
        stem: question.stem,
        difficulty: question.difficulty.toUpperCase() as
          | 'BEGINNER'
          | 'INTERMEDIATE'
          | 'ADVANCED',
        sourcePage: question.page,
        sourceChunkId: chunkByPage.get(question.page) ?? null,
        correctOptionId: 'pending',
        explanation: question.explanation,
        generatedBy: MODEL_LABEL,
        createdAt: daysAgo(5),
        options: {
          create: question.options.map((option) => ({
            id: `opt_${question.id}_${option.label.toLowerCase()}`,
            label: option.label,
            text: option.text,
            misconceptionTag: option.tag,
          })),
        },
      },
      include: { options: true },
    });

    const correct = created.options.find((o) => o.label === question.correct);
    if (!correct) throw new Error(`${question.id}: no option labelled ${question.correct}`);

    await db.question.update({
      where: { id: created.id },
      data: { correctOptionId: correct.id },
    });
  }
  console.log(`[seed] ${DEMO_QUESTIONS.length} questions`);

  // ── Practice sets and responses ────────────────────────────────────────────
  const questionRows = await db.question.findMany({
    where: { materialId: DEMO_MATERIAL.id },
    include: { options: true },
  });
  const questionById = new Map(questionRows.map((q) => [q.id, q]));

  for (const block of HISTORY) {
    const set = await db.practiceSet.create({
      data: {
        id: `set_${block.topicId}`,
        userId: user.id,
        materialId: DEMO_MATERIAL.id,
        topicId: block.topicId,
        kind: 'DIAGNOSTIC',
        status: 'COMPLETED',
        questionIds: block.questionIds,
        createdAt: daysAgo(block.startDaysAgo, -1),
        completedAt: daysAgo(block.startDaysAgo, 1),
      },
    });

    let wrongIndex = 0;

    for (const [index, isCorrect] of block.results.entries()) {
      const questionId = block.questionIds[index]!;
      const question = questionById.get(questionId);
      if (!question) throw new Error(`missing question ${questionId}`);

      let selected;

      if (isCorrect) {
        selected = question.options.find((o) => o.id === question.correctOptionId);
      } else {
        const wantedTag = block.wrongTags[wrongIndex++];
        selected =
          question.options.find((o) => o.misconceptionTag === wantedTag) ??
          question.options.find((o) => o.misconceptionTag !== null);
      }

      if (!selected) throw new Error(`no option to select for ${questionId}`);

      await db.response.create({
        data: {
          userId: user.id,
          practiceSetId: set.id,
          questionId,
          topicId: block.topicId,
          selectedOptionId: selected.id,
          isCorrect,
          misconceptionTag: selected.misconceptionTag,
          timeSpentMs: 12_000 + index * 1_500,
          attemptNumber: 1,
          // Spread through the day so the trend has a real shape.
          answeredAt: daysAgo(block.startDaysAgo, index * 0.4),
        },
      });
    }
  }
  console.log('[seed] response history written');

  // ── The finding, computed rather than asserted ─────────────────────────────
  const responsesForAnalytics = (
    await db.response.findMany({
      where: { userId: user.id },
      include: { question: { include: { options: true } } },
      orderBy: { answeredAt: 'asc' },
    })
  ).map((row) => ({
    id: row.id,
    topicId: row.topicId,
    questionId: row.questionId,
    isCorrect: row.isCorrect,
    misconceptionTag: row.misconceptionTag,
    attemptNumber: row.attemptNumber,
    answeredAt: row.answeredAt,
    questionDistractorTags: row.question.options
      .map((o) => o.misconceptionTag)
      .filter((t): t is string => t !== null),
  }));

  const conditionalFindings = detectFindingsForTopic(
    'topic_conditionals',
    responsesForAnalytics,
  );
  const avc = conditionalFindings.find((f) => f.tag === 'assignment_vs_comparison');
  if (!avc) throw new Error('seed did not produce the assignment_vs_comparison finding');

  // Section 12 is specific: 3 occurrences in a 5-response window. If the
  // history or the questions drift, fail loudly rather than shipping a demo
  // that quietly says something else.
  if (avc.occurrences !== 3 || avc.windowSize !== 5) {
    throw new Error(
      `[seed] expected 3 occurrences in a window of 5, computed ${avc.occurrences} in ${avc.windowSize}`,
    );
  }

  const vocab = DEMO_VOCABULARY.find((v) => v.tag === 'assignment_vs_comparison')!;

  await db.misconceptionFinding.create({
    data: {
      id: 'finding_conditionals_avc',
      userId: user.id,
      topicId: 'topic_conditionals',
      tag: avc.tag,
      label: vocab.label,
      description: vocab.description,
      occurrences: avc.occurrences,
      windowSize: avc.windowSize,
      evidenceResponseIds: avc.evidenceResponseIds,
      status: 'ACTIVE',
      detectedAt: daysAgo(1, 2),
    },
  });
  console.log(
    `[seed] finding: ${avc.occurrences} occurrences in a window of ${avc.windowSize}`,
  );

  // ── Plan, with an adaptation already applied ───────────────────────────────
  const plan = await db.learningPlan.create({
    data: {
      id: 'plan_demo_js',
      userId: user.id,
      materialId: DEMO_MATERIAL.id,
      createdAt: daysAgo(5),
    },
  });

  // Everything up to and including Conditionals is done; Loops is next.
  const completedThrough = new Set([
    'topic_variables',
    'topic_data_types',
    'topic_operators',
    'topic_conditionals',
  ]);

  const steps: {
    id: string;
    kind: 'READ' | 'PRACTICE' | 'REVIEW';
    title: string;
    description: string;
    topicId: string;
    targetType: string;
    targetId: string | null;
    minutes: number;
    status: 'COMPLETED' | 'PENDING' | 'ACTIVE';
    inserted: boolean;
  }[] = [];

  for (const topic of DEMO_TOPICS) {
    const done = completedThrough.has(topic.id);
    steps.push({
      id: `step_read_${topic.slug}`,
      kind: 'READ',
      title: `Read: ${topic.name}`,
      description: topic.summary,
      topicId: topic.id,
      targetType: 'lesson',
      targetId: topic.id,
      minutes: 8,
      status: done ? 'COMPLETED' : 'PENDING',
      inserted: false,
    });
    steps.push({
      id: `step_practice_${topic.slug}`,
      kind: 'PRACTICE',
      title: `Practise: ${topic.name}`,
      description: `A short set of questions on ${topic.name}.`,
      topicId: topic.id,
      targetType: 'practice_set',
      targetId: null,
      minutes: 6,
      status: done ? 'COMPLETED' : 'PENDING',
      inserted: false,
    });
  }

  // The adaptation: review + focused practice on Conditionals, inserted ahead
  // of the next pending step (Read: Loops).
  const insertAt = steps.findIndex((s) => s.status === 'PENDING');
  steps.splice(
    insertAt,
    0,
    {
      id: 'step_adapt_review_conditionals',
      kind: 'REVIEW',
      title: 'Review: Conditionals',
      description:
        'A focused re-read of Conditionals, aimed at confusing assignment with comparison.',
      topicId: 'topic_conditionals',
      targetType: 'lesson',
      targetId: 'topic_conditionals',
      minutes: 6,
      status: 'ACTIVE',
      inserted: true,
    },
    {
      id: 'step_adapt_practice_conditionals',
      kind: 'PRACTICE',
      title: 'Focused practice: Conditionals',
      description:
        '5 questions on Conditionals, weighted toward the ones that trip up confusing assignment with comparison.',
      topicId: 'topic_conditionals',
      targetType: 'practice_set',
      targetId: null,
      minutes: 8,
      status: 'PENDING',
      inserted: true,
    },
  );

  for (const [orderIndex, step] of steps.entries()) {
    await db.planStep.create({
      data: {
        id: step.id,
        planId: plan.id,
        kind: step.kind,
        title: step.title,
        description: step.description,
        topicId: step.topicId,
        targetType: step.targetType,
        targetId: step.targetId,
        estimatedMinutes: step.minutes,
        status: step.status,
        orderIndex,
        insertedByAdaptation: step.inserted,
      },
    });
  }

  await db.learningPlan.update({
    where: { id: plan.id },
    data: {
      currentStepId: 'step_adapt_review_conditionals',
      lastAdaptation: {
        at: daysAgo(1, 2).toISOString(),
        reason: `${vocab.label} in ${avc.occurrences} of your last ${avc.windowSize} answers`,
        triggeredByFindingId: 'finding_conditionals_avc',
        previousStepTitle: 'Read: Loops',
        newStepTitle: 'Review: Conditionals',
      },
    },
  });
  console.log(`[seed] plan with ${steps.length} steps, adaptation applied`);

  // ── Embeddings ─────────────────────────────────────────────────────────────
  if (process.env['SEED_SKIP_EMBEDDINGS'] === '1') {
    console.log('[seed] skipping embeddings (SEED_SKIP_EMBEDDINGS=1)');
  } else {
    await embedSeedChunks(db, logger);
  }

  // ── Verify the demo actually computes what section 12 promises ─────────────
  assertBand('topic_variables', 'strong', responsesForAnalytics);
  assertBand('topic_functions', 'developing', responsesForAnalytics);
  assertBand('topic_conditionals', 'needs_attention', responsesForAnalytics);

  console.log('\n[seed] done. Demo device id: "demo-device"');
}

function assertBand(
  topicId: string,
  expected: string,
  responses: Parameters<typeof computeTopicMastery>[1],
): void {
  const mastery = computeTopicMastery(topicId, responses);
  if (mastery.band !== expected) {
    throw new Error(
      `[seed] ${topicId} computed band "${mastery.band}" (score ${mastery.score?.toFixed(3)}) but section 12 requires "${expected}"`,
    );
  }
  console.log(
    `[seed] ✓ ${topicId}: ${mastery.band} (score ${mastery.score?.toFixed(2)}, ${mastery.confidence} confidence)`,
  );
}

async function embedSeedChunks(
  db: Awaited<ReturnType<typeof initDb>>,
  logger: { warn: (m: string) => void; info: (m: string) => void },
): Promise<void> {
  const chunks = await db.chunk.findMany({
    where: { materialId: DEMO_MATERIAL.id },
    orderBy: { orderIndex: 'asc' },
  });

  logger.info(`[seed] embedding ${chunks.length} chunks (first run downloads the model)`);

  try {
    const embedder = getEmbedder();
    const batchSize = 32;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await embedder.embed(batch.map((c) => c.content));

      for (const [index, chunk] of batch.entries()) {
        const vector = vectors[index];
        if (!vector) continue;
        await db.$executeRawUnsafe(
          `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
          toVectorLiteral(vector),
          chunk.id,
        );
      }
    }

    logger.info('[seed] embeddings written');
  } catch (error) {
    logger.warn(
      `[seed] embedding failed (${(error as Error).message}). Chat will fall back to keyword search.`,
    );
  }
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  })
  .finally(() => closeDb());
