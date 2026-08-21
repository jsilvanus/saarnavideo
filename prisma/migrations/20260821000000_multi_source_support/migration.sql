-- Drop the one-project-one-source unique constraint so a project can have multiple sources.
ALTER TABLE "Source" DROP CONSTRAINT IF EXISTS "Source_projectId_key";
DROP INDEX IF EXISTS "Source_projectId_key";

-- Keep the foreign-key index for project lookups.
CREATE INDEX IF NOT EXISTS "Source_projectId_idx"
    ON "Source"("projectId");

-- Existing single-source projects remain valid because the foreign key and data are unchanged.
