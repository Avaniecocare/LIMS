-- Quality management (equipment log, staff authorisations, training, non-conformance) and DPDP privacy registers.

-- CreateEnum
CREATE TYPE "EquipmentEventKind" AS ENUM ('CALIBRATION', 'INTERMEDIATE_CHECK', 'MAINTENANCE', 'REPAIR', 'BREAKDOWN');

-- CreateEnum
CREATE TYPE "EquipmentOutcome" AS ENUM ('PASS', 'ADJUSTED', 'FAIL');

-- CreateEnum
CREATE TYPE "NcStatus" AS ENUM ('OPEN', 'ACTION', 'VERIFICATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "NcSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataRequestKind" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE', 'GRIEVANCE', 'CONSENT_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'DONE', 'REJECTED');

-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "calibrationIntervalMonths" INTEGER,
ADD COLUMN     "lastMaintainedAt" DATE,
ADD COLUMN     "maintenanceDueAt" DATE,
ADD COLUMN     "maintenanceIntervalMonths" INTEGER;

-- CreateTable
CREATE TABLE "EquipmentEvent" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "kind" "EquipmentEventKind" NOT NULL,
    "performedOn" DATE NOT NULL,
    "performedBy" TEXT NOT NULL,
    "outcome" "EquipmentOutcome" NOT NULL,
    "certificateNo" TEXT,
    "certificateFileId" TEXT,
    "nextDueOn" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "EquipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAuthorisation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "authorisedOn" DATE NOT NULL,
    "validUntil" DATE,
    "authorisedById" TEXT,
    "authorisedByName" TEXT,
    "evidence" TEXT,
    "evidenceFileId" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "StaffAuthorisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trainedOn" DATE NOT NULL,
    "trainer" TEXT,
    "hours" DECIMAL(6,1),
    "notes" TEXT,
    "evidenceFileId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonConformance" (
    "id" TEXT NOT NULL,
    "ncNo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "NcSeverity" NOT NULL DEFAULT 'MINOR',
    "status" "NcStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT,
    "correction" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "dueOn" DATE,
    "verification" TEXT,
    "verifiedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "NonConformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "kind" "DataRequestKind" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachIncident" (
    "id" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "dataAffected" TEXT NOT NULL,
    "peopleAffected" INTEGER,
    "containment" TEXT,
    "reportedToBoardAt" TIMESTAMP(3),
    "notifiedPeopleAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "BreachIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentEvent_instrumentId_performedOn_idx" ON "EquipmentEvent"("instrumentId", "performedOn");

-- CreateIndex
CREATE INDEX "StaffAuthorisation_userId_testId_idx" ON "StaffAuthorisation"("userId", "testId");

-- CreateIndex
CREATE INDEX "StaffAuthorisation_testId_idx" ON "StaffAuthorisation"("testId");

-- CreateIndex
CREATE INDEX "TrainingRecord_userId_trainedOn_idx" ON "TrainingRecord"("userId", "trainedOn");

-- CreateIndex
CREATE UNIQUE INDEX "NonConformance_ncNo_key" ON "NonConformance"("ncNo");

-- CreateIndex
CREATE INDEX "NonConformance_status_dueOn_idx" ON "NonConformance"("status", "dueOn");

-- CreateIndex
CREATE INDEX "DataRequest_status_dueOn_idx" ON "DataRequest"("status", "dueOn");

-- CreateIndex
CREATE INDEX "BreachIncident_detectedAt_idx" ON "BreachIncident"("detectedAt");

-- CreateIndex
CREATE INDEX "Instrument_maintenanceDueAt_idx" ON "Instrument"("maintenanceDueAt");

-- AddForeignKey
ALTER TABLE "EquipmentEvent" ADD CONSTRAINT "EquipmentEvent_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
