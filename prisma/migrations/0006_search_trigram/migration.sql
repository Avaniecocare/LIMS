-- Fast "contains" search (global search box, list filters). pg_trgm is a trusted extension, so the database owner
-- can create it; if a hosting provider forbids it, the migration still succeeds and search keeps working, only slower.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
  RAISE NOTICE 'pg_trgm not available; skipping trigram search indexes';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "Customer_name_trgm" ON "Customer" USING gin ("name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Customer_crn_trgm" ON "Customer" USING gin ("crn" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Job_jobNo_trgm" ON "Job" USING gin ("jobNo" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Sample_sampleNo_trgm" ON "Sample" USING gin ("sampleNo" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Sample_description_trgm" ON "Sample" USING gin ("description" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Report_reportNo_trgm" ON "Report" USING gin ("reportNo" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Invoice_invoiceNo_trgm" ON "Invoice" USING gin ("invoiceNo" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "Quotation_quotationNo_trgm" ON "Quotation" USING gin ("quotationNo" gin_trgm_ops);
  END IF;
END $$;
