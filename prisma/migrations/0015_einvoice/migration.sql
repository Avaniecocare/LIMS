-- GST e-invoicing: the IRN registered for an invoice or credit note at the Invoice Registration Portal.
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED', 'CANCELLED');

CREATE TABLE "EInvoice" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "creditNoteId" TEXT,
    "docType" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "docDate" DATE NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDate" TIMESTAMP(3),
    "signedInvoice" TEXT,
    "signedQrCode" TEXT,
    "payload" JSONB,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "cancelReasonCode" TEXT,
    "cancelRemark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id"),
    -- exactly one of the two documents
    CONSTRAINT "EInvoice_one_document" CHECK (("invoiceId" IS NULL) <> ("creditNoteId" IS NULL))
);

CREATE UNIQUE INDEX "EInvoice_invoiceId_key" ON "EInvoice"("invoiceId");
CREATE UNIQUE INDEX "EInvoice_creditNoteId_key" ON "EInvoice"("creditNoteId");
CREATE UNIQUE INDEX "EInvoice_irn_key" ON "EInvoice"("irn");
CREATE INDEX "EInvoice_status_idx" ON "EInvoice"("status");

ALTER TABLE "EInvoice" ADD CONSTRAINT "EInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EInvoice" ADD CONSTRAINT "EInvoice_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
