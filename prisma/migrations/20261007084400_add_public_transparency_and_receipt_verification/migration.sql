-- AlterTable
ALTER TABLE "mosques" ADD COLUMN IF NOT EXISTS "publicTransparency" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "donations" ADD COLUMN IF NOT EXISTS "verificationCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "donations_verificationCode_key" ON "donations"("verificationCode");

