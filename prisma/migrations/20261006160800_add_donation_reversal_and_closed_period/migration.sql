-- AlterTable
ALTER TABLE "mosques" ADD COLUMN "closedPeriodUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "donations" ADD COLUMN "reversalOfId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "donations_reversalOfId_key" ON "donations"("reversalOfId");

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

