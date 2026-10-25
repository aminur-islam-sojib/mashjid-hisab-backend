-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "PledgeStatus" AS ENUM ('OPEN', 'PARTIAL', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChandaFrequency" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ChandaPlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "DueStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('OPEN', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PeriodAction" AS ENUM ('CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DASHBOARD', 'BALANCES', 'INCOME_EXPENSE', 'FUND_STATEMENT', 'ACCOUNT_STATEMENT', 'DONORS', 'FISCAL_YEAR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'APPROVE', 'VOID', 'WAIVE', 'REJECT', 'CLOSE_PERIOD', 'REOPEN_PERIOD', 'RECONCILE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('DONATION', 'EXPENSE', 'TRANSFER', 'DUE', 'PERIOD', 'COLLECTION', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'RESOLVED', 'FAILED');

-- AlterTable
ALTER TABLE "donations" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "funds" ADD COLUMN     "openingBalance" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "mosques" ADD COLUMN     "archiveRequestReason" TEXT,
ADD COLUMN     "archiveRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archiveRequestedAt" TIMESTAMP(3),
ADD COLUMN     "archiveRequestedById" TEXT,
ADD COLUMN     "isTransparencyPageEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "isFundTransfer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "actorId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" BIGINT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chanda_plans" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "frequency" "ChandaFrequency" NOT NULL DEFAULT 'MONTHLY',
    "startMonth" TEXT NOT NULL,
    "familyId" TEXT,
    "memberId" TEXT,
    "status" "ChandaPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chanda_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "familyId" TEXT,
    "memberId" TEXT,
    "period" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "paidAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "DueStatus" NOT NULL DEFAULT 'UNPAID',
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_sessions" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "notes" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'OPEN',
    "fundId" TEXT,
    "accountId" TEXT,
    "categoryId" TEXT,
    "createdById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "donationId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL,
    "requestMethod" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pledges" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "campaignId" TEXT,
    "amount" BIGINT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "installments" INTEGER,
    "memberId" TEXT,
    "familyId" TEXT,
    "donorName" TEXT,
    "donorPhone" TEXT,
    "donorEmail" TEXT,
    "notes" TEXT,
    "status" "PledgeStatus" NOT NULL DEFAULT 'OPEN',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pledges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_audit_logs" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "action" "PeriodAction" NOT NULL,
    "reason" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_reconciliations" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systemBalance" BIGINT NOT NULL,
    "realBalance" BIGINT NOT NULL,
    "difference" BIGINT NOT NULL,
    "notes" TEXT,
    "reconciledById" TEXT NOT NULL,
    "adjustmentDonationId" TEXT,
    "adjustmentExpenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB,
    "downloadUrl" TEXT,
    "fileContent" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "requestedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_mosqueId_idx" ON "attachments"("mosqueId");

-- CreateIndex
CREATE INDEX "attachments_uploadedById_idx" ON "attachments"("uploadedById");

-- CreateIndex
CREATE INDEX "audit_logs_mosqueId_idx" ON "audit_logs"("mosqueId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "campaigns_mosqueId_idx" ON "campaigns"("mosqueId");

-- CreateIndex
CREATE INDEX "campaigns_fundId_idx" ON "campaigns"("fundId");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_startDate_idx" ON "campaigns"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_mosqueId_title_key" ON "campaigns"("mosqueId", "title");

-- CreateIndex
CREATE INDEX "chanda_plans_mosqueId_idx" ON "chanda_plans"("mosqueId");

-- CreateIndex
CREATE INDEX "chanda_plans_fundId_idx" ON "chanda_plans"("fundId");

-- CreateIndex
CREATE INDEX "chanda_plans_familyId_idx" ON "chanda_plans"("familyId");

-- CreateIndex
CREATE INDEX "chanda_plans_memberId_idx" ON "chanda_plans"("memberId");

-- CreateIndex
CREATE INDEX "chanda_plans_status_idx" ON "chanda_plans"("status");

-- CreateIndex
CREATE INDEX "dues_mosqueId_idx" ON "dues"("mosqueId");

-- CreateIndex
CREATE INDEX "dues_fundId_idx" ON "dues"("fundId");

-- CreateIndex
CREATE INDEX "dues_familyId_idx" ON "dues"("familyId");

-- CreateIndex
CREATE INDEX "dues_memberId_idx" ON "dues"("memberId");

-- CreateIndex
CREATE INDEX "dues_period_idx" ON "dues"("period");

-- CreateIndex
CREATE INDEX "dues_status_idx" ON "dues"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dues_planId_period_key" ON "dues"("planId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "collection_sessions_donationId_key" ON "collection_sessions"("donationId");

-- CreateIndex
CREATE INDEX "collection_sessions_mosqueId_idx" ON "collection_sessions"("mosqueId");

-- CreateIndex
CREATE INDEX "collection_sessions_status_idx" ON "collection_sessions"("status");

-- CreateIndex
CREATE INDEX "collection_sessions_date_idx" ON "collection_sessions"("date");

-- CreateIndex
CREATE INDEX "idempotency_keys_mosqueId_idx" ON "idempotency_keys"("mosqueId");

-- CreateIndex
CREATE INDEX "idempotency_keys_userId_idx" ON "idempotency_keys"("userId");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_mosqueId_userId_key_key" ON "idempotency_keys"("mosqueId", "userId", "key");

-- CreateIndex
CREATE INDEX "pledges_mosqueId_idx" ON "pledges"("mosqueId");

-- CreateIndex
CREATE INDEX "pledges_fundId_idx" ON "pledges"("fundId");

-- CreateIndex
CREATE INDEX "pledges_campaignId_idx" ON "pledges"("campaignId");

-- CreateIndex
CREATE INDEX "pledges_memberId_idx" ON "pledges"("memberId");

-- CreateIndex
CREATE INDEX "pledges_familyId_idx" ON "pledges"("familyId");

-- CreateIndex
CREATE INDEX "pledges_status_idx" ON "pledges"("status");

-- CreateIndex
CREATE INDEX "pledges_dueDate_idx" ON "pledges"("dueDate");

-- CreateIndex
CREATE INDEX "period_audit_logs_mosqueId_idx" ON "period_audit_logs"("mosqueId");

-- CreateIndex
CREATE INDEX "period_audit_logs_period_idx" ON "period_audit_logs"("period");

-- CreateIndex
CREATE UNIQUE INDEX "account_reconciliations_adjustmentDonationId_key" ON "account_reconciliations"("adjustmentDonationId");

-- CreateIndex
CREATE UNIQUE INDEX "account_reconciliations_adjustmentExpenseId_key" ON "account_reconciliations"("adjustmentExpenseId");

-- CreateIndex
CREATE INDEX "account_reconciliations_mosqueId_idx" ON "account_reconciliations"("mosqueId");

-- CreateIndex
CREATE INDEX "account_reconciliations_accountId_idx" ON "account_reconciliations"("accountId");

-- CreateIndex
CREATE INDEX "account_reconciliations_asOf_idx" ON "account_reconciliations"("asOf");

-- CreateIndex
CREATE INDEX "report_exports_mosqueId_idx" ON "report_exports"("mosqueId");

-- CreateIndex
CREATE INDEX "report_exports_requestedById_idx" ON "report_exports"("requestedById");

-- CreateIndex
CREATE INDEX "donations_pledgeId_idx" ON "donations"("pledgeId");

-- CreateIndex
CREATE INDEX "donations_dueId_idx" ON "donations"("dueId");

-- CreateIndex
CREATE INDEX "transfers_isFundTransfer_idx" ON "transfers"("isFundTransfer");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chanda_plans" ADD CONSTRAINT "chanda_plans_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chanda_plans" ADD CONSTRAINT "chanda_plans_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chanda_plans" ADD CONSTRAINT "chanda_plans_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chanda_plans" ADD CONSTRAINT "chanda_plans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chanda_plans" ADD CONSTRAINT "chanda_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_planId_fkey" FOREIGN KEY ("planId") REFERENCES "chanda_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues" ADD CONSTRAINT "dues_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_dueId_fkey" FOREIGN KEY ("dueId") REFERENCES "dues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "pledges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_audit_logs" ADD CONSTRAINT "period_audit_logs_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_audit_logs" ADD CONSTRAINT "period_audit_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_adjustmentDonationId_fkey" FOREIGN KEY ("adjustmentDonationId") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_adjustmentExpenseId_fkey" FOREIGN KEY ("adjustmentExpenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

