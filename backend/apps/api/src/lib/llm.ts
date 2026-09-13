import {
  generateObject,
  generateText,
  streamText,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import type { z } from 'zod';
import { env, type LlmProvider } from '../env.js';

/**
 * Provider-swappable LLM access.
 *
 * Every call takes a `fallback`. That single mechanism serves two purposes:
 *   1. it IS the stub provider when no API key is configured, and
 *   2. it is the resilience path section 8 requires — "on second failure fall
 *      back to heading-based segmentation so ingestion never hard-fails on an
 *      LLM hiccup".
 *
 * Because the fallback is deterministic and derived from the source text, the
 * pipeline always produces something grounded in the document, never a
 * fabrication and never a 500.
 */

/** An earlier turn of the same conversation, oldest first. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface JsonRequest<T> {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Deterministic, document-derived result used when the model is unavailable. */
  fallback: () => T;
  /** Retries on parse/validation failure before falling back. Default 1. */
  retries?: number;
  maxOutputTokens?: number;
}

export interface TextRequest {
  system: string;
  prompt: string;
  /** Earlier turns, so a follow-up like "explain that more simply" has a referent. */
  history?: ChatTurn[];
  fallback: () => string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * How much the configured provider can take in one call.
 *
 * Free tiers differ by two orders of magnitude: Groq meters ~8K tokens a minute
 * and counts the reserved output against it, while Gemini allows ~250K a
 * minute. One fixed size either starves Gemini of the document or gets every
 * Groq request rejected as too large, so callers size their prompts from this.
 */
export interface LlmBudget {
  /** Characters of source material a single prompt may carry. */
  inputChars: number;
  /** Output ceiling for the largest structured calls (lessons, questions). */
  outputTokens: number;
}

export interface LlmClient {
  /** Model identifier surfaced in `generatedBy` and /meta/ai-disclosure. */
  readonly modelId: string;
  readonly available: boolean;
  readonly budget: LlmBudget;
  generateJson<T>(request: JsonRequest<T>): Promise<{ value: T; usedFallback: boolean }>;
  generateText(request: TextRequest): Promise<{ text: string; usedFallback: boolean }>;
  streamText(request: TextRequest): AsyncIterable<string>;
}

export const STUB_MODEL_ID = 'stub-deterministic';
const CALL_TIMEOUT_MS = 90_000;
/** Transient 429/5xx are retried by the SDK with backoff before we see them. */
const MAX_RETRIES = 3;

const BUDGETS: Record<LlmProvider, LlmBudget> = {
  groq: { inputChars: 12_000, outputTokens: 3_000 },
  google: { inputChars: 60_000, outputTokens: 8_000 },
  openai: { inputChars: 60_000, outputTokens: 8_000 },
  anthropic: { inputChars: 60_000, outputTokens: 8_000 },
  stub: { inputChars: 16_000, outputTokens: 4_000 },
};

export function llmBudget(): LlmBudget {
  return BUDGETS[env.llmProvider];
}

function buildModel(): LanguageModel | null {
  if (env.llmProvider === 'stub') return null;

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;

  switch (env.llmProvider) {
    case 'groq':
      return createGroq({ apiKey })(env.LLM_MODEL);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(env.LLM_MODEL);
    case 'openai':
      return createOpenAI({ apiKey })(env.LLM_MODEL);
    case 'anthropic':
      return createAnthropic({ apiKey })(env.LLM_MODEL);
    default:
      return null;
  }
}

let cachedModel: LanguageModel | null | undefined;

function model(): LanguageModel | null {
  if (cachedModel === undefined) cachedModel = buildModel();
  return cachedModel;
}

/**
 * gpt-oss reasons before it answers, and on Groq those hidden tokens count
 * against both the output cap and the per-minute quota. Low effort is plenty
 * for reformatting and question writing, and keeps lessons from being cut off.
 */
function providerOptions() {
  if (env.llmProvider === 'groq' && env.LLM_MODEL.startsWith('openai/gpt-oss')) {
    return { providerOptions: { groq: { reasoningEffort: 'low' } } };
  }
  return {};
}

function withTimeout<T>(promise: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

// ─── Free-tier pacing ────────────────────────────────────────────────────────

/**
 * A sliding one-minute window over requests and estimated tokens.
 *
 * Ingestion fires a dozen large calls back to back. Sent unpaced, most of them
 * hit the provider's per-minute limit, exhaust their retries, and land on the
 * deterministic fallback — which is how a working key still produces lessons
 * that read like the raw PDF. Waiting our turn is slower but gets real output.
 * Module-level on purpose: every request shares the one quota.
 */
const WINDOW_MS = 60_000;
const recentCalls: { at: number; tokens: number }[] = [];

/**
 * Background work (study notes written after a material is READY) may only
 * fill this share of the window, and waits whenever a foreground call — chat,
 * ingestion, practice — is queued. Without it, a student asking a question
 * right after upload sat behind every lesson still being written.
 */
const BACKGROUND_SHARE = 0.75;
let foregroundWaiting = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveCapacity(estimatedTokens: number, background = false): Promise<void> {
  const { rpm, tpm } = env.llmLimits;
  if (!rpm && !tpm) return;

  if (!background) foregroundWaiting += 1;

  try {
    for (;;) {
      const now = Date.now();
      while (recentCalls.length > 0 && now - recentCalls[0]!.at >= WINDOW_MS) recentCalls.shift();

      const share = background ? BACKGROUND_SHARE : 1;
      const rpmCap = rpm ? Math.max(1, Math.floor(rpm * share)) : undefined;
      const tpmCap = tpm ? tpm * share : undefined;

      const usedTokens = recentCalls.reduce((sum, call) => sum + call.tokens, 0);
      const requestsFit = !rpmCap || recentCalls.length < rpmCap;
      // A request bigger than the whole window can never fit; send it alone
      // rather than waiting forever, and let the provider have the final word.
      const tokensFit =
        !tpmCap || usedTokens + estimatedTokens <= tpmCap || recentCalls.length === 0;
      const yieldToForeground = background && foregroundWaiting > 0;

      if (requestsFit && tokensFit && !yieldToForeground) {
        recentCalls.push({ at: now, tokens: estimatedTokens });
        return;
      }

      const oldest = recentCalls[0];
      await sleep(
        yieldToForeground || !oldest ? 250 : Math.max(50, WINDOW_MS - (now - oldest.at) + 50),
      );
    }
  } finally {
    if (!background) foregroundWaiting -= 1;
  }
}

// ─── Spent-quota circuit breaker ─────────────────────────────────────────────

/**
 * A spent DAILY quota is not a hiccup: every call until the reset fails the
 * same way, after the SDK's retries and ours — about two minutes per call on
 * Groq before the fallback, which a student sees as a quiz or an answer stuck
 * loading. Once the provider says the day's quota is gone, stop calling it
 * until the time it names and go straight to the deterministic fallback.
 *
 * Per-minute limits are deliberately not matched: those clear in seconds, and
 * the pacer and the SDK's backoff already handle them.
 */
const DAILY_QUOTA = /per[\s_-]?day|daily|\bTPD\b|\bRPD\b|PerDay/i;
const DEFAULT_PAUSE_MS = 10 * 60_000;
const MIN_PAUSE_MS = 60_000;
const MAX_PAUSE_MS = 6 * 60 * 60_000;

let pausedUntil = 0;

/** "Please try again in 14m42.144s" → 882144. Null when the text names no delay. */
export function parseRetryDelay(text: string): number | null {
  // `ms` before `m`, or "350ms" reads as 350 minutes.
  const match = /(?:try again|retry) in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)/i.exec(text);
  if (!match) return null;

  const units: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  let total = 0;
  for (const [, value, unit] of match[1]!.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) {
    total += Number(value) * units[unit!.toLowerCase()]!;
  }
  return total > 0 ? Math.round(total) : null;
}

/**
 * A readable reason for a failed call. Some providers answer an error with a
 * status and an empty body — Google's 404 for an unknown model does — which
 * logged as "failed: " and nothing else.
 */
function describeError(error: unknown): string {
  const e = error as { message?: string; statusCode?: number; lastError?: unknown };
  const inner = (e.lastError ?? error) as { message?: string; statusCode?: number };
  const message = (inner.message || e.message || '').trim();
  const status = inner.statusCode ?? e.statusCode;
  if (message) return status ? `${message} (HTTP ${status})` : message;
  return status
    ? `HTTP ${status} with no message — check LLM_MODEL (${env.LLM_MODEL}) and LLM_API_KEY`
    : 'unknown error';
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  // RetryError wraps the provider's error as `lastError`; read both.
  for (let depth = 0; current && depth < 3; depth += 1) {
    const e = current as { message?: unknown; responseBody?: unknown; lastError?: unknown };
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.responseBody === 'string') parts.push(e.responseBody);
    current = e.lastError;
  }
  return parts.join('\n');
}

/** How long to stop calling the provider after this error, or null to keep going. */
export function quotaPauseMs(error: unknown): number | null {
  const text = errorText(error);
  if (!DAILY_QUOTA.test(text)) return null;
  const delay = parseRetryDelay(text) ?? DEFAULT_PAUSE_MS;
  return Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, delay));
}

function providerPaused(): boolean {
  return Date.now() < pausedUntil;
}

/**
 * Milliseconds until the provider may be called again after a spent quota, or
 * 0. Background work waits this out instead of settling for the fallback: a
 * lesson or question bank written from the fallback would be kept for good.
 */
export function providerPausedFor(): number {
  return Math.max(0, pausedUntil - Date.now());
}

/** Record a spent quota. Returns true when this error opened (or extended) the pause. */
function noteQuotaError(error: unknown, logger: LlmLogger): boolean {
  const pause = quotaPauseMs(error);
  if (pause === null) return false;

  const until = Date.now() + pause;
  if (until > pausedUntil) {
    pausedUntil = until;
    logger.warn(
      `[llm] ${env.llmProvider} daily quota is spent; using the deterministic fallback until ${new Date(until).toISOString()}`,
    );
  }
  return true;
}

function estimateTokens(texts: string[], maxOutputTokens: number | undefined): number {
  const inputChars = texts.reduce((sum, text) => sum + text.length, 0);
  return Math.ceil(inputChars / 4) + (maxOutputTokens ?? 1_024);
}

/**
 * History plus the new message, in the strict user/assistant alternation that
 * Gemini and Anthropic require. A turn whose answer failed to save, or a window
 * that starts mid-exchange, would otherwise send two user turns in a row or
 * open on the assistant — and the whole request is rejected for it.
 */
export function toMessages(request: Pick<TextRequest, 'history' | 'prompt'>): ModelMessage[] {
  const turns: ChatTurn[] = [];

  for (const turn of [...(request.history ?? []), { role: 'user' as const, content: request.prompt }]) {
    const previous = turns.at(-1);
    if (previous?.role === turn.role) previous.content = `${previous.content}\n\n${turn.content}`;
    else if (turns.length > 0 || turn.role === 'user') turns.push({ ...turn });
  }

  return turns.map((turn) => ({ role: turn.role, content: turn.content }));
}

function historyText(request: TextRequest): string[] {
  return (request.history ?? []).map((turn) => turn.content);
}

// ─── Client ──────────────────────────────────────────────────────────────────

export interface LlmLogger {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}

const consoleLogger: LlmLogger = {
  warn: (m) => console.warn(m),
  info: () => {},
};

export interface LlmClientOptions {
  /** Yields to foreground calls and leaves them headroom; see BACKGROUND_SHARE. */
  background?: boolean;
}

export function createLlmClient(
  logger: LlmLogger = consoleLogger,
  options: LlmClientOptions = {},
): LlmClient {
  const active = model();
  const background = options.background ?? false;
  const modelId = active ? `${env.llmProvider}:${env.LLM_MODEL}` : STUB_MODEL_ID;

  return {
    modelId,
    available: active !== null,
    budget: llmBudget(),

    async generateJson<T>(request: JsonRequest<T>) {
      if (!active || providerPaused()) return { value: request.fallback(), usedFallback: true };

      const attempts = (request.retries ?? 1) + 1;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const stricter =
            attempt === 0
              ? request.system
              : `${request.system}\n\nYour previous reply did not match the required JSON schema. Reply with valid JSON only — no prose, no code fences.`;

          await reserveCapacity(
            estimateTokens([stricter, request.prompt], request.maxOutputTokens),
            background,
          );

          const result = await withTimeout(
            generateObject({
              model: active,
              schema: request.schema,
              system: stricter,
              prompt: request.prompt,
              maxRetries: MAX_RETRIES,
              ...providerOptions(),
              ...(request.maxOutputTokens
                ? { maxOutputTokens: request.maxOutputTokens }
                : {}),
            }),
          );

          const parsed = request.schema.safeParse(result.object);
          if (parsed.success) return { value: parsed.data, usedFallback: false };

          logger.warn(`[llm] schema validation failed on attempt ${attempt + 1}`);
        } catch (error) {
          logger.warn(
            `[llm] generateJson attempt ${attempt + 1} failed: ${describeError(error)}`,
          );
          // Another attempt would fail the same way until the quota resets.
          if (noteQuotaError(error, logger)) break;
        }
      }

      logger.warn('[llm] falling back to deterministic output');
      return { value: request.fallback(), usedFallback: true };
    },

    async generateText(request: TextRequest) {
      if (!active || providerPaused()) return { text: request.fallback(), usedFallback: true };

      try {
        await reserveCapacity(
          estimateTokens(
            [request.system, request.prompt, ...historyText(request)],
            request.maxOutputTokens,
          ),
          background,
        );

        const result = await withTimeout(
          generateText({
            model: active,
            system: request.system,
            messages: toMessages(request),
            maxRetries: MAX_RETRIES,
            ...providerOptions(),
            ...(request.temperature !== undefined
              ? { temperature: request.temperature }
              : {}),
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          }),
        );
        return { text: result.text, usedFallback: false };
      } catch (error) {
        logger.warn(`[llm] generateText failed: ${describeError(error)}`);
        noteQuotaError(error, logger);
        return { text: request.fallback(), usedFallback: true };
      }
    },

    async *streamText(request: TextRequest) {
      if (!active || providerPaused()) {
        // Chunk the deterministic answer so the client still sees a stream.
        for (const piece of chunkForStreaming(request.fallback())) yield piece;
        return;
      }

      // streamText reports failures through onError and simply ends textStream,
      // so an error never reaches the catch below on its own.
      let streamError: unknown;
      let yielded = false;

      try {
        await reserveCapacity(
          estimateTokens(
            [request.system, request.prompt, ...historyText(request)],
            request.maxOutputTokens,
          ),
          background,
        );

        const result = streamText({
          model: active,
          system: request.system,
          messages: toMessages(request),
          maxRetries: MAX_RETRIES,
          ...providerOptions(),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          onError: ({ error }) => {
            streamError = error;
          },
        });

        for await (const delta of result.textStream) {
          yielded = true;
          yield delta;
        }
      } catch (error) {
        streamError = error;
      }

      if (streamError !== undefined) {
        logger.warn(`[llm] streamText failed: ${describeError(streamError)}`);
        noteQuotaError(streamError, logger);
        // A half-streamed answer is already on screen; appending the fallback would garble it.
        if (!yielded) for (const piece of chunkForStreaming(request.fallback())) yield piece;
      }
    },
  };
}

/** Split text into word-ish pieces so stub streaming still feels like a stream. */
export function chunkForStreaming(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

/** Advertised in GET /meta/ai-disclosure. */
export function describeLlm(): { purpose: string; provider: string; model: string }[] {
  const provider = env.llmProvider === 'stub' ? 'none (deterministic stub)' : env.llmProvider;
  const modelName = env.llmProvider === 'stub' ? STUB_MODEL_ID : env.LLM_MODEL;

  return [
    { purpose: 'Topic extraction from uploaded material', provider, model: modelName },
    { purpose: 'Study-note lessons built from the material', provider, model: modelName },
    { purpose: 'Practice question generation', provider, model: modelName },
    { purpose: 'Learning plan guidance', provider, model: modelName },
    { purpose: 'Grounded tutoring chat', provider, model: modelName },
  ];
}
