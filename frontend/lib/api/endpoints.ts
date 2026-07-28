import {
  ROUTES,
  aiDisclosureSchema,
  accessibilityPreferencesSchema,
  chatClearedResponseSchema,
  chatMessageSchema,
  deletedResponseSchema,
  learningPlanSchema,
  lessonSchema,
  materialPageSchema,
  materialSchema,
  materialStatusResponseSchema,
  meSchema,
  misconceptionFindingSchema,
  practiceSetResultSchema,
  practiceSetSchema,
  progressOverviewSchema,
  questionFeedbackSchema,
  topicProgressSchema,
  topicSchema,
  type AccessibilityPreferences,
  type AiDisclosure,
  type ChatMessage,
  type CreatePracticeSetRequest,
  type LearningPlan,
  type Lesson,
  type Material,
  type MaterialPage,
  type MaterialStatusResponse,
  type Me,
  type MisconceptionFinding,
  type PracticeSet,
  type PracticeSetResult,
  type ProgressOverview,
  type QuestionFeedback,
  type SubmitResponseRequest,
  type Topic,
  type TopicProgress,
  type UpdatePreferencesRequest,
} from '@educlm/contracts';
import { z } from 'zod';
import { apiRequest } from './client';

/**
 * One function per endpoint in section 6, each parsing its response through the
 * schema the backend publishes.
 */

// ── Materials ────────────────────────────────────────────────────────────────

export function listMaterials(signal?: AbortSignal): Promise<Material[]> {
  return apiRequest(ROUTES.materials.list(), { schema: z.array(materialSchema), signal });
}

export function getMaterial(id: string, signal?: AbortSignal): Promise<Material> {
  return apiRequest(ROUTES.materials.get(id), { schema: materialSchema, signal });
}

export function createMaterial(file: File, title?: string): Promise<Material> {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);

  return apiRequest(ROUTES.materials.create(), {
    method: 'POST',
    body: form,
    schema: materialSchema,
  });
}

export function getMaterialStatus(
  id: string,
  signal?: AbortSignal,
): Promise<MaterialStatusResponse> {
  return apiRequest(ROUTES.materials.status(id), {
    schema: materialStatusResponseSchema,
    signal,
  });
}

export function deleteMaterial(id: string): Promise<{ deleted: true }> {
  return apiRequest(ROUTES.materials.remove(id), {
    method: 'DELETE',
    schema: deletedResponseSchema,
  });
}

export function listTopics(materialId: string, signal?: AbortSignal): Promise<Topic[]> {
  return apiRequest(ROUTES.materials.topics(materialId), {
    schema: z.array(topicSchema),
    signal,
  });
}

export function getLesson(
  materialId: string,
  topicId: string,
  signal?: AbortSignal,
): Promise<Lesson> {
  return apiRequest(ROUTES.materials.lesson(materialId, topicId), {
    schema: lessonSchema,
    signal,
  });
}

export function getMaterialPage(
  materialId: string,
  page: number,
  signal?: AbortSignal,
): Promise<MaterialPage> {
  return apiRequest(ROUTES.materials.page(materialId, page), {
    schema: materialPageSchema,
    signal,
  });
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export function listChatMessages(
  materialId: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  return apiRequest(ROUTES.chat.messages(materialId), {
    schema: z.array(chatMessageSchema),
    signal,
  });
}

export function clearChat(materialId: string): Promise<{ cleared: true }> {
  return apiRequest(ROUTES.chat.clear(materialId), {
    method: 'DELETE',
    schema: chatClearedResponseSchema,
  });
}

// The streaming send lives in chat-stream.ts — it needs the raw response body.

// ── Practice ─────────────────────────────────────────────────────────────────

export function createPracticeSet(body: CreatePracticeSetRequest): Promise<PracticeSet> {
  return apiRequest(ROUTES.practice.createSet(), {
    method: 'POST',
    body,
    schema: practiceSetSchema,
  });
}

export function getPracticeSet(id: string, signal?: AbortSignal): Promise<PracticeSet> {
  return apiRequest(ROUTES.practice.getSet(id), { schema: practiceSetSchema, signal });
}

export function submitResponse(
  setId: string,
  body: SubmitResponseRequest,
): Promise<QuestionFeedback> {
  return apiRequest(ROUTES.practice.respond(setId), {
    method: 'POST',
    body,
    schema: questionFeedbackSchema,
  });
}

export function completePracticeSet(setId: string): Promise<PracticeSetResult> {
  return apiRequest(ROUTES.practice.complete(setId), {
    method: 'POST',
    schema: practiceSetResultSchema,
  });
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function getProgressOverview(
  materialId: string,
  signal?: AbortSignal,
): Promise<ProgressOverview> {
  return apiRequest(ROUTES.progress.overview(materialId), {
    schema: progressOverviewSchema,
    signal,
  });
}

export function getTopicProgress(
  topicId: string,
  signal?: AbortSignal,
): Promise<TopicProgress> {
  return apiRequest(ROUTES.progress.topic(topicId), {
    schema: topicProgressSchema,
    signal,
  });
}

export function getFinding(
  id: string,
  signal?: AbortSignal,
): Promise<MisconceptionFinding> {
  return apiRequest(ROUTES.progress.finding(id), {
    schema: misconceptionFindingSchema,
    signal,
  });
}

export function dismissFinding(id: string): Promise<MisconceptionFinding> {
  return apiRequest(ROUTES.progress.dismissFinding(id), {
    method: 'POST',
    schema: misconceptionFindingSchema,
  });
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export function getPlan(materialId: string, signal?: AbortSignal): Promise<LearningPlan> {
  return apiRequest(ROUTES.plan.get(materialId), { schema: learningPlanSchema, signal });
}

export function completePlanStep(stepId: string): Promise<LearningPlan> {
  return apiRequest(ROUTES.plan.completeStep(stepId), {
    method: 'POST',
    schema: learningPlanSchema,
  });
}

export function skipPlanStep(stepId: string): Promise<LearningPlan> {
  return apiRequest(ROUTES.plan.skipStep(stepId), {
    method: 'POST',
    schema: learningPlanSchema,
  });
}

export function revertAdaptation(materialId: string): Promise<LearningPlan> {
  return apiRequest(ROUTES.plan.revertAdaptation(), {
    method: 'POST',
    body: { materialId },
    schema: learningPlanSchema,
  });
}

// ── Me ───────────────────────────────────────────────────────────────────────

export function getMe(signal?: AbortSignal): Promise<Me> {
  return apiRequest(ROUTES.me.get(), { schema: meSchema, signal });
}

export function updatePreferences(
  body: UpdatePreferencesRequest,
): Promise<AccessibilityPreferences> {
  return apiRequest(ROUTES.me.preferences(), {
    method: 'PATCH',
    body,
    schema: accessibilityPreferencesSchema,
  });
}

// ── Meta ─────────────────────────────────────────────────────────────────────

export function getAiDisclosure(signal?: AbortSignal): Promise<AiDisclosure> {
  return apiRequest(ROUTES.meta.aiDisclosure(), { schema: aiDisclosureSchema, signal });
}

/**
 * Health backs the "Agent online / offline" indicator in the header. The
 * contract package does not publish its shape, so this is the one response the
 * client passes through unvalidated — nothing is rendered from it beyond the
 * fact that the call succeeded.
 */
export interface ApiHealth {
  status: 'ok';
  mode: { database: string; llm: string; embeddings: string };
}

export function getHealth(signal?: AbortSignal): Promise<ApiHealth> {
  return apiRequest<ApiHealth>(ROUTES.meta.health(), { signal });
}
