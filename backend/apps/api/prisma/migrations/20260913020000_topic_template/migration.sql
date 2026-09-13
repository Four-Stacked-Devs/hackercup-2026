-- The learning plan renders every topic from one template: what you will be
-- able to do, and the key terms. They are structured fields rather than prose
-- so every module has the same shape. Existing topics start empty and the plan
-- falls back to the topic summary for them.
ALTER TABLE "Topic" ADD COLUMN "objectives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Topic" ADD COLUMN "keyTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
