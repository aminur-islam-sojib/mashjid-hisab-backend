-- CreateEnum
CREATE TYPE "FamilyRelation" AS ENUM ('SPOUSE', 'SON', 'DAUGHTER', 'FATHER', 'MOTHER', 'SIBLING', 'GRANDPARENT', 'OTHER');

-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "headMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" "FamilyRelation" NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "occupation" TEXT,
    "bloodGroup" TEXT,
    "linkedMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "families_headMembershipId_key" ON "families"("headMembershipId");

-- CreateIndex
CREATE INDEX "families_mosqueId_idx" ON "families"("mosqueId");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_linkedMembershipId_key" ON "family_members"("linkedMembershipId");

-- CreateIndex
CREATE INDEX "family_members_familyId_idx" ON "family_members"("familyId");

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_headMembershipId_fkey" FOREIGN KEY ("headMembershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_linkedMembershipId_fkey" FOREIGN KEY ("linkedMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
