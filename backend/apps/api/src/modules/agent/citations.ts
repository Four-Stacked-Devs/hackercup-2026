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

/**
 * `[p.12]`, and the variants models write despite being asked for one page per
 * marker: `[pp.7-9]`, `[p.26‑33]` (a non-breaking hyphen), `[p.7, 9]`,
 * `[p.3, p.5]`. Only matching the single-page form silently dropped every
 * source chip from answers that cited ranges — which overviews nearly always do.
 */
const CITATION_PATTERN = /\[\s*pp?\.\s*([\dp.\s,;–—‑‐-]{1,40}?)\s*\]/gi;
const PAGE_OR_RANGE = /(\d+)(?:\s*[-–—‑‐]\s*(?:pp?\.\s*)?(\d+))?/g;
/** A wider "range" is a typo or a year, not a citation. */
const MAX_RANGE = 20;

/**
 * gpt-oss falls back on its training's citation style — `【1†p.35】` — however
 * the prompt asks. Left alone it renders as noise and resolves to no chip.
 */
const FOREIGN_MARKER = /【[^】]{0,12}?\bp{1,2}(?:age)?\.?\s*([\d\s,;–—‑‐-]{1,40}?)\s*】/gi;

/** Rewrite foreign citation markers into the `[p.N]` form everything else reads. */
export function normalizeCitationMarkers(text: string): string {
  return text.replace(FOREIGN_MARKER, (_, pages: string) => `[p.${pages.trim()}]`);
}

export function extractCitedPages(text: string): number[] {
  const pages = new Set<number>();

  for (const match of normalizeCitationMarkers(text).matchAll(CITATION_PATTERN)) {
    for (const part of match[1]!.matchAll(PAGE_OR_RANGE)) {
      const start = Number.parseInt(part[1]!, 10);
      const end = part[2] ? Number.parseInt(part[2], 10) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      if (end >= start && end - start <= MAX_RANGE) {
        for (let page = start; page <= end; page += 1) pages.add(page);
      } else {
        pages.add(start);
      }
    }
  }

  return [...pages].sort((a, b) => a - b);
}

/** Verbatim opening of the chunk, trimmed to a whole word. */
export function buildSnippet(content: string, max = MAX_SNIPPET): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;

  // The ellipsis counts against `max`: the contract caps `snippet` at 240 chars
  // and the response serializer enforces it, so spending the whole budget on
  // text and then appending a character produced a 241-char snippet and a 500.
  const budget = max - 1;
  const cut = normalized.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > budget * 0.6 ? lastSpace : budget).trimEnd()}…`;
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
