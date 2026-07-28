import type { MisconceptionFinding } from '@educlm/contracts';
import { db } from '../db/client.js';
import {
  computeMasteryByTopic,
  detectFindings,
  isFindingResolved,
  rankFindings,
  type ResponseInput,
} from '../modules/analytics/index.js';
import { toMisconceptionFinding } from '../lib/serializers.js';
import { loadEvidence } from './analytics-data.js';

/**
 * Persisting what the pure engine computed.
 *
 * The engine decides *what* the findings are. This file only writes them down,
 * looks up the human-readable label from the material's stored vocabulary, and
 * closes out findings the student has demonstrably fixed.
 */

export interface SyncResult {
  /** Findings newly created by this sync — surfaced in PracticeSetResult. */
  created: string[];
  resolved: string[];
}

export async function syncFindings(params: {
  userId: string;
  materialId: string;
  responses: ResponseInput[];
  now: Date;
}): Promise<SyncResult> {
  const { userId, materialId, responses, now } = params;

  const topics = await db().topic.findMany({ where: { materialId } });
  const topicIds = topics.map((t) => t.id);
  if (topicIds.length === 0) return { created: [], resolved: [] };

  const vocabulary = await db().misconceptionTag.findMany({ where: { materialId } });
  const vocabByTag = new Map(vocabulary.map((v) => [v.tag, v]));

  const detected = detectFindings(responses, topicIds);

  const existing = await db().misconceptionFinding.findMany({
    where: { userId, topicId: { in: topicIds } },
  });

  const created: string[] = [];
  const resolved: string[] = [];

  for (const finding of detected) {
    // A dismissed finding stays dismissed. The student's judgement stands.
    const dismissed = existing.find(
      (e) => e.topicId === finding.topicId && e.tag === finding.tag && e.status === 'DISMISSED',
    );
    if (dismissed) continue;

    const active = existing.find(
      (e) => e.topicId === finding.topicId && e.tag === finding.tag && e.status === 'ACTIVE',
    );

    const vocab = vocabByTag.get(finding.tag);
    const label = vocab?.label ?? humanizeTag(finding.tag);
    const description =
      vocab?.description ?? 'This mistake has come up more than once in your recent answers.';

    if (active) {
      await db().misconceptionFinding.update({
        where: { id: active.id },
        data: {
          occurrences: finding.occurrences,
          windowSize: finding.windowSize,
          evidenceResponseIds: finding.evidenceResponseIds,
          label,
          description,
        },
      });
    } else {
      const row = await db().misconceptionFinding.create({
        data: {
          userId,
          topicId: finding.topicId,
          tag: finding.tag,
          label,
          description,
          occurrences: finding.occurrences,
          windowSize: finding.windowSize,
          evidenceResponseIds: finding.evidenceResponseIds,
          status: 'ACTIVE',
          detectedAt: now,
        },
      });
      created.push(row.id);
    }
  }

  // Close out anything the student has demonstrably fixed.
  for (const row of existing) {
    if (row.status !== 'ACTIVE') continue;
    if (!isFindingResolved(responses, row.topicId, row.tag)) continue;

    await db().misconceptionFinding.update({
      where: { id: row.id },
      data: { status: 'RESOLVED', resolvedAt: now },
    });
    resolved.push(row.id);
  }

  return { created, resolved };
}

/** Findings for a material, ranked, with evidence hydrated. */
export async function listFindings(params: {
  userId: string;
  materialId: string;
  responses: ResponseInput[];
  status?: 'ACTIVE' | 'RESOLVED' | 'DISMISSED';
}): Promise<MisconceptionFinding[]> {
  const { userId, materialId, responses, status = 'ACTIVE' } = params;

  const topics = await db().topic.findMany({ where: { materialId } });
  const topicNames = new Map(topics.map((t) => [t.id, t.name]));

  const rows = await db().misconceptionFinding.findMany({
    where: { userId, topicId: { in: topics.map((t) => t.id) }, status },
  });
  if (rows.length === 0) return [];

  const mastery = computeMasteryByTopic(
    topics.map((t) => t.id),
    responses,
  );

  // Rank with the same pure function the engine uses everywhere else.
  const order = rankFindings(
    rows.map((row) => ({
      topicId: row.topicId,
      tag: row.tag,
      occurrences: row.occurrences,
      windowSize: row.windowSize,
      evidenceResponseIds: row.evidenceResponseIds,
      lastOccurredAt: row.detectedAt,
    })),
    mastery,
  );

  const rowByKey = new Map(rows.map((row) => [`${row.topicId}:${row.tag}`, row]));

  const result: MisconceptionFinding[] = [];
  for (const ranked of order) {
    const row = rowByKey.get(`${ranked.topicId}:${ranked.tag}`);
    if (!row) continue;

    result.push(
      toMisconceptionFinding(
        row,
        topicNames.get(row.topicId) ?? 'Unknown topic',
        await loadEvidence(row.evidenceResponseIds),
      ),
    );
  }

  return result;
}

export async function getFindingById(
  userId: string,
  findingId: string,
): Promise<MisconceptionFinding | null> {
  const row = await db().misconceptionFinding.findFirst({
    where: { id: findingId, userId },
    include: { topic: true },
  });
  if (!row) return null;

  return toMisconceptionFinding(row, row.topic.name, await loadEvidence(row.evidenceResponseIds));
}

/** "assignment_vs_comparison" -> "Assignment vs comparison" */
function humanizeTag(tag: string): string {
  const words = tag.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
