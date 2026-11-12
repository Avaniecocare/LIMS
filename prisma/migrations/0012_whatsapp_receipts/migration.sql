-- Delivered and read receipts from Meta's WhatsApp status webhook.
ALTER TYPE "WhatsappStatus" ADD VALUE 'DELIVERED' BEFORE 'FAILED';
ALTER TYPE "WhatsappStatus" ADD VALUE 'READ' BEFORE 'FAILED';
ALTER TABLE "WhatsappMessage" ADD COLUMN "deliveredAt" TIMESTAMP(3), ADD COLUMN "readAt" TIMESTAMP(3);
CREATE INDEX "WhatsappMessage_providerMessageId_idx" ON "WhatsappMessage"("providerMessageId");
