ALTER TABLE "Report" ADD COLUMN "latestStatus" "ReportStatus" NOT NULL DEFAULT 'DRAFT';

UPDATE "Report" r SET "latestStatus" = v."status"
FROM "ReportRevision" v
WHERE v."reportId" = r."id"
  AND v."revisionNo" = (SELECT MAX(x."revisionNo") FROM "ReportRevision" x WHERE x."reportId" = r."id");

CREATE INDEX "Report_latestStatus_createdAt_idx" ON "Report"("latestStatus", "createdAt");
