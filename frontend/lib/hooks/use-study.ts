'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, Citation } from '@educlm/contracts';
import {
  clearChat,
  getLesson,
  getMaterialPage,
  listChatMessages,
  listTopics,
} from '../api/endpoints';
import { streamChatMessage } from '../api/chat-stream';
import { queryKeys } from '../query-keys';

export function useTopics(materialId: string | null) {
  return useQuery({
    queryKey: queryKeys.topics(materialId ?? 'none'),
    queryFn: ({ signal }) => listTopics(materialId as string, signal),
    enabled: Boolean(materialId),
  });
}

export function useLesson(materialId: string | null, topicId: string | null) {
  return useQuery({
    queryKey: queryKeys.lesson(materialId ?? 'none', topicId ?? 'none'),
    queryFn: ({ signal }) => getLesson(materialId as string, topicId as string, signal),
    enabled: Boolean(materialId && topicId),
  });
}

/** The source viewer is opened on demand, so the page is only fetched then. */
export function useMaterialPage(materialId: string | null, page: number | null) {
  return useQuery({
    queryKey: queryKeys.page(materialId ?? 'none', page ?? 0),
    queryFn: ({ signal }) => getMaterialPage(materialId as string, page as number, signal),
    enabled: Boolean(materialId && page),
  });
}

export function useChatMessages(materialId: string | null) {
  return useQuery({
    queryKey: queryKeys.chat(materialId ?? 'none'),
    queryFn: ({ signal }) => listChatMessages(materialId as string, signal),
    enabled: Boolean(materialId),
  });
}

export function useClearChat(materialId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearChat(materialId),
    onSuccess: () => {
      queryClient.setQueryData<ChatMessage[]>(queryKeys.chat(materialId), []);
    },
  });
}

export interface StreamingAnswer {
  content: string;
  citations: Citation[];
}

/**
 * Owns the streaming half of the agent panel: the optimistic user message, the
 * answer as it arrives token by token, and the citations that land just before
 * the stream closes. Settled messages live in the query cache.
 */
export function useChatStream(materialId: string | null) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<StreamingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (message: string, topicId?: string) => {
      if (!materialId || !message.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setPendingQuestion(message);
      setAnswer({ content: '', citations: [] });

      void streamChatMessage(
        { materialId, message, ...(topicId ? { topicId } : {}), signal: controller.signal },
        {
          onToken: (text) =>
            setAnswer((current) => ({
              content: (current?.content ?? '') + text,
              citations: current?.citations ?? [],
            })),
          onCitations: (citations) =>
            setAnswer((current) => ({ content: current?.content ?? '', citations })),
          onDone: (assistantMessage) => {
            // The server persisted both turns; refetch so the panel shows
            // exactly what a reload would show.
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat(materialId) });
            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.chat(materialId),
              (current) => [...(current ?? []), assistantMessage],
            );
            setPendingQuestion(null);
            setAnswer(null);
          },
          onError: (streamError) => {
            setError(streamError.message);
            setAnswer(null);
          },
        },
      );
    },
    [materialId, queryClient],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setPendingQuestion(null);
    setAnswer(null);
  }, []);

  return {
    send,
    stop,
    pendingQuestion,
    answer,
    error,
    isStreaming: answer !== null,
    dismissError: () => setError(null),
  };
}
