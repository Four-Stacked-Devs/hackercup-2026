/** The key shapes named in section 6. Nothing builds a key inline. */
export const queryKeys = {
  materials: () => ['materials'] as const,
  material: (id: string) => ['material', id] as const,
  materialStatus: (id: string) => ['material-status', id] as const,
  topics: (materialId: string) => ['topics', materialId] as const,
  lesson: (materialId: string, topicId: string) => ['lesson', materialId, topicId] as const,
  page: (materialId: string, page: number) => ['page', materialId, page] as const,
  chat: (materialId: string) => ['chat', materialId] as const,
  practiceSet: (setId: string) => ['practice-set', setId] as const,
  progress: (materialId: string) => ['progress', materialId] as const,
  topicProgress: (topicId: string) => ['topic-progress', topicId] as const,
  finding: (findingId: string) => ['finding', findingId] as const,
  plan: (materialId: string) => ['plan', materialId] as const,
  me: () => ['me'] as const,
  aiDisclosure: () => ['ai-disclosure'] as const,
  health: () => ['health'] as const,
};
