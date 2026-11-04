ALTER TABLE "SampleTest" ADD COLUMN "currentStage" TEXT;

UPDATE "SampleTest" t SET "currentStage" = COALESCE(
  (SELECT s."name" FROM "SampleTestStage" s WHERE s."sampleTestId" = t."id" AND s."completedAt" IS NULL ORDER BY s."seq" LIMIT 1),
  'All stages complete')
WHERE EXISTS (SELECT 1 FROM "SampleTestStage" s WHERE s."sampleTestId" = t."id");

CREATE INDEX "SampleTest_status_currentStage_idx" ON "SampleTest"("status", "currentStage");
