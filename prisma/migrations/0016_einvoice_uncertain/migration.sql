-- Sent to the IRP and no clear answer received, so an IRN may exist there.
ALTER TABLE "EInvoice" ADD COLUMN "uncertain" BOOLEAN NOT NULL DEFAULT false;
UPDATE "EInvoice" SET "uncertain" = true WHERE "status" = 'PENDING';
