import { describe, expect, it } from 'vitest';
import { parseRetryDelay, quotaPauseMs } from '../../src/lib/llm.js';

/** The AI SDK wraps the provider's error once its own retries give up. */
const retryError = (providerMessage: string) => ({
  message: `Failed after 4 attempts. Last error: ${providerMessage}`,
  lastError: { message: providerMessage },
});

const GROQ_DAILY =
  'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199728, Requested 2314. Please try again in 14m42.144s.';

const GROQ_MINUTE =
  'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 1200. Please try again in 8.2s.';

const GEMINI_DAILY =
  'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 250, model: gemini-3.8-flash. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier';

describe('parseRetryDelay', () => {
  it('reads the delays providers put in their messages', () => {
    expect(parseRetryDelay('Please try again in 14m42.144s.')).toBe(882_144);
    expect(parseRetryDelay('try again in 1h2m')).toBe(3_720_000);
    expect(parseRetryDelay('Please try again in 8.2s.')).toBe(8_200);
    expect(parseRetryDelay('retry in 350ms')).toBe(350);
  });

  it('returns null when no delay is named', () => {
    expect(parseRetryDelay('Service unavailable')).toBeNull();
  });
});

describe('quotaPauseMs', () => {
  it("pauses until Groq's named reset when the daily quota is spent", () => {
    expect(quotaPauseMs(retryError(GROQ_DAILY))).toBe(882_144);
  });

  it('pauses a default window for a daily quota with no named reset', () => {
    expect(quotaPauseMs(retryError(GEMINI_DAILY))).toBe(10 * 60_000);
  });

  it('leaves per-minute limits to the pacer and backoff', () => {
    expect(quotaPauseMs(retryError(GROQ_MINUTE))).toBeNull();
  });

  it('ignores ordinary failures', () => {
    expect(quotaPauseMs(new Error('The model `x` does not exist'))).toBeNull();
    expect(quotaPauseMs(undefined)).toBeNull();
  });
});
