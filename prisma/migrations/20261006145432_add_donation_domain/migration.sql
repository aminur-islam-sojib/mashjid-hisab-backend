-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DonationSource" AS ENUM ('CASH_BOX', 'MEMBER', 'ONLINE', 'BANK');

-- CreateTable
CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT,
    "familyId" TEXT,
    "donorName" TEXT,
    "donorPhone" TEXT,
    "donorEmail" TEXT,
    "isAnonymousPublic" BOOLEAN NOT NULL DEFAULT false,
    "campaignId" TEXT,
    "dueId" TEXT,
    "pledgeId" TEXT,
    "source" "DonationSource" NOT NULL DEFAULT 'MEMBER',
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "receiptNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "donations_mosqueId_idx" ON "donations"("mosqueId");

-- CreateIndex
CREATE INDEX "donations_accountId_idx" ON "donations"("accountId");

-- CreateIndex
CREATE INDEX "donations_fundId_idx" ON "donations"("fundId");

-- CreateIndex
CREATE INDEX "donations_categoryId_idx" ON "donations"("categoryId");

-- CreateIndex
CREATE INDEX "donations_memberId_idx" ON "donations"("memberId");

-- CreateIndex
CREATE INDEX "donations_familyId_idx" ON "donations"("familyId");

-- CreateIndex
CREATE INDEX "donations_date_idx" ON "donations"("date");

-- CreateIndex
CREATE INDEX "donations_status_idx" ON "donations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "donations_mosqueId_receiptNumber_key" ON "donations"("mosqueId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
