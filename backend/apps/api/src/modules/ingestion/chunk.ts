import { looksLikeHeading } from '../../lib/pdf.js';

/**
 * Chunking — pure, no I/O.
 *
 * ~800 tokens with ~120 overlap, and NEVER spanning a page boundary. A chunk
 * that straddles two pages cannot honestly claim a single page number, and page
 * fidelity is what makes every downstream citation real.
 */

/** Rough token estimate. Good enough for sizing; exactness buys nothing here. */
export const CHARS_PER_TOKEN = 4;
export const TARGET_TOKENS = 800;
export const OVERLAP_TOKENS = 120;

export const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
export const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

/** Chunks shorter than this are merged into a neighbour rather than kept alone. */
const MIN_CHUNK_CHARS = 120;

export interface ChunkDraft {
  page: number;
  orderIndex: number;
  content: string;
  charCount: number;
  sectionTitle: string | null;
}

/** Split into paragraphs, then oversized paragraphs into sentences. */
function splitBlocks(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= TARGET_CHARS) {
      blocks.push(paragraph);
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [paragraph];
    let buffer = '';

    for (const sentence of sentences) {
      if (buffer.length + sentence.length > TARGET_CHARS && buffer.length > 0) {
        blocks.push(buffer.trim());
        buffer = '';
      }
      // A single sentence longer than the target: hard-split it.
      if (sentence.length > TARGET_CHARS) {
        for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
          blocks.push(sentence.slice(i, i + TARGET_CHARS).trim());
        }
        continue;
      }
      buffer += sentence;
    }

    if (buffer.trim()) blocks.push(buffer.trim());
  }

  return blocks;
}

/** Trailing slice of `text` about OVERLAP_CHARS long, cut on a word boundary. */
function overlapTail(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text;
  const tail = text.slice(-OVERLAP_CHARS);
  const boundary = tail.search(/\s/);
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

/** The most recent heading at or above this point in the page. */
function findHeading(text: string, fallback: string | null): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (looksLikeHeading(line)) return line.trim();
  }
  return fallback;
}

/**
 * Chunk one page. Exported for tests.
 */
export function chunkPage(
  pageText: string,
  page: number,
  startIndex: number,
  inheritedTitle: string | null,
): { chunks: ChunkDraft[]; lastTitle: string | null } {
  const blocks = splitBlocks(pageText);
  if (blocks.length === 0) return { chunks: [], lastTitle: inheritedTitle };

  const chunks: ChunkDraft[] = [];
  let buffer = '';
  let orderIndex = startIndex;
  let currentTitle = findHeading(pageText, inheritedTitle);

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;

    // Fold a runt into the previous chunk instead of emitting it alone.
    const previous = chunks.at(-1);
    if (content.length < MIN_CHUNK_CHARS && previous) {
      previous.content = `${previous.content}\n\n${content}`;
      previous.charCount = previous.content.length;
      buffer = '';
      return;
    }

    chunks.push({
      page,
      orderIndex: orderIndex++,
      content,
      charCount: content.length,
      sectionTitle: currentTitle,
    });
    buffer = '';
  };

  for (const block of blocks) {
    if (looksLikeHeading(block)) currentTitle = block.trim();

    const candidate = buffer ? `${buffer}\n\n${block}` : block;

    if (candidate.length > TARGET_CHARS && buffer) {
      const carry = overlapTail(buffer);
      flush();
      buffer = carry ? `${carry}\n\n${block}` : block;
    } else {
      buffer = candidate;
    }
  }

  flush();

  return { chunks, lastTitle: currentTitle };
}

/**
 * Chunk every page. `pages[0]` is page 1.
 * Empty pages contribute nothing but do not disturb numbering.
 */
export function chunkPages(pages: string[]): ChunkDraft[] {
  const all: ChunkDraft[] = [];
  let title: string | null = null;

  pages.forEach((pageText, index) => {
    const { chunks, lastTitle } = chunkPage(pageText, index + 1, all.length, title);
    all.push(...chunks);
    title = lastTitle;
  });

  return all.map((chunk, orderIndex) => ({ ...chunk, orderIndex }));
}
