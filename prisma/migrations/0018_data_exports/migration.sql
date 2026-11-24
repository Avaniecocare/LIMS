CREATE TYPE "DataExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'QUEUED',
    "parts" JSONB NOT NULL DEFAULT '[]',
    "tables" INTEGER NOT NULL DEFAULT 0,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "files" INTEGER NOT NULL DEFAULT 0,
    "missingFiles" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataExport_createdAt_idx" ON "DataExport"("createdAt");
-- One at a time, whoever asks.
CREATE UNIQUE INDEX "DataExport_one_running" ON "DataExport" ((true)) WHERE "status" IN ('QUEUED', 'RUNNING');
