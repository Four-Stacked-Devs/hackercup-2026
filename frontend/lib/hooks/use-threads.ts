'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildThreads, groupThreadsByRecency, type ChatThread } from '../threads';
import {
  indexRevision,
  readConversationIndex,
  readTopicIndex,
  recordMessageConversation,
  recordMessageTopics,
  subscribeToIndex,
} from '../thread-index';
import { useChatMessages, useTopics } from './use-study';

/**
 * The sidebar's thread list.
 *
 * Reads the material's log and topics from the API and the message -> topic
 * association from local storage, then hands back threads plus a recorder the
 * chat stream calls as messages are created.
 */
export function useThreads(materialId: string | null) {
  const messages = useChatMessages(materialId);
  const topics = useTopics(materialId);

  // The index lives outside React. Subscribing rather than holding a local
  // counter means every consumer — the rail and the workspace both call this —
  // re-derives from the same write.
  const revision = useSyncExternalStore(subscribeToIndex, indexRevision, () => 0);

  // Read in an effect, not during render: the server has no localStorage, and
  // reading it while rendering would hydrate against a different value.
  const [topicOf, setTopicOf] = useState<Readonly<Record<string, string>>>({});
  const [conversationOf, setConversationOf] = useState<Readonly<Record<string, string>>>(
    {},
  );

  useEffect(() => {
    setTopicOf(materialId ? readTopicIndex(materialId) : {});
    setConversationOf(materialId ? readConversationIndex(materialId) : {});
  }, [materialId, revision]);

  const threads = useMemo(
    () => buildThreads(messages.data ?? [], topicOf, topics.data ?? [], conversationOf),
    [messages.data, topicOf, topics.data, conversationOf],
  );

  // No manual nudge: recording writes the index, which notifies every consumer.
  const record = useCallback(
    (topicId: string | null | undefined, messageIds: readonly string[]) => {
      if (!materialId) return;
      recordMessageTopics(materialId, topicId, messageIds);
    },
    [materialId],
  );

  const recordConversation = useCallback(
    (conversationId: string | null | undefined, messageIds: readonly string[]) => {
      if (!materialId) return;
      recordMessageConversation(materialId, conversationId, messageIds);
    },
    [materialId],
  );

  return {
    threads,
    record,
    recordConversation,
    isPending: messages.isPending || topics.isPending,
    isError: messages.isError,
    error: messages.error,
    refetch: () => void messages.refetch(),
  };
}

/**
 * Date-bucketed view of the threads. The clock is read once per render here
 * rather than inside the pure grouping function.
 */
export function useThreadGroups(threads: readonly ChatThread[]) {
  return useMemo(() => groupThreadsByRecency(threads, new Date()), [threads]);
}
