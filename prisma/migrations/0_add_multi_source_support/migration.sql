-- Drop the unique constraint on Source.projectId to allow multiple sources per project
ALTER TABLE "Source" DROP CONSTRAINT "Source_projectId_key";

-- Add index on (projectId, createdAt) for efficient querying
CREATE INDEX "Source_projectId_createdAt_idx" ON "Source"("projectId", "createdAt");

-- Note: If the application has existing single-source projects with a source,
-- the existing source relationships are preserved. The id field for sources
-- can be manually set if needed for migration purposes.
