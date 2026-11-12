ALTER TABLE "ReportRevision" ADD COLUMN "verificationCode" TEXT;

CREATE UNIQUE INDEX "ReportRevision_verificationCode_key" ON "ReportRevision"("verificationCode");
