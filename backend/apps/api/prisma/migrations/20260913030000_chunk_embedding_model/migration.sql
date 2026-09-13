-- Vectors from different embedding models are not comparable, so each chunk
-- records the model that embedded it. Retrieval only compares a question with
-- passages from the same model, and the embedding job re-embeds the rest.
-- Every vector written before this column was bge-small-en-v1.5, the only
-- model that has run against real data.
ALTER TABLE "Chunk" ADD COLUMN "embeddingModel" TEXT;
UPDATE "Chunk" SET "embeddingModel" = 'Xenova/bge-small-en-v1.5' WHERE "embedding" IS NOT NULL;
