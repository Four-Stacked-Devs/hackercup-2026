/**
 * Route constants. The frontend imports these instead of hardcoding strings,
 * so a path change is a compile error rather than a 404 at demo time.
 */
export const API_BASE = '/api/v1';

/** Header carrying the anonymous device-scoped session key. Required on every request. */
export const DEVICE_ID_HEADER = 'x-device-id';

export const ROUTES = {
  materials: {
    create: () => `${API_BASE}/materials`,
    list: () => `${API_BASE}/materials`,
    get: (id: string) => `${API_BASE}/materials/${id}`,
    status: (id: string) => `${API_BASE}/materials/${id}/status`,
    remove: (id: string) => `${API_BASE}/materials/${id}`,
    topics: (id: string) => `${API_BASE}/materials/${id}/topics`,
    lesson: (id: string, topicId: string) =>
      `${API_BASE}/materials/${id}/lesson?topicId=${encodeURIComponent(topicId)}`,
    page: (id: string, page: number) => `${API_BASE}/materials/${id}/pages/${page}`,
  },
  chat: {
    send: (id: string) => `${API_BASE}/materials/${id}/chat`,
    messages: (id: string) => `${API_BASE}/materials/${id}/chat/messages`,
    clear: (id: string) => `${API_BASE}/materials/${id}/chat`,
  },
  practice: {
    createSet: () => `${API_BASE}/practice/sets`,
    getSet: (id: string) => `${API_BASE}/practice/sets/${id}`,
    respond: (id: string) => `${API_BASE}/practice/sets/${id}/responses`,
    complete: (id: string) => `${API_BASE}/practice/sets/${id}/complete`,
  },
  progress: {
    overview: (materialId: string) =>
      `${API_BASE}/progress/overview?materialId=${encodeURIComponent(materialId)}`,
    topic: (topicId: string) => `${API_BASE}/progress/topics/${topicId}`,
    finding: (id: string) => `${API_BASE}/progress/findings/${id}`,
    dismissFinding: (id: string) => `${API_BASE}/progress/findings/${id}/dismiss`,
  },
  plan: {
    get: (materialId: string) =>
      `${API_BASE}/plan?materialId=${encodeURIComponent(materialId)}`,
    completeStep: (id: string) => `${API_BASE}/plan/steps/${id}/complete`,
    skipStep: (id: string) => `${API_BASE}/plan/steps/${id}/skip`,
    revertAdaptation: () => `${API_BASE}/plan/revert-adaptation`,
  },
  me: {
    get: () => `${API_BASE}/me`,
    preferences: () => `${API_BASE}/me/preferences`,
  },
  meta: {
    aiDisclosure: () => `${API_BASE}/meta/ai-disclosure`,
    health: () => `${API_BASE}/meta/health`,
  },
} as const;

/** Poll interval the client should use against `materials.status`. */
export const MATERIAL_STATUS_POLL_MS = 1500;
