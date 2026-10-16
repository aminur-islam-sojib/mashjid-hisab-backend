// ---------------------------------------------------------------------------
// Maintenance Script: Seed Default Income & Expense Categories for Mosques
// Usage: npx tsx scripts/seed-categories.ts [--mosqueId <id>]
// ---------------------------------------------------------------------------

import { prisma } from "../src/lib/prisma.js";
import { seedDefaultCategoriesForMosque } from "../src/modules/category/category.catalog.js";

async function main() {
  console.log("🌱 Starting Mosque Categories Seeder...\n");

  const args = process.argv.slice(2);
  const mosqueIdIndex = args.indexOf("--mosqueId");
  const specificMosqueId = mosqueIdIndex !== -1 ? args[mosqueIdIndex + 1] : null;

  const mosques = await prisma.mosque.findMany({
    where: {
      ...(specificMosqueId ? { id: specificMosqueId } : {}),
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      slug: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (mosques.length === 0) {
    console.log("⚠️ No active mosques found to seed.");
    return;
  }

  console.log(`Found ${mosques.length} active mosque(s) to process.\n`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const mosque of mosques) {
    try {
      const result = await seedDefaultCategoriesForMosque(mosque.id);
      totalCreated += result.createdCount;
      totalSkipped += result.skippedCount;

      console.log(
        `✅ [${mosque.name}] (${mosque.slug}): +${result.createdCount} created, ${result.skippedCount} already existed (Total: ${result.categories.length})`,
      );
    } catch (err: any) {
      console.error(`❌ Failed to seed categories for "${mosque.name}":`, err.message);
    }
  }

  console.log("\n============================================");
  console.log("🎉 Seeding complete!");
  console.log(`Total new categories created: ${totalCreated}`);
  console.log(`Total categories skipped (already present): ${totalSkipped}`);
  console.log("============================================\n");
}

main()
  .catch((e) => {
    console.error("Fatal error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

