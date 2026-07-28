import {
  ROUTES,
  apiErrorSchema,
  sseCitationsEventSchema,
  sseDoneEventSchema,
  sseErrorEventSchema,
  sseTokenEventSchema,
  type ApiErrorCode,
  type ChatMessage,
  type Citation,
} from '@educlm/contracts';
import { apiUrl, requestHeaders } from './client';

export interface ChatStreamHandlers {
  onToken: (text: string) => void;
  /** Always fires before onDone, so source chips appear as the answer settles. */
  onCitations: (citations: Citation[]) => void;
  onDone: (message: ChatMessage) => void;
  onError: (error: { code: ApiErrorCode; message: string }) => void;
}

export interface ChatStreamRequest {
  materialId: string;
  message: string;
  topicId?: string;
  signal?: AbortSignal;
}

/**
 * POST + SSE. EventSource cannot POST, so the stream is read off the response
 * body and framed by hand: `event: <name>\ndata: <json>\n\n`.
 */
export async function streamChatMessage(
  { materialId, message, topicId, signal }: ChatStreamRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const headers = requestHeaders({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  });

  let response: Response;
  try {
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, topicId, stream: true }),
    };
    if (signal) init.signal = signal;

    response = await fetch(apiUrl(ROUTES.chat.send(materialId)), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    handlers.onError({
      code: 'INTERNAL_ERROR',
      message: "EducLM couldn't reach the server. Check your connection and try again.",
    });
    return;
  }

  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(payload);
    handlers.onError(
      parsed.success
        ? { code: parsed.data.error.code, message: parsed.data.error.message }
        : { code: 'INTERNAL_ERROR', message: 'The tutor could not answer just now.' },
    );
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary), handlers);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    handlers.onError({
      code: 'INTERNAL_ERROR',
      message: 'The answer stopped part-way. Please ask again.',
    });
  } finally {
    reader.releaseLock();
  }
}

function dispatch(frame: string, handlers: ChatStreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  switch (event) {
    case 'token': {
      const parsed = sseTokenEventSchema.safeParse(payload);
      if (parsed.success) handlers.onToken(parsed.data.text);
      return;
    }
    case 'citations': {
      const parsed = sseCitationsEventSchema.safeParse(payload);
      if (parsed.success) handlers.onCitations(parsed.data.citations);
      return;
    }
    case 'done': {
      const parsed = sseDoneEventSchema.safeParse(payload);
      if (parsed.success) handlers.onDone(parsed.data.message);
      return;
    }
    case 'error': {
      const parsed = sseErrorEventSchema.safeParse(payload);
      handlers.onError(
        parsed.success
          ? { code: parsed.data.code, message: parsed.data.message }
          : { code: 'INTERNAL_ERROR', message: 'The tutor stopped mid-answer.' },
      );
      return;
    }
    default:
      return;
  }
}
