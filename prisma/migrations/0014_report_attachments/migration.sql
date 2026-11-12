-- Instrument reports as annexures, raw data kept unprinted: which test files go on the report, and PDF page counts.
ALTER TABLE "FileObject" ADD COLUMN "printOnReport" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "pageCount" INTEGER;
ALTER TABLE "TestMaster" ADD COLUMN "printAttachments" BOOLEAN NOT NULL DEFAULT true;
-- Result images already on tests were always printed: keep them that way.
UPDATE "FileObject" SET "printOnReport" = true WHERE "category" = 'result-image' AND "entity" = 'SampleTest';
