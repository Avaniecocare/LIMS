-- Short-lived links that let a phone add photos to one sample or report without signing in.
CREATE TABLE "PhoneUploadLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxUploads" INTEGER NOT NULL DEFAULT 20,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhoneUploadLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhoneUploadLink_tokenHash_key" ON "PhoneUploadLink"("tokenHash");
CREATE INDEX "PhoneUploadLink_createdById_createdAt_idx" ON "PhoneUploadLink"("createdById", "createdAt");
