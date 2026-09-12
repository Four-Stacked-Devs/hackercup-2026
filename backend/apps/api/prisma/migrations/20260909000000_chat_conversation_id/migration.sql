-- Threading moves to the server: the client used to rebuild chat threads from
-- localStorage, which meant a different browser saw the whole log as one pile.
-- `topicId` was already stored; this adds the other half.
--
-- Nullable with no backfill on purpose. Rows written before this migration have
-- no conversation the server ever knew about, and inventing one would merge
-- unrelated exchanges. The client keeps its local index as the fallback for
-- exactly those rows.
ALTER TABLE "ChatMessage" ADD COLUMN "conversationId" TEXT;

-- The sidebar groups a material's log by thread, so this is the read it makes.
CREATE INDEX "ChatMessage_materialId_conversationId_idx" ON "ChatMessage"("materialId", "conversationId");
