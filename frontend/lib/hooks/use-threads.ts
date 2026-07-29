'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildThreads, groupThreadsByRecency, type ChatThread } from '../threads';
import { readTopicIndex, recordMessageTopics } from '../thread-index';
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

  // The index lives outside React, so a write needs an explicit nudge to
  // re-derive. `version` is that nudge.
  const [version, setVersion] = useState(0);
  const [topicOf, setTopicOf] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    setTopicOf(materialId ? readTopicIndex(materialId) : {});
  }, [materialId, version]);

  const threads = useMemo(
    () => buildThreads(messages.data ?? [], topicOf, topics.data ?? []),
    [messages.data, topicOf, topics.data],
  );

  const record = useCallback(
    (topicId: string | null | undefined, messageIds: readonly string[]) => {
      if (!materialId) return;
      recordMessageTopics(materialId, topicId, messageIds);
      setVersion((current) => current + 1);
    },
    [materialId],
  );

  return {
    threads,
    record,
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
