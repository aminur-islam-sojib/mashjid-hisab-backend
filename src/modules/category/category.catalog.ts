// ---------------------------------------------------------------------------
// Standard Category Catalog & Seeder for Mosques
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  CategoryType,
  FundType,
  Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type { CategoryResponseItem } from "./category.service.js";

export interface DefaultCategoryTemplate {
  name: string;
  type: CategoryType;
  targetFundType?: FundType;
}

/**
 * Standard Mosque Income Categories (আয় খাতসমূহ)
 * Reflects authentic Bangladeshi mosque financial operations.
 */
export const DEFAULT_INCOME_CATEGORIES: readonly DefaultCategoryTemplate[] = [
  {
    name: "Friday Jummah Collection",
    type: CategoryType.INCOME,
  },
  {
    name: "General Donations & Sadaqah",
    type: CategoryType.INCOME,
  },
  {
    name: "Monthly Member Chanda",
    type: CategoryType.INCOME,
  },
  {
    name: "Zakat Collection",
    type: CategoryType.INCOME,
    targetFundType: FundType.ZAKAT,
  },
  {
    name: "Construction & Development",
    type: CategoryType.INCOME,
    targetFundType: FundType.CONSTRUCTION,
  },
  {
    name: "Ramadan & Iftar Donations",
    type: CategoryType.INCOME,
  },
  {
    name: "Eid Collections",
    type: CategoryType.INCOME,
  },
  {
    name: "Sadaqatul Fitr (Fitra)",
    type: CategoryType.INCOME,
  },
  {
    name: "Maktab & Quran Education Fees",
    type: CategoryType.INCOME,
  },
  {
    name: "Qurbani Skin Sales",
    type: CategoryType.INCOME,
  },
  {
    name: "Property & Shop Rent",
    type: CategoryType.INCOME,
  },
  {
    name: "Special Relief & Emergency",
    type: CategoryType.INCOME,
  },
];

/**
 * Standard Mosque Expense Categories (ব্যয় খাতসমূহ)
 * Reflects authentic Bangladeshi mosque expenditures and Shariah guidelines.
 */
export const DEFAULT_EXPENSE_CATEGORIES: readonly DefaultCategoryTemplate[] = [
  {
    name: "Imam & Khatib Honorarium",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Muazzin Honorarium",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Khadim & Staff Salary",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Electricity & Utility Bills",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Water & Sanitation",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Cleaning & Janitorial Supplies",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Repairs & Maintenance",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Ramadan & Iftar Expenses",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Eid Arrangements & Programs",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Printing, Stationery & Receipt Books",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Generator & Power Backup",
    type: CategoryType.EXPENSE,
  },
  {
    name: "Zakat & Poor Relief Disbursement",
    type: CategoryType.EXPENSE,
    targetFundType: FundType.ZAKAT,
  },
  {
    name: "Building Construction & Materials",
    type: CategoryType.EXPENSE,
    targetFundType: FundType.CONSTRUCTION,
  },
];

export interface SeedDefaultCategoriesResult {
  mosqueId: string;
  createdCount: number;
  skippedCount: number;
  totalCatalogCount: number;
  categories: CategoryResponseItem[];
}

export interface SeedDefaultCategoriesOptions {
  tx?: Prisma.TransactionClient;
}

/**
 * Seeds default Income and Expense categories for a mosque.
 *
 * Guarantees:
 * 1. Idempotency: Checks existing categories in this mosque (case-insensitive per type)
 *    and skips any that already exist. Never fails on duplicate constraints.
 * 2. Smart Fund Binding: If the mosque already has a Zakat fund (FundType.ZAKAT),
 *    Zakat categories are automatically restricted to it. Same for Construction funds.
 * 3. Transaction Support: Can run inside an ongoing transaction (e.g. during mosque creation).
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param options - Optional Prisma transaction client
 */
export async function seedDefaultCategoriesForMosque(
  mosqueId: string,
  options?: SeedDefaultCategoriesOptions,
): Promise<SeedDefaultCategoriesResult> {
  const db = options?.tx ?? prisma;

  // Resolve mosque using active client (supports transaction isolation)
  const mosque = await db.mosque.findFirst({
    where: {
      OR: [{ id: mosqueId }, { slug: mosqueId }],
    },
    select: { id: true, isArchived: true },
  });

  if (!mosque || mosque.isArchived) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  const resolvedMosqueId = mosque.id;

  // 1. Fetch active funds for this mosque to bind restricted categories
  const activeFunds = await db.fund.findMany({
    where: {
      mosqueId: resolvedMosqueId,
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      type: true,
      isRestricted: true,
    },
  });

  const zakatFund = activeFunds.find((f) => f.type === FundType.ZAKAT) ?? null;
  const constructionFund =
    activeFunds.find((f) => f.type === FundType.CONSTRUCTION) ?? null;

  // 2. Fetch existing categories in this mosque
  const existingCategories = await db.category.findMany({
    where: {
      mosqueId: resolvedMosqueId,
    },
    select: {
      id: true,
      name: true,
      type: true,
    },
  });

  // Build a lookup set of "type:lower_name"
  const existingLookup = new Set(
    existingCategories.map((c) => `${c.type}:${c.name.trim().toLowerCase()}`),
  );

  const fullCatalog = [
    ...DEFAULT_INCOME_CATEGORIES,
    ...DEFAULT_EXPENSE_CATEGORIES,
  ];

  let createdCount = 0;
  let skippedCount = 0;
  const toCreate: Array<{
    mosqueId: string;
    name: string;
    type: CategoryType;
    fundId: string | null;
  }> = [];

  for (const item of fullCatalog) {
    const key = `${item.type}:${item.name.trim().toLowerCase()}`;
    if (existingLookup.has(key)) {
      skippedCount++;
      continue;
    }

    // Determine target fund if template specifies a target fund type
    let fundId: string | null = null;
    if (item.targetFundType === FundType.ZAKAT && zakatFund) {
      fundId = zakatFund.id;
    } else if (
      item.targetFundType === FundType.CONSTRUCTION &&
      constructionFund
    ) {
      fundId = constructionFund.id;
    }

    toCreate.push({
      mosqueId: resolvedMosqueId,
      name: item.name,
      type: item.type,
      fundId,
    });
  }

  if (toCreate.length > 0) {
    await db.category.createMany({
      data: toCreate,
    });
    createdCount = toCreate.length;
  }

  // 3. Return updated category list for this mosque
  const allCategories = await db.category.findMany({
    where: {
      mosqueId: resolvedMosqueId,
      isArchived: false,
    },
    select: {
      id: true,
      mosqueId: true,
      fundId: true,
      name: true,
      type: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      fund: {
        select: {
          id: true,
          name: true,
          type: true,
          isRestricted: true,
        },
      },
    },
    orderBy: [
      { type: "asc" },
      { name: "asc" },
    ],
  });

  return {
    mosqueId: resolvedMosqueId,
    createdCount,
    skippedCount,
    totalCatalogCount: fullCatalog.length,
    categories: allCategories.map((c) => ({
      ...c,
      fund: c.fund ?? null,
    })),
  };
}
