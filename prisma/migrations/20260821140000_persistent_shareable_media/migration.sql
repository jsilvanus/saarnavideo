-- Projects and their media sources are now independent entities.
-- Preserve existing project/source ownership by copying it into the implicit
-- many-to-many relation before removing the old projectId column.
CREATE TABLE "_ProjectToSource" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ProjectToSource_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_ProjectToSource_B_fkey" FOREIGN KEY ("B") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "_ProjectToSource_AB_unique" ON "_ProjectToSource"("A", "B");
CREATE INDEX "_ProjectToSource_B_index" ON "_ProjectToSource"("B");
INSERT INTO "_ProjectToSource" ("A", "B") SELECT "projectId", "id" FROM "Source" WHERE "projectId" IS NOT NULL;

ALTER TABLE "Source" DROP CONSTRAINT IF EXISTS "Source_projectId_fkey";
DROP INDEX IF EXISTS "Source_projectId_idx";
ALTER TABLE "Source" DROP COLUMN IF EXISTS "projectId";

-- Project-owned assets become reusable across duplicated projects.
CREATE TABLE "_AssetToProject" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_AssetToProject_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_AssetToProject_B_fkey" FOREIGN KEY ("B") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "_AssetToProject_AB_unique" ON "_AssetToProject"("A", "B");
CREATE INDEX "_AssetToProject_B_index" ON "_AssetToProject"("B");
INSERT INTO "_AssetToProject" ("A", "B") SELECT "id", "projectId" FROM "Asset" WHERE "projectId" IS NOT NULL;

ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_projectId_fkey";
DROP INDEX IF EXISTS "Asset_projectId_idx";
DROP INDEX IF EXISTS "Asset_projectId_assetKey_key";
ALTER TABLE "Asset" DROP COLUMN IF EXISTS "projectId";

-- Asset keys are globally reusable now that assets may be shared.
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_assetKey_key" ON "Asset"("assetKey");

-- Projects and media assets no longer expire automatically. Generated outputs
-- retain their existing retention policy.
ALTER TABLE "Project" DROP COLUMN IF EXISTS "expiresAt";
ALTER TABLE "Source" DROP COLUMN IF EXISTS "expiresAt";
ALTER TABLE "Asset" DROP COLUMN IF EXISTS "expiresAt";
