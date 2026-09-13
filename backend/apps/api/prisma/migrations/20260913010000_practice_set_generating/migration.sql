-- Practice sets are built in the background: a set is created at once in
-- GENERATING and the student's screen polls it, instead of one HTTP request
-- waiting on every model call. FAILED is where it lands if nothing could be built.
ALTER TYPE "PracticeSetStatus" ADD VALUE IF NOT EXISTS 'GENERATING';
ALTER TYPE "PracticeSetStatus" ADD VALUE IF NOT EXISTS 'FAILED';

-- What the set was asked for, so progress reads "3 of 5" while it fills.
ALTER TABLE "PracticeSet" ADD COLUMN "targetCount" INTEGER NOT NULL DEFAULT 0;

-- Existing sets were complete when created.
UPDATE "PracticeSet" SET "targetCount" = cardinality("questionIds");
