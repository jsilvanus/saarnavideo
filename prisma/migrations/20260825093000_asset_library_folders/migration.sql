CREATE TABLE "AssetFolder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssetFolder_parentId_idx" ON "AssetFolder"("parentId");

ALTER TABLE "Asset" ADD COLUMN "folderId" TEXT;
CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");

-- Existing assets intentionally remain at the library root (folderId = NULL).
