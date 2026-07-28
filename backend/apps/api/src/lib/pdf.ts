import { extractText, getDocumentProxy } from 'unpdf';
import { errors } from './errors.js';

/**
 * Page-accurate text extraction.
 *
 * Page fidelity is what makes citations real: every chunk, question, and
 * citation carries the page it came from, so a student can always check the
 * original. Text-layer PDFs only — no OCR, per the MVP non-goals.
 */

/** Below this many characters we treat the PDF as a scan with no text layer. */
export const MIN_TEXT_CHARS = 200;

export interface ExtractedPdf {
  pageCount: number;
  /** Index 0 is page 1. */
  pages: string[];
  totalChars: number;
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  let pages: string[];
  let pageCount: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: false });

    pageCount = pdf.numPages;
    pages = (Array.isArray(result.text) ? result.text : [result.text]).map(normalizeText);
  } catch {
    // A parse failure is not a text-layer problem — say so honestly.
    throw errors.validation(
      'We could not read that PDF. It may be damaged or password-protected.',
    );
  }

  const totalChars = pages.reduce((sum, page) => sum + page.length, 0);

  if (totalChars < MIN_TEXT_CHARS) {
    throw errors.noTextLayer();
  }

  return { pageCount, pages, totalChars };
}

/**
 * Collapse the ragged whitespace PDF extraction produces, without destroying
 * paragraph structure.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Heuristic heading detection, used both for chunk section titles and for the
 * fallback topic segmentation when the LLM is unavailable.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/[.!?]$/.test(trimmed)) return false;

  // "3.2 Comparison Operators" / "Chapter 4" / "COMPARISON OPERATORS"
  if (/^(chapter|section|unit|lesson|module|part)\s+[\divx]+/i.test(trimmed)) return true;
  if (/^\d+(\.\d+)*\s+\S/.test(trimmed)) return true;

  const letters = trimmed.replace(/[^a-z]/gi, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;

  // Title Case with few words.
  const words = trimmed.split(/\s+/);
  if (words.length <= 8 && words.filter((w) => /^[A-Z]/.test(w)).length >= words.length - 1) {
    return true;
  }

  return false;
}
