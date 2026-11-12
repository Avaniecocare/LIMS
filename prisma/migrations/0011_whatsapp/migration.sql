-- WhatsApp messages to customers, with their delivery status.
CREATE TYPE "WhatsappStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "documentFileId" TEXT,
    "documentName" TEXT,
    "status" "WhatsappStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "consentConfirmedBy" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsappMessage_entity_entityId_idx" ON "WhatsappMessage"("entity", "entityId");
CREATE INDEX "WhatsappMessage_status_createdAt_idx" ON "WhatsappMessage"("status", "createdAt");
