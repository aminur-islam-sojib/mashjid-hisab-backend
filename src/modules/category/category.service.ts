// ---------------------------------------------------------------------------
// Category Service — Mosque Financial Categories Management
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  CategoryType,
  FundType,
  Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateCategoryInput,
  GetMosqueCategoriesQuery,
  UpdateCategoryInput,
} from "./category.validation.js";

export interface CategoryFundSummary {
  id: string;
  name: string;
  type: FundType;
  isRestricted: boolean;
}

export interface CategoryResponseItem {
  id: string;
  mosqueId: string;
  fundId: string | null;
  name: string;
  type: CategoryType;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  fund: CategoryFundSummary | null;
}

/**
 * Creates a new financial Category for a mosque (e.g. Friday Collection, Utilities, Zakat Disbursement).
 *
 * Business & Security Rules:
 * - Mosque must exist and not be archived (verified via resolveActiveMosqueId).
 * - Optional fundId: Setting fundId is what restricts this category to one Fund only
 *   (e.g., Zakat categories are linked directly to the Zakat fund, ensuring General donations cannot
 *   cross into Zakat and Zakat cannot pay general operational expenses).
 * - Multi-tenant isolation: If fundId is specified, the fund must belong strictly to the same mosque.
 * - Inactive Fund guard: Cannot link a category to an archived fund.
 * - Name + Type uniqueness: In a mosque, category names are unique per type (case-insensitive).
 *   Cannot create a duplicate if active or archived category exists with the same (name, type).
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param input - Validated create category payload
 */
export async function createCategory(
  mosqueId: string,
  input: CreateCategoryInput,
): Promise<CategoryResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // 1. If fundId is provided, verify it exists, belongs to this mosque, and is not archived
  if (input.fundId) {
    const fund = await prisma.fund.findFirst({
      where: {
        id: input.fundId,
        mosqueId: resolvedMosqueId,
      },
      select: {
        id: true,
        name: true,
        type: true,
        isRestricted: true,
        isArchived: true,
      },
    });

    if (!fund) {
      throw HttpError.notFound(
        "Fund not found in this mosque.",
        "FUND_NOT_FOUND",
      );
    }

    if (fund.isArchived) {
      throw HttpError.badRequest(
        "Cannot associate category with an archived fund. Please select an active fund or restore the fund first.",
        "FUND_ARCHIVED",
      );
    }
  }

  // 2. Check for duplicate category name within this mosque for the same type (case-insensitive)
  const existingCategory = await prisma.category.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      type: input.type,
      name: {
        equals: input.name,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
      isArchived: true,
    },
  });

  if (existingCategory) {
    if (existingCategory.isArchived) {
      throw HttpError.conflict(
        `A ${input.type.toLowerCase()} category named '${input.name}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
        "CATEGORY_NAME_ARCHIVED_EXISTS",
      );
    }
    throw HttpError.conflict(
      `A ${input.type.toLowerCase()} category named '${input.name}' already exists in this mosque.`,
      "CATEGORY_NAME_EXISTS",
    );
  }

  // 3. Create the category
  try {
    const category = await prisma.category.create({
      data: {
        mosqueId: resolvedMosqueId,
        name: input.name,
        type: input.type,
        fundId: input.fundId ?? null,
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
    });

    return {
      id: category.id,
      mosqueId: category.mosqueId,
      fundId: category.fundId,
      name: category.name,
      type: category.type,
      isArchived: category.isArchived,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      fund: category.fund ?? null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        `A ${input.type.toLowerCase()} category named '${input.name}' already exists in this mosque.`,
        "CATEGORY_NAME_EXISTS",
      );
    }
    throw error;
  }
}

/**
 * Retrieves a single Category by ID scoped to the specified mosque.
 *
 * Anti-enumeration and tenant boundary guarantee:
 * Throws 404 Not Found if the category does not exist or belongs to another mosque.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param categoryId - CUID of the category
 */
export async function getCategoryById(
  mosqueId: string,
  categoryId: string,
): Promise<CategoryResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      mosqueId: resolvedMosqueId,
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
  });

  if (!category) {
    throw HttpError.notFound("Category not found.", "CATEGORY_NOT_FOUND");
  }

  return {
    id: category.id,
    mosqueId: category.mosqueId,
    fundId: category.fundId,
    name: category.name,
    type: category.type,
    isArchived: category.isArchived,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    fund: category.fund ?? null,
  };
}

/**
 * Lists Categories for a mosque.
 *
 * Access: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF.
 * Staff members are included because they need to select categories when
 * submitting or recording operational expenses (e.g. cleaning supplies, utility bills).
 * Default: Returns active (non-archived) categories.
 * If query.includeArchived is true: Returns all categories including archived.
 * Filterable by:
 * - ?type= (INCOME | EXPENSE)
 * - ?fundId= (specific fund CUID or 'null'/'unrestricted' for general categories)
 * - ?search= (case-insensitive name search)
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param query - Optional query filters (includeArchived, type, fundId, search)
 */
export async function getMosqueCategories(
  mosqueId: string,
  query?: GetMosqueCategoriesQuery,
): Promise<CategoryResponseItem[]> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const where: Prisma.CategoryWhereInput = {
    mosqueId: resolvedMosqueId,
  };

  // Filter archived status (default: active only)
  if (!query?.includeArchived) {
    where.isArchived = false;
  }

  // Optional type filter (INCOME / EXPENSE)
  if (query?.type) {
    where.type = query.type;
  }

  // Optional fundId filter
  if (query?.fundId !== undefined) {
    where.fundId = query.fundId;
  }

  // Optional search query on category name
  if (query?.search) {
    where.name = {
      contains: query.search,
      mode: "insensitive",
    };
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: [
      { isArchived: "asc" },
      { type: "asc" },
      { name: "asc" },
    ],
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
  });

  return categories.map((c) => ({
    id: c.id,
    mosqueId: c.mosqueId,
    fundId: c.fundId,
    name: c.name,
    type: c.type,
    isArchived: c.isArchived,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    fund: c.fund ?? null,
  }));
}

/**
 * Updates a financial Category for a mosque (name, fundId).
 *
 * Business & Security Rules:
 * 1. Multi-Tenant Scoping: Category must belong strictly to resolvedMosqueId (404 if not found).
 * 2. Inactive/Archived Guard: Cannot update an archived category (400 CATEGORY_ARCHIVED).
 * 3. Unique Name Enforcement: Renaming checks against both active and archived categories
 *    with the same type in the same mosque (case-insensitive) to prevent collision with @@unique([mosqueId, name, type]).
 * 4. Fund Association & Non-Rewriting Invariant:
 *    Changing fundId on a category already used by past transactions does NOT rewrite history;
 *    it only affects future entries. Target fund must exist, belong to this mosque, and not be archived.
 *    Setting fundId: null clears the restriction and allows the category to be used across any fund.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param categoryId - CUID of the category to update
 * @param input - Validated update fields (name, fundId)
 */
export async function updateCategory(
  mosqueId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // 1. Fetch current category within tenant boundary
  const currentCategory = await prisma.category.findFirst({
    where: {
      id: categoryId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!currentCategory) {
    throw HttpError.notFound("Category not found.", "CATEGORY_NOT_FOUND");
  }

  // 2. Reject modifications to archived categories
  if (currentCategory.isArchived) {
    throw HttpError.badRequest(
      "Cannot update an archived category. Please restore it first.",
      "CATEGORY_ARCHIVED",
    );
  }

  // 3. Name uniqueness verification if name is changing
  if (input.name !== undefined && input.name.trim().toLowerCase() !== currentCategory.name.toLowerCase()) {
    const existingWithSameName = await prisma.category.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        type: currentCategory.type,
        id: { not: currentCategory.id },
        name: {
          equals: input.name.trim(),
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        isArchived: true,
      },
    });

    if (existingWithSameName) {
      if (existingWithSameName.isArchived) {
        throw HttpError.conflict(
          `A ${currentCategory.type.toLowerCase()} category named '${input.name.trim()}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
          "CATEGORY_NAME_ARCHIVED_EXISTS",
        );
      }
      throw HttpError.conflict(
        `A ${currentCategory.type.toLowerCase()} category named '${input.name.trim()}' already exists in this mosque.`,
        "CATEGORY_NAME_EXISTS",
      );
    }
  }

  // 4. Validate new fundId if changing and non-null
  if (input.fundId !== undefined && input.fundId !== null && input.fundId !== currentCategory.fundId) {
    const fund = await prisma.fund.findFirst({
      where: {
        id: input.fundId,
        mosqueId: resolvedMosqueId,
      },
      select: {
        id: true,
        name: true,
        type: true,
        isRestricted: true,
        isArchived: true,
      },
    });

    if (!fund) {
      throw HttpError.notFound(
        "Fund not found in this mosque.",
        "FUND_NOT_FOUND",
      );
    }

    if (fund.isArchived) {
      throw HttpError.badRequest(
        "Cannot associate category with an archived fund. Please select an active fund or restore the fund first.",
        "FUND_ARCHIVED",
      );
    }
  }

  // 5. Apply updates atomically
  try {
    const updatedCategory = await prisma.category.update({
      where: { id: currentCategory.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.fundId !== undefined ? { fundId: input.fundId } : {}),
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
    });

    return {
      id: updatedCategory.id,
      mosqueId: updatedCategory.mosqueId,
      fundId: updatedCategory.fundId,
      name: updatedCategory.name,
      type: updatedCategory.type,
      isArchived: updatedCategory.isArchived,
      createdAt: updatedCategory.createdAt,
      updatedAt: updatedCategory.updatedAt,
      fund: updatedCategory.fund ?? null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        `A ${currentCategory.type.toLowerCase()} category named '${input.name}' already exists in this mosque.`,
        "CATEGORY_NAME_EXISTS",
      );
    }
    throw error;
  }
}


