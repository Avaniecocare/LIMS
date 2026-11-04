-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TermsKind" AS ENUM ('QUOTATION', 'INVOICE', 'REPORT');

-- CreateEnum
CREATE TYPE "DocumentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TestCategory" AS ENUM ('CHEMICAL', 'MECHANICAL', 'PHYSICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ParameterKind" AS ENUM ('NUMERIC', 'TEXT', 'RESULT_SET', 'CALCULATED');

-- CreateEnum
CREATE TYPE "TestGroupKind" AS ENUM ('TEST', 'CHEMICAL');

-- CreateEnum
CREATE TYPE "LookupKind" AS ENUM ('DEVIATION_TYPE', 'RECEIPT_MODE', 'DISPATCH_MODE');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('BILLING', 'REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('EMAIL', 'PHONE', 'LETTER', 'WALK_IN');

-- CreateEnum
CREATE TYPE "OrderStage" AS ENUM ('NEW', 'QUOTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RECEIVED', 'PLANNED', 'IN_TESTING', 'REPORTING', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('RECEIVED', 'PLANNED', 'IN_TESTING', 'REPORTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'RESULTS_SUBMITTED', 'APPROVED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnalysisMode" AS ENUM ('SPECTRO', 'WET');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "departmentId" TEXT,
    "signatureFileId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "emailPreferences" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TermsVersion" (
    "id" TEXT NOT NULL,
    "kind" "TermsKind" NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSeries" (
    "code" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSeries_pkey" PRIMARY KEY ("code","fy")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "ip" TEXT,
    "requestId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "meta" JSONB,
    "byId" TEXT,
    "byName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "printWidthMm" INTEGER,
    "printHeightMm" INTEGER,
    "caption" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "fileId" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" TEXT NOT NULL,
    "fromUnitId" TEXT NOT NULL,
    "toUnitId" TEXT NOT NULL,
    "factor" DECIMAL(30,15) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardRef" TEXT,
    "accredited" BOOLEAN NOT NULL DEFAULT false,
    "accreditedUntil" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TestMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TestCategory" NOT NULL DEFAULT 'OTHER',
    "departmentId" TEXT,
    "methodId" TEXT,
    "defaultTatDays" INTEGER NOT NULL DEFAULT 5,
    "urgentTatDays" INTEGER NOT NULL DEFAULT 2,
    "accredited" BOOLEAN NOT NULL DEFAULT false,
    "accreditedUntil" DATE,
    "stages" JSONB NOT NULL DEFAULT '["Sample Received by Analyst","Sample Preparation","Analysis","Calculation and Result Entry"]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TestMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestParameter" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ParameterKind" NOT NULL DEFAULT 'NUMERIC',
    "unitId" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "resultSetId" TEXT,
    "formulaId" TEXT,
    "formulaBindings" JSONB,
    "accredited" BOOLEAN NOT NULL DEFAULT false,
    "accreditedUntil" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TestParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specification" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Specification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecificationLimit" (
    "id" TEXT NOT NULL,
    "specificationId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "minValue" DECIMAL(20,8),
    "maxValue" DECIMAL(20,8),
    "textLimit" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpecificationLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TestGroupKind" NOT NULL DEFAULT 'TEST',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestGroupItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "parameterId" TEXT,

    CONSTRAINT "TestGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ResultSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSetOption" (
    "id" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPass" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ResultSetOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formula" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaVersion" (
    "id" TEXT NOT NULL,
    "formulaId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "expression" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormulaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNo" TEXT,
    "departmentId" TEXT,
    "lastCalibratedAt" DATE,
    "calibrationDueAt" DATE,
    "certificateFileId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardRate" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StandardRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRate" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemarkTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "testId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'ANY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RemarkTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookupValue" (
    "id" TEXT NOT NULL,
    "kind" "LookupKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LookupValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "crn" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "stateName" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "creditDays" INTEGER NOT NULL DEFAULT 30,
    "withholdReportUntilPaid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "ownerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "stateName" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "pincode" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "receivedOn" DATE NOT NULL,
    "stage" "OrderStage" NOT NULL DEFAULT 'NEW',
    "ownerId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "validUntil" DATE NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rejectReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationVersion" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "documentTitle" TEXT NOT NULL DEFAULT 'Quotation',
    "validUntil" DATE NOT NULL,
    "estimatedDays" INTEGER,
    "paymentTerms" TEXT,
    "deliveryAddress" TEXT,
    "contactPerson" TEXT,
    "revisionNote" TEXT,
    "discountPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountInWords" TEXT NOT NULL DEFAULT '',
    "customerSnapshot" JSONB,
    "companySnapshot" JSONB,
    "termsSnapshot" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sampleDescription" TEXT NOT NULL,
    "requiredQuantity" TEXT,
    "testId" TEXT NOT NULL,
    "testCode" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "methodName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(14,2) NOT NULL,
    "rateSource" TEXT NOT NULL,
    "overrideReason" TEXT,
    "discountPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "jobNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationId" TEXT,
    "noQuotationReason" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'RECEIVED',
    "statusBeforeHold" "JobStatus",
    "holdReason" TEXT,
    "cancelReason" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "letterRef" TEXT,
    "letterDate" DATE,
    "materialSpec" TEXT,
    "poNumber" TEXT,
    "poDate" DATE,
    "receiptModeId" TEXT,
    "reportIssueDetails" TEXT,
    "reportIssueAddress" TEXT,
    "kindAttention" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "sampleDrawnByLab" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "sampleNo" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" TEXT,
    "quantity" TEXT,
    "size" TEXT,
    "returnable" BOOLEAN NOT NULL DEFAULT false,
    "status" "SampleStatus" NOT NULL DEFAULT 'RECEIVED',
    "cancelReason" TEXT,
    "specificationId" TEXT,
    "dualSpecificationId" TEXT,
    "retentionUntil" DATE,
    "disposedAt" DATE,
    "returnStatus" TEXT,
    "returnedAt" DATE,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleAttribute" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SampleAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleDeviation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sampleId" TEXT,
    "typeId" TEXT NOT NULL,
    "typeLabel" TEXT NOT NULL,
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleDeviation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "planNo" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleTest" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "planId" TEXT,
    "testId" TEXT NOT NULL,
    "testCode" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "methodName" TEXT,
    "departmentId" TEXT,
    "analysisMode" "AnalysisMode",
    "specificationId" TEXT,
    "dualSpecificationId" TEXT,
    "status" "TestStatus" NOT NULL DEFAULT 'PLANNED',
    "statusBeforeHold" "TestStatus",
    "holdReason" TEXT,
    "cancelReason" TEXT,
    "rejectionReason" TEXT,
    "officeInstructions" TEXT,
    "technicalData" TEXT,
    "assignedToId" TEXT,
    "instrumentId" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATE,
    "plannedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "conductedById" TEXT,
    "conductedByName" TEXT,
    "remarks" TEXT,
    "observations" TEXT,
    "notes" TEXT,
    "rate" DECIMAL(14,2),
    "rateSource" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SampleTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleTestStage" (
    "id" TEXT NOT NULL,
    "sampleTestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedByName" TEXT,

    CONSTRAINT "SampleTestStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParameterResult" (
    "id" TEXT NOT NULL,
    "sampleTestId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ParameterKind" NOT NULL,
    "unit" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "accredited" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "numericValue" DECIMAL(20,8),
    "textValue" TEXT,
    "limits" JSONB,
    "passPrimary" BOOLEAN,
    "passDual" BOOLEAN,
    "enteredById" TEXT,
    "enteredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ParameterResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRecord" (
    "id" TEXT NOT NULL,
    "parameterResultId" TEXT NOT NULL,
    "formulaVersionId" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "working" TEXT NOT NULL,
    "result" DECIMAL(20,8) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalculationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reportNo" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "currentRevisionNo" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "invoiced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionReason" TEXT,
    "replacesRevisionId" TEXT,
    "ulrNumber" TEXT,
    "content" JSONB NOT NULL,
    "companySnapshot" JSONB NOT NULL,
    "termsSnapshot" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "pdfFileId" TEXT,
    "pdfSha256" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRejection" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sampleTestIds" JSONB,
    "byId" TEXT,
    "byName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSignature" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "signatureFileId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "contentSha256" TEXT NOT NULL,

    CONSTRAINT "ReportSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "dispatchNo" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "dispatchDate" DATE NOT NULL,
    "modeId" TEXT NOT NULL,
    "modeLabel" TEXT NOT NULL,
    "courierName" TEXT,
    "carrierName" TEXT,
    "docketNo" TEXT,
    "carrierContact" TEXT,
    "remarks" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "companySnapshot" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "customerId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceDate" DATE,
    "dueDate" DATE,
    "placeOfSupply" TEXT NOT NULL,
    "placeOfSupplyCode" TEXT NOT NULL,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountInWords" TEXT NOT NULL DEFAULT '',
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "customerSnapshot" JSONB,
    "companySnapshot" JSONB,
    "termsSnapshot" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "jobId" TEXT,
    "sampleTestId" TEXT,
    "description" TEXT NOT NULL,
    "sacCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(14,2) NOT NULL,
    "rateSource" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "unapplied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(6,3) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amountInWords" TEXT NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "companySnapshot" JSONB NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "emailLogId" TEXT,
    "sentById" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "ccAddress" TEXT,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "entity" TEXT,
    "entityId" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_name_idx" ON "User"("isActive", "name");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TermsVersion_kind_versionNo_key" ON "TermsVersion"("kind", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "StatusEvent_entity_entityId_at_idx" ON "StatusEvent"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "StatusEvent_jobId_at_idx" ON "StatusEvent"("jobId", "at");

-- CreateIndex
CREATE INDEX "StatusEvent_entity_toStatus_at_idx" ON "StatusEvent"("entity", "toStatus", "at");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_entity_entityId_category_idx" ON "FileObject"("entity", "entityId", "category");

-- CreateIndex
CREATE INDEX "DocumentJob_createdById_createdAt_idx" ON "DocumentJob"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedFilter_userId_screen_name_key" ON "SavedFilter"("userId", "screen", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_fromUnitId_toUnitId_key" ON "UnitConversion"("fromUnitId", "toUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TestMethod_code_key" ON "TestMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TestMaster_code_key" ON "TestMaster"("code");

-- CreateIndex
CREATE INDEX "TestMaster_departmentId_idx" ON "TestMaster"("departmentId");

-- CreateIndex
CREATE INDEX "TestMaster_isActive_name_idx" ON "TestMaster"("isActive", "name");

-- CreateIndex
CREATE INDEX "TestParameter_testId_sortOrder_idx" ON "TestParameter"("testId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TestParameter_testId_code_key" ON "TestParameter"("testId", "code");

-- CreateIndex
CREATE INDEX "Specification_customerId_idx" ON "Specification"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Specification_code_customerId_key" ON "Specification"("code", "customerId");

-- CreateIndex
CREATE INDEX "SpecificationLimit_parameterId_idx" ON "SpecificationLimit"("parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecificationLimit_specificationId_parameterId_key" ON "SpecificationLimit"("specificationId", "parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "TestGroup_code_key" ON "TestGroup"("code");

-- CreateIndex
CREATE INDEX "TestGroupItem_groupId_idx" ON "TestGroupItem"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSet_code_key" ON "ResultSet"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSetOption_resultSetId_value_key" ON "ResultSetOption"("resultSetId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Formula_code_key" ON "Formula"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaVersion_formulaId_versionNo_key" ON "FormulaVersion"("formulaId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_code_key" ON "Instrument"("code");

-- CreateIndex
CREATE INDEX "Instrument_calibrationDueAt_idx" ON "Instrument"("calibrationDueAt");

-- CreateIndex
CREATE INDEX "Instrument_departmentId_idx" ON "Instrument"("departmentId");

-- CreateIndex
CREATE INDEX "StandardRate_testId_effectiveFrom_idx" ON "StandardRate"("testId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CustomerRate_customerId_testId_effectiveFrom_idx" ON "CustomerRate"("customerId", "testId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RemarkTemplate_code_key" ON "RemarkTemplate"("code");

-- CreateIndex
CREATE INDEX "RemarkTemplate_testId_idx" ON "RemarkTemplate"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "LookupValue_kind_code_key" ON "LookupValue"("kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_crn_key" ON "Customer"("crn");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_gstin_idx" ON "Customer"("gstin");

-- CreateIndex
CREATE INDEX "Customer_isActive_name_idx" ON "Customer"("isActive", "name");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_stage_receivedOn_idx" ON "Order"("stage", "receivedOn");

-- CreateIndex
CREATE INDEX "Order_ownerId_idx" ON "Order"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNo_key" ON "Quotation"("quotationNo");

-- CreateIndex
CREATE INDEX "Quotation_customerId_createdAt_idx" ON "Quotation"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Quotation_status_validUntil_idx" ON "Quotation"("status", "validUntil");

-- CreateIndex
CREATE INDEX "Quotation_createdAt_idx" ON "Quotation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationVersion_quotationId_versionNo_key" ON "QuotationVersion"("quotationId", "versionNo");

-- CreateIndex
CREATE INDEX "QuotationLine_versionId_seq_idx" ON "QuotationLine"("versionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Job_jobNo_key" ON "Job"("jobNo");

-- CreateIndex
CREATE INDEX "Job_customerId_receivedAt_idx" ON "Job"("customerId", "receivedAt");

-- CreateIndex
CREATE INDEX "Job_status_receivedAt_idx" ON "Job"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Job_receivedAt_idx" ON "Job"("receivedAt");

-- CreateIndex
CREATE INDEX "Job_urgent_status_idx" ON "Job"("urgent", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_sampleNo_key" ON "Sample"("sampleNo");

-- CreateIndex
CREATE INDEX "Sample_jobId_idx" ON "Sample"("jobId");

-- CreateIndex
CREATE INDEX "Sample_status_createdAt_idx" ON "Sample"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Sample_returnable_returnStatus_idx" ON "Sample"("returnable", "returnStatus");

-- CreateIndex
CREATE INDEX "Sample_createdAt_idx" ON "Sample"("createdAt");

-- CreateIndex
CREATE INDEX "SampleAttribute_sampleId_idx" ON "SampleAttribute"("sampleId");

-- CreateIndex
CREATE INDEX "SampleDeviation_jobId_idx" ON "SampleDeviation"("jobId");

-- CreateIndex
CREATE INDEX "SampleDeviation_sampleId_idx" ON "SampleDeviation"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_planNo_key" ON "Plan"("planNo");

-- CreateIndex
CREATE INDEX "Plan_jobId_idx" ON "Plan"("jobId");

-- CreateIndex
CREATE INDEX "Plan_createdAt_idx" ON "Plan"("createdAt");

-- CreateIndex
CREATE INDEX "SampleTest_sampleId_idx" ON "SampleTest"("sampleId");

-- CreateIndex
CREATE INDEX "SampleTest_assignedToId_status_dueDate_idx" ON "SampleTest"("assignedToId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "SampleTest_status_dueDate_idx" ON "SampleTest"("status", "dueDate");

-- CreateIndex
CREATE INDEX "SampleTest_instrumentId_status_idx" ON "SampleTest"("instrumentId", "status");

-- CreateIndex
CREATE INDEX "SampleTest_departmentId_status_idx" ON "SampleTest"("departmentId", "status");

-- CreateIndex
CREATE INDEX "SampleTest_createdAt_idx" ON "SampleTest"("createdAt");

-- CreateIndex
CREATE INDEX "SampleTest_approvedAt_idx" ON "SampleTest"("approvedAt");

-- CreateIndex
CREATE INDEX "SampleTest_testId_status_idx" ON "SampleTest"("testId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SampleTestStage_sampleTestId_seq_key" ON "SampleTestStage"("sampleTestId", "seq");

-- CreateIndex
CREATE INDEX "ParameterResult_parameterId_idx" ON "ParameterResult"("parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "ParameterResult_sampleTestId_parameterId_key" ON "ParameterResult"("sampleTestId", "parameterId");

-- CreateIndex
CREATE INDEX "CalculationRecord_parameterResultId_createdAt_idx" ON "CalculationRecord"("parameterResultId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reportNo_key" ON "Report"("reportNo");

-- CreateIndex
CREATE INDEX "Report_sampleId_idx" ON "Report"("sampleId");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "ReportRevision_status_createdAt_idx" ON "ReportRevision"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRevision_issuedAt_idx" ON "ReportRevision"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_reportId_revisionNo_key" ON "ReportRevision"("reportId", "revisionNo");

-- CreateIndex
CREATE INDEX "ReportRejection_revisionId_idx" ON "ReportRejection"("revisionId");

-- CreateIndex
CREATE INDEX "ReportRejection_at_idx" ON "ReportRejection"("at");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSignature_revisionId_key" ON "ReportSignature"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_dispatchNo_key" ON "Dispatch"("dispatchNo");

-- CreateIndex
CREATE INDEX "Dispatch_jobId_idx" ON "Dispatch"("jobId");

-- CreateIndex
CREATE INDEX "Dispatch_dispatchDate_idx" ON "Dispatch"("dispatchDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "Invoice_customerId_invoiceDate_idx" ON "Invoice"("customerId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_seq_idx" ON "InvoiceLine"("invoiceId", "seq");

-- CreateIndex
CREATE INDEX "InvoiceLine_jobId_idx" ON "InvoiceLine"("jobId");

-- CreateIndex
CREATE INDEX "InvoiceLine_sampleTestId_idx" ON "InvoiceLine"("sampleTestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE INDEX "Payment_customerId_paidOn_idx" ON "Payment"("customerId", "paidOn");

-- CreateIndex
CREATE INDEX "Payment_paidOn_idx" ON "Payment"("paidOn");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_key" ON "CreditNote"("creditNoteNo");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_issuedOn_idx" ON "CreditNote"("issuedOn");

-- CreateIndex
CREATE INDEX "ReminderLog_invoiceId_at_idx" ON "ReminderLog"("invoiceId", "at");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "EmailLog_entity_entityId_createdAt_idx" ON "EmailLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestMaster" ADD CONSTRAINT "TestMaster_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestMaster" ADD CONSTRAINT "TestMaster_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "TestMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestParameter" ADD CONSTRAINT "TestParameter_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestParameter" ADD CONSTRAINT "TestParameter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestParameter" ADD CONSTRAINT "TestParameter_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestParameter" ADD CONSTRAINT "TestParameter_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specification" ADD CONSTRAINT "Specification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificationLimit" ADD CONSTRAINT "SpecificationLimit_specificationId_fkey" FOREIGN KEY ("specificationId") REFERENCES "Specification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificationLimit" ADD CONSTRAINT "SpecificationLimit_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "TestParameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupItem" ADD CONSTRAINT "TestGroupItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TestGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupItem" ADD CONSTRAINT "TestGroupItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupItem" ADD CONSTRAINT "TestGroupItem_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "TestParameter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSetOption" ADD CONSTRAINT "ResultSetOption_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaVersion" ADD CONSTRAINT "FormulaVersion_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardRate" ADD CONSTRAINT "StandardRate_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRate" ADD CONSTRAINT "CustomerRate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRate" ADD CONSTRAINT "CustomerRate_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationVersion" ADD CONSTRAINT "QuotationVersion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuotationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleAttribute" ADD CONSTRAINT "SampleAttribute_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleDeviation" ADD CONSTRAINT "SampleDeviation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleDeviation" ADD CONSTRAINT "SampleDeviation_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTest" ADD CONSTRAINT "SampleTest_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleTestStage" ADD CONSTRAINT "SampleTestStage_sampleTestId_fkey" FOREIGN KEY ("sampleTestId") REFERENCES "SampleTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParameterResult" ADD CONSTRAINT "ParameterResult_sampleTestId_fkey" FOREIGN KEY ("sampleTestId") REFERENCES "SampleTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRecord" ADD CONSTRAINT "CalculationRecord_parameterResultId_fkey" FOREIGN KEY ("parameterResultId") REFERENCES "ParameterResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRecord" ADD CONSTRAINT "CalculationRecord_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "FormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRejection" ADD CONSTRAINT "ReportRejection_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSignature" ADD CONSTRAINT "ReportSignature_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_sampleTestId_fkey" FOREIGN KEY ("sampleTestId") REFERENCES "SampleTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Audit log is append-only for everyone, including Admin and direct SQL users of this role.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
