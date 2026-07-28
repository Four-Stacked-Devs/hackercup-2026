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
