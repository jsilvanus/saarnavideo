ALTER TABLE "Asset" ADD COLUMN "contentHash" TEXT;
CREATE INDEX "Asset_contentHash_idx" ON "Asset"("contentHash");
