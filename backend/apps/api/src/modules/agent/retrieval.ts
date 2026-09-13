import { db } from '../../db/client.js';
import { getEmbedder, toVectorLiteral } from '../../lib/embeddings.js';

/**
 * Retrieval: embed the question, take the top-8 chunks by cosine similarity,
 * filtered to the material and — when a topicId is given — to that topic's pages.
 */

export const TOP_K = 8;

export interface RetrievedChunk {
  id: string;
  page: number;
  sectionTitle: string | null;
  content: string;
  similarity: number;
}

export async function retrieveChunks(params: {
  materialId: string;
  query: string;
  topicId?: string | undefined;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const limit = params.limit ?? TOP_K;
  const pages = await pagesForTopic(params.topicId);

  const vectorHits = await vectorSearch(params.materialId, params.query, pages, limit);
  if (vectorHits.length > 0) return vectorHits;

  // No embeddings (ingestion ran without them, or the model was unavailable):
  // degrade to keyword search rather than returning nothing.
  return keywordSearch(params.materialId, params.query, pages, limit);
}

/** Below this, a clipped passage stops saying anything a summary can use. */
const MIN_OVERVIEW_CHARS = 300;

/**
 * The material (or one topic) in page order, for "summarise this" requests.
 *
 * Similarity search is the wrong tool for an overview: "summarise this pdf"
 * matches whichever chunks happen to contain the word "summary". An overview
 * needs every part of the document, so this takes all of it when it fits the
 * budget, and otherwise an even spread so the last chapter is not dropped.
 */
export async function overviewChunks(params: {
  materialId: string;
  topicId?: string | undefined;
  budgetChars: number;
}): Promise<RetrievedChunk[]> {
  const pages = await pagesForTopic(params.topicId);

  const rows = await db().chunk.findMany({
    where: { materialId: params.materialId, ...(pages ? { page: { in: pages } } : {}) },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, page: true, sectionTitle: true, content: true },
  });
  if (rows.length === 0) return [];

  const total = rows.reduce((sum, row) => sum + row.content.length, 0);
  const share = Math.floor(params.budgetChars / rows.length);

  const picked =
    total <= params.budgetChars || share >= MIN_OVERVIEW_CHARS
      ? rows
      : rows.filter(
          (_, index) =>
            index % Math.ceil((rows.length * MIN_OVERVIEW_CHARS) / params.budgetChars) === 0,
        );

  const clip =
    total <= params.budgetChars ? Infinity : Math.max(MIN_OVERVIEW_CHARS, share);

  return picked.map((row) => ({
    ...row,
    content: row.content.length > clip ? `${row.content.slice(0, clip)}…` : row.content,
    similarity: 1,
  }));
}

async function pagesForTopic(topicId?: string): Promise<number[] | null> {
  if (!topicId) return null;
  const topic = await db().topic.findUnique({ where: { id: topicId } });
  if (!topic || topic.sourcePages.length === 0) return null;
  return topic.sourcePages;
}

async function vectorSearch(
  materialId: string,
  query: string,
  pages: number[] | null,
  limit: number,
): Promise<RetrievedChunk[]> {
  try {
    const [vector] = await getEmbedder().embed([query]);
    if (!vector) return [];

    const literal = toVectorLiteral(vector);

    // `1 - cosine_distance` so higher is more similar, matching the field name.
    const sql = pages
      ? `SELECT id, page, "sectionTitle", content,
                1 - (embedding <=> $1::vector) AS similarity
         FROM "Chunk"
         WHERE "materialId" = $2 AND embedding IS NOT NULL AND page = ANY($3::int[])
         ORDER BY embedding <=> $1::vector
         LIMIT $4`
      : `SELECT id, page, "sectionTitle", content,
                1 - (embedding <=> $1::vector) AS similarity
         FROM "Chunk"
         WHERE "materialId" = $2 AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $3`;

    const args = pages ? [literal, materialId, pages, limit] : [literal, materialId, limit];

    return await db().$queryRawUnsafe<RetrievedChunk[]>(sql, ...args);
  } catch {
    return [];
  }
}

async function keywordSearch(
  materialId: string,
  query: string,
  pages: number[] | null,
  limit: number,
): Promise<RetrievedChunk[]> {
  const terms = [...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 8))];

  const chunks = await db().chunk.findMany({
    where: {
      materialId,
      ...(pages ? { page: { in: pages } } : {}),
      ...(terms.length > 0
        ? { OR: terms.map((term) => ({ content: { contains: term, mode: 'insensitive' as const } })) }
        : {}),
    },
    orderBy: { orderIndex: 'asc' },
    take: limit * 3,
  });

  // Rank by how many distinct query terms each chunk mentions.
  return chunks
    .map((chunk) => {
      const haystack = chunk.content.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term)).length;
      return {
        id: chunk.id,
        page: chunk.page,
        sectionTitle: chunk.sectionTitle,
        content: chunk.content,
        similarity: terms.length === 0 ? 0 : hits / terms.length,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
