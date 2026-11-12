-- Billing follows the accepted quotation: units and the agreed amount per requested test.
ALTER TABLE "SampleTest" ADD COLUMN "billQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SampleTest" ADD COLUMN "billAmount" DECIMAL(14,2);
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_billQuantity_positive" CHECK ("billQuantity" >= 1);

-- One job per quotation, one report per sample: concurrent clicks can no longer create two.
CREATE UNIQUE INDEX "Job_quotationId_key" ON "Job"("quotationId") WHERE "quotationId" IS NOT NULL;
DROP INDEX IF EXISTS "Report_sampleId_idx";
CREATE UNIQUE INDEX "Report_sampleId_key" ON "Report"("sampleId");

-- Money never goes negative.
ALTER TABLE "StandardRate" ADD CONSTRAINT "StandardRate_rate_nonnegative" CHECK ("rate" >= 0);
ALTER TABLE "CustomerRate" ADD CONSTRAINT "CustomerRate_rate_nonnegative" CHECK ("rate" >= 0);
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_rate_nonnegative" CHECK ("rate" >= 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_rate_nonnegative" CHECK ("rate" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_grandTotal_nonnegative" CHECK ("grandTotal" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

-- Report display: working values can be hidden, and results can be "< x" or "> x".
ALTER TABLE "TestParameter" ADD COLUMN "showOnReport" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ParameterResult" ADD COLUMN "qualifier" TEXT;
ALTER TABLE "ParameterResult" ADD COLUMN "showOnReport" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ParameterResult" ADD CONSTRAINT "ParameterResult_qualifier_valid" CHECK ("qualifier" IS NULL OR "qualifier" IN ('<', '>'));
