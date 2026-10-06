-- CreateEnum
CREATE TYPE "TransferLeg" AS ENUM ('FROM', 'TO');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "leg" "TransferLeg" NOT NULL,
    "amount" BIGINT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'POSTED',
    "reason" TEXT,
    "notes" TEXT,
    "linkedTransferId" TEXT,
    "voidReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reversalOfId_key" ON "transfers"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_mosqueId_transferNumber_leg_key" ON "transfers"("mosqueId", "transferNumber", "leg");

-- CreateIndex
CREATE INDEX "transfers_mosqueId_idx" ON "transfers"("mosqueId");

-- CreateIndex
CREATE INDEX "transfers_transferNumber_idx" ON "transfers"("transferNumber");

-- CreateIndex
CREATE INDEX "transfers_accountId_idx" ON "transfers"("accountId");

-- CreateIndex
CREATE INDEX "transfers_fundId_idx" ON "transfers"("fundId");

-- CreateIndex
CREATE INDEX "transfers_date_idx" ON "transfers"("date");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_linkedTransferId_fkey" FOREIGN KEY ("linkedTransferId") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

