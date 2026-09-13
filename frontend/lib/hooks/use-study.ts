'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
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
import { forgetMaterial } from '../thread-index';

export function useTopics(materialId: string | null) {
  return useQuery({
    queryKey: queryKeys.topics(materialId ?? 'none'),
    queryFn: ({ signal }) => listTopics(materialId as string, signal),
    enabled: Boolean(materialId),
  });
}

/** How often an open draft checks whether its study notes have landed. */
const LESSON_DRAFT_POLL_MS = 3_000;

export function useLesson(materialId: string | null, topicId: string | null) {
  return useQuery({
    queryKey: queryKeys.lesson(materialId ?? 'none', topicId ?? 'none'),
    queryFn: ({ signal }) => getLesson(materialId as string, topicId as string, signal),
    enabled: Boolean(materialId && topicId),
    // A draft is replaced in place once its study notes are written, so keep
    // asking while the student reads it. Opening it also moves it to the front
    // of the server's queue.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'draft' || status === 'writing' ? LESSON_DRAFT_POLL_MS : false;
    },
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

/** What the API returns per request when we do not ask for something else. */
const CHAT_PAGE_SIZE = 50;

/**
 * The material's log, oldest-first, in pages.
 *
 * Paginated rather than capped: the endpoint returns the newest `limit`
 * messages, so a single request quietly dropped everything older — and the
 * sidebar derives every thread from this array, so those threads vanished with
 * it. `before` walks backwards from the oldest message already held.
 *
 * `data` stays a flat `ChatMessage[]` so callers read it the way they always
 * have; `fetchOlder` and `hasOlder` are there for the ones that need more.
 */
export function useChatMessages(materialId: string | null) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.chat(materialId ?? 'none'),
    queryFn: ({ pageParam, signal }) =>
      listChatMessages(
        materialId as string,
        { limit: CHAT_PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) },
        signal,
      ),
    initialPageParam: null as string | null,
    // A short page means the log is exhausted. Otherwise continue from the
    // oldest message in it — `before` is exclusive, so nothing repeats.
    getNextPageParam: (lastPage: ChatMessage[]) =>
      lastPage.length < CHAT_PAGE_SIZE ? undefined : (lastPage[0]?.createdAt ?? undefined),
    enabled: Boolean(materialId),
  });

  // Page 0 is the newest block, each block already oldest-first — so the pages
  // read newest-block-first and have to be reversed to make one ordered log.
  const data = useMemo(
    () => (query.data?.pages ?? []).slice().reverse().flat(),
    [query.data],
  );

  return {
    data,
    isLoading: query.isLoading,
    isSettled: query.isSuccess,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    fetchOlder: query.fetchNextPage,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
  };
}

export function useClearChat(materialId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearChat(materialId),
    onSuccess: () => {
      // An infinite query's cache entry is `{ pages, pageParams }` — writing a
      // bare array here would leave the hook reading `undefined.pages`.
      queryClient.setQueryData<InfiniteData<ChatMessage[], string | null>>(
        queryKeys.chat(materialId),
        { pages: [[]], pageParams: [null] },
      );
      // The index maps message ids that no longer exist. Left behind it only
      // grows, and it is the fallback grouping for pre-migration messages — so it
      // has to go when the messages do.
      forgetMaterial(materialId);
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
export interface ChatStreamOptions {
  /**
   * Called with the assistant message the stream settled on. The sidebar uses
   * it to record which topic the exchange belonged to — the API does not
   * return `topicId` on a message, so this is the only moment that is known.
   */
  onAssistantMessage?: (message: ChatMessage, topicId: string | null) => void;
}

export function useChatStream(materialId: string | null, options: ChatStreamOptions = {}) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const onAssistantMessage = options.onAssistantMessage;

  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<StreamingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (message: string, topicId?: string, conversationId?: string) => {
      if (!materialId || !message.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setPendingQuestion(message);
      setAnswer({ content: '', citations: [] });

      void streamChatMessage(
        {
          materialId,
          message,
          ...(topicId ? { topicId } : {}),
          ...(conversationId ? { conversationId } : {}),
          signal: controller.signal,
        },
        {
          onToken: (text) =>
            setAnswer((current) => ({
              content: (current?.content ?? '') + text,
              citations: current?.citations ?? [],
            })),
          onCitations: (citations) =>
            setAnswer((current) => ({ content: current?.content ?? '', citations })),
          onDone: (assistantMessage) => {
            onAssistantMessage?.(assistantMessage, topicId ?? null);

            // The server persisted both turns. Hold the streamed answer and the
            // optimistic question on screen until the refetch has landed —
            // clearing them first blanks the exchange for a frame.
            void queryClient
              .invalidateQueries({ queryKey: queryKeys.chat(materialId) })
              .finally(() => {
                setPendingQuestion(null);
                setAnswer(null);
              });
          },
          onError: (streamError) => {
            setError(streamError.message);
            setAnswer(null);

            // The server writes the question before it starts answering, so a
            // failed stream still left a turn in the log. Clearing the optimistic
            // copy and refetching shows what was actually saved, instead of a
            // question rendered as though it had gone through cleanly.
            setPendingQuestion(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat(materialId) });
          },
        },
      );
    },
    [materialId, queryClient, onAssistantMessage],
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
