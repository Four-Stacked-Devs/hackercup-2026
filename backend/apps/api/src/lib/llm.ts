import { generateObject, generateText, streamText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import type { z } from 'zod';
import { env } from '../env.js';

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
  fallback: () => string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmClient {
  /** Model identifier surfaced in `generatedBy` and /meta/ai-disclosure. */
  readonly modelId: string;
  readonly available: boolean;
  generateJson<T>(request: JsonRequest<T>): Promise<{ value: T; usedFallback: boolean }>;
  generateText(request: TextRequest): Promise<{ text: string; usedFallback: boolean }>;
  streamText(request: TextRequest): AsyncIterable<string>;
}

const STUB_MODEL_ID = 'stub-deterministic';
const CALL_TIMEOUT_MS = 45_000;

function buildModel(): LanguageModel | null {
  if (env.llmProvider === 'stub') return null;

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;

  switch (env.llmProvider) {
    case 'groq':
      return createGroq({ apiKey })(env.LLM_MODEL);
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

function withTimeout<T>(promise: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

export interface LlmLogger {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}

const consoleLogger: LlmLogger = {
  warn: (m) => console.warn(m),
  info: () => {},
};

export function createLlmClient(logger: LlmLogger = consoleLogger): LlmClient {
  const active = model();
  const modelId = active ? `${env.llmProvider}:${env.LLM_MODEL}` : STUB_MODEL_ID;

  return {
    modelId,
    available: active !== null,

    async generateJson<T>(request: JsonRequest<T>) {
      if (!active) return { value: request.fallback(), usedFallback: true };

      const attempts = (request.retries ?? 1) + 1;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const stricter =
            attempt === 0
              ? request.system
              : `${request.system}\n\nYour previous reply did not match the required JSON schema. Reply with valid JSON only — no prose, no code fences.`;

          const result = await withTimeout(
            generateObject({
              model: active,
              schema: request.schema,
              system: stricter,
              prompt: request.prompt,
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
            `[llm] generateJson attempt ${attempt + 1} failed: ${(error as Error).message}`,
          );
        }
      }

      logger.warn('[llm] falling back to deterministic output');
      return { value: request.fallback(), usedFallback: true };
    },

    async generateText(request: TextRequest) {
      if (!active) return { text: request.fallback(), usedFallback: true };

      try {
        const result = await withTimeout(
          generateText({
            model: active,
            system: request.system,
            prompt: request.prompt,
            ...(request.temperature !== undefined
              ? { temperature: request.temperature }
              : {}),
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          }),
        );
        return { text: result.text, usedFallback: false };
      } catch (error) {
        logger.warn(`[llm] generateText failed: ${(error as Error).message}`);
        return { text: request.fallback(), usedFallback: true };
      }
    },

    async *streamText(request: TextRequest) {
      if (!active) {
        // Chunk the deterministic answer so the client still sees a stream.
        for (const piece of chunkForStreaming(request.fallback())) yield piece;
        return;
      }

      try {
        const result = streamText({
          model: active,
          system: request.system,
          prompt: request.prompt,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
        });

        for await (const delta of result.textStream) yield delta;
      } catch (error) {
        logger.warn(`[llm] streamText failed: ${(error as Error).message}`);
        for (const piece of chunkForStreaming(request.fallback())) yield piece;
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
    { purpose: 'Accessible lesson rewriting', provider, model: modelName },
    { purpose: 'Practice question generation', provider, model: modelName },
    { purpose: 'Grounded tutoring chat', provider, model: modelName },
  ];
}
