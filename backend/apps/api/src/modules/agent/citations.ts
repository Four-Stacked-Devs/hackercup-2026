import type { Citation } from '@educlm/contracts';
import type { RetrievedChunk } from './retrieval.js';

/**
 * Citation resolution.
 *
 * The model is told to mark every substantive claim with `[p.N]`. Here those
 * markers are parsed and resolved back to the chunk they came from, so the UI
 * renders a real source chip rather than trusting the model's prose.
 */

export const MAX_SNIPPET = 240;
const CITATION_PATTERN = /\[p\.\s*(\d+)\]/gi;

export function extractCitedPages(text: string): number[] {
  const pages = new Set<number>();
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const page = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(page)) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Verbatim opening of the chunk, trimmed to a whole word. */
export function buildSnippet(content: string, max = MAX_SNIPPET): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;

  const cut = normalized.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Map cited page numbers onto the chunks that were actually retrieved.
 * A page the model cites but that was never retrieved is dropped — we will not
 * manufacture a source for a claim we cannot ground.
 */
export function resolveCitations(text: string, chunks: RetrievedChunk[]): Citation[] {
  const citedPages = extractCitedPages(text);
  if (citedPages.length === 0) return [];

  const citations: Citation[] = [];
  const usedChunks = new Set<string>();

  for (const page of citedPages) {
    const candidates = chunks.filter((c) => c.page === page);
    const chunk = candidates.find((c) => !usedChunks.has(c.id)) ?? candidates[0];
    if (!chunk) continue;

    usedChunks.add(chunk.id);
    citations.push({
      chunkId: chunk.id,
      page: chunk.page,
      sectionTitle: chunk.sectionTitle,
      snippet: buildSnippet(chunk.content),
    });
  }

  return citations;
}

/**
 * A substantive answer with no citations means the model ignored its grounding
 * instruction. Short refusals and clarifying questions are legitimately
 * citation-free, so they are exempt.
 */
export function needsCitationRetry(text: string, citations: Citation[]): boolean {
  if (citations.length > 0) return false;
  return text.trim().length > 280;
}
