-- CreateTable
CREATE TABLE "mosque_invite_links" (
    "id" TEXT NOT NULL,
    "mosqueId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mosque_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mosque_invite_links_tokenHash_key" ON "mosque_invite_links"("tokenHash");

-- CreateIndex
CREATE INDEX "mosque_invite_links_mosqueId_idx" ON "mosque_invite_links"("mosqueId");

-- AddForeignKey
ALTER TABLE "mosque_invite_links" ADD CONSTRAINT "mosque_invite_links_mosqueId_fkey" FOREIGN KEY ("mosqueId") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mosque_invite_links" ADD CONSTRAINT "mosque_invite_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
