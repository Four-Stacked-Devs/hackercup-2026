-- Lessons move off the upload's critical path: a material turns READY with a
-- structural draft for every topic, and the AI study notes replace each draft
-- in the background. This records where each topic's lesson is in that.
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'WRITING', 'READY', 'FAILED');

ALTER TABLE "Topic" ADD COLUMN "lessonStatus" "LessonStatus" NOT NULL DEFAULT 'DRAFT';

-- Topics that exist already had their lessons built before READY, the old way.
-- Marking them DRAFT would send every one back through the model for nothing.
UPDATE "Topic" SET "lessonStatus" = 'READY';
