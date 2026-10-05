// ---------------------------------------------------------------------------
// Fund Service — Mosque Financial Funds Management
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  FundType,
  type Fund,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateFundInput,
  GetMosqueFundsQuery,
  UpdateFundInput,
} from "./fund.validation.js";

export interface FundResponseItem {
  id: string;
  mosqueId: string;
  name: string;
  type: FundType;
  isRestricted: boolean;
  description: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  categoryCount?: number;
}

/**
 * Creates a new financial Fund for a mosque.
 *
 * Business & Security Rules:
 * - Mosque must exist and not be archived (verified via resolveActiveMosqueId).
 * - Name uniqueness is scoped per mosque (enforced at both DB and application levels).
 * - An archived fund with the same name blocks creation to preserve data integrity and DB unique constraint.
 * - Restricted funds (isRestricted: true) later lock categories strictly at transaction time.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param input - Validated create fund payload
 */
export async function createFund(
  mosqueId: string,
  input: CreateFundInput,
): Promise<FundResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Check for existing fund with identical name (case-insensitive) in this mosque
  const existingFund = await prisma.fund.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
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

  if (existingFund) {
    if (existingFund.isArchived) {
      throw HttpError.conflict(
        `A fund named '${input.name}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
        "FUND_NAME_ARCHIVED_EXISTS",
      );
    }
    throw HttpError.conflict(
      `A fund named '${input.name}' already exists in this mosque.`,
      "FUND_NAME_EXISTS",
    );
  }

  const fund = await prisma.fund.create({
    data: {
      mosqueId: resolvedMosqueId,
      name: input.name,
      type: input.type,
      isRestricted: input.isRestricted,
      description: input.description || null,
    },
    select: {
      id: true,
      mosqueId: true,
      name: true,
      type: true,
      isRestricted: true,
      description: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return fund;
}

/**
 * Lists Funds for a mosque.
 *
 * Access: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 * Default: Returns active (non-archived) funds.
 * If query.includeArchived is true: Returns all funds including archived.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param query - Optional query filters (includeArchived, type, isRestricted, search)
 */
export async function getMosqueFunds(
  mosqueId: string,
  query?: GetMosqueFundsQuery,
): Promise<FundResponseItem[]> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const where: Prisma.FundWhereInput = {
    mosqueId: resolvedMosqueId,
  };

  // Filter archived status
  if (!query?.includeArchived) {
    where.isArchived = false;
  }

  // Optional type filter
  if (query?.type) {
    where.type = query.type;
  }

  // Optional restriction filter
  if (typeof query?.isRestricted === "boolean") {
    where.isRestricted = query.isRestricted;
  }

  // Optional search query on fund name
  if (query?.search) {
    where.name = {
      contains: query.search,
      mode: "insensitive",
    };
  }

  const funds = await prisma.fund.findMany({
    where,
    orderBy: [
      { isArchived: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      mosqueId: true,
      name: true,
      type: true,
      isRestricted: true,
      description: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          categories: true,
        },
      },
    },
  });

  return funds.map((f) => ({
    id: f.id,
    mosqueId: f.mosqueId,
    name: f.name,
    type: f.type,
    isRestricted: f.isRestricted,
    description: f.description,
    isArchived: f.isArchived,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    categoryCount: f._count.categories,
  }));
}

/**
 * Retrieves the count of recorded financial transactions or journal entries
 * associated with a specific fund.
 *
 * If the transaction/ledger tables have not yet been migrated into the database,
 * safely returns 0 transactions. Once tables (such as 'transactions', 'ledger_entries',
 * or 'journal_lines') are migrated with a 'fundId' column, this dynamically queries
 * the actual row count without breaking prior to the migration.
 *
 * @param fundId - CUID of the fund
 * @param client - Prisma client or transaction client
 */
export async function getFundTransactionCount(
  fundId: string,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<number> {
  try {
    const matchingTables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('transactions', 'ledger_entries', 'journal_lines', 'fund_transactions')
    `;

    if (!matchingTables || matchingTables.length === 0) {
      return 0;
    }

    let total = 0;
    for (const row of matchingTables) {
      const tableName = row.table_name;
      const columnExists = await client.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
          AND column_name = 'fundId'
      `;

      if (columnExists && columnExists.length > 0) {
        const countResult = await client.$queryRawUnsafe<Array<{ count: string | number | bigint }>>(
          `SELECT COUNT(*)::text AS count FROM "${tableName}" WHERE "fundId" = $1`,
          fundId,
        );
        if (countResult && countResult[0] && countResult[0].count !== undefined) {
          total += Number(countResult[0].count);
        }
      }
    }

    return total;
  } catch {
    return 0;
  }
}

/**
 * Retrieves a single Fund by ID scoped to the specified mosque.
 *
 * Anti-enumeration and tenant boundary guarantee:
 * Throws 404 Not Found if the fund does not exist or belongs to another mosque.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param fundId - CUID of the fund
 */
export async function getFundById(
  mosqueId: string,
  fundId: string,
): Promise<FundResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const fund = await prisma.fund.findFirst({
    where: {
      id: fundId,
      mosqueId: resolvedMosqueId,
    },
    select: {
      id: true,
      mosqueId: true,
      name: true,
      type: true,
      isRestricted: true,
      description: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          categories: true,
        },
      },
    },
  });

  if (!fund) {
    throw HttpError.notFound("Fund not found.", "FUND_NOT_FOUND");
  }

  return {
    id: fund.id,
    mosqueId: fund.mosqueId,
    name: fund.name,
    type: fund.type,
    isRestricted: fund.isRestricted,
    description: fund.description,
    isArchived: fund.isArchived,
    createdAt: fund.createdAt,
    updatedAt: fund.updatedAt,
    categoryCount: fund._count.categories,
  };
}

/**
 * Updates a financial Fund for a mosque (name, description, isRestricted).
 *
 * Business & Security Rules:
 * 1. Multi-Tenant Scoping: Fund must belong strictly to `resolvedMosqueId`.
 *    Returns 404 if not found or belongs to another tenant.
 * 2. Inactive/Archived Guard: Cannot update an archived fund (throws 400 FUND_ARCHIVED).
 * 3. Unique Name Enforcement: Renaming checks against both active and archived funds
 *    in the same mosque (case-insensitive) to prevent collision with @@unique([mosqueId, name]).
 * 4. Policy Change Safety Rail:
 *    Flipping `isRestricted` on a Fund that already has transactions is a major policy
 *    change affecting Shariah ring-fencing and category-spending constraints.
 *    Blocks with 400 FUND_RESTRICTION_CHANGE_CONFIRMATION_REQUIRED unless an explicit
 *    confirmation flag (`confirmPolicyChange: true` or `confirmRestrictionChange: true`)
 *    is included in the request body.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param fundId - CUID of the fund to update
 * @param input - Validated update fields and optional confirmation flags
 */
export async function updateFund(
  mosqueId: string,
  fundId: string,
  input: UpdateFundInput,
): Promise<FundResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // 1. Fetch current fund within tenant boundary
  const currentFund = await prisma.fund.findFirst({
    where: {
      id: fundId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!currentFund) {
    throw HttpError.notFound("Fund not found.", "FUND_NOT_FOUND");
  }

  // 2. Reject modifications to archived funds
  if (currentFund.isArchived) {
    throw HttpError.badRequest(
      "Cannot update an archived fund. Please restore it first.",
      "FUND_ARCHIVED",
    );
  }

  // 3. Name uniqueness verification if name is changing
  if (input.name !== undefined && input.name.trim().toLowerCase() !== currentFund.name.toLowerCase()) {
    const existingWithSameName = await prisma.fund.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        id: { not: currentFund.id },
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
          `A fund named '${input.name.trim()}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
          "FUND_NAME_ARCHIVED_EXISTS",
        );
      }
      throw HttpError.conflict(
        `A fund named '${input.name.trim()}' already exists in this mosque.`,
        "FUND_NAME_EXISTS",
      );
    }
  }

  // 4. Policy change check for isRestricted flip
  const isFlippingRestriction =
    input.isRestricted !== undefined &&
    input.isRestricted !== currentFund.isRestricted;

  if (isFlippingRestriction) {
    const transactionCount = await getFundTransactionCount(currentFund.id);
    const isConfirmed = Boolean(
      input.confirmPolicyChange ||
      input.confirmRestrictionChange ||
      input.confirm,
    );

    if (transactionCount > 0 && !isConfirmed) {
      const fromStatus = currentFund.isRestricted ? "restricted" : "unrestricted";
      const toStatus = input.isRestricted ? "restricted" : "unrestricted";

      throw HttpError.badRequest(
        `This fund already has ${transactionCount} recorded transaction(s). Flipping its restriction status from ${fromStatus} to ${toStatus} is a major financial policy change that impacts category spending rules and Shariah ring-fencing. To confirm this change, set 'confirmPolicyChange: true' in your request body.`,
        "FUND_RESTRICTION_CHANGE_CONFIRMATION_REQUIRED",
      );
    }
  }

  // 5. Apply updates atomically
  try {
    const updatedFund = await prisma.fund.update({
      where: { id: currentFund.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isRestricted !== undefined ? { isRestricted: input.isRestricted } : {}),
      },
      select: {
        id: true,
        mosqueId: true,
        name: true,
        type: true,
        isRestricted: true,
        description: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            categories: true,
          },
        },
      },
    });

    return {
      id: updatedFund.id,
      mosqueId: updatedFund.mosqueId,
      name: updatedFund.name,
      type: updatedFund.type,
      isRestricted: updatedFund.isRestricted,
      description: updatedFund.description,
      isArchived: updatedFund.isArchived,
      createdAt: updatedFund.createdAt,
      updatedAt: updatedFund.updatedAt,
      categoryCount: updatedFund._count.categories,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        `A fund named '${input.name}' already exists in this mosque.`,
        "FUND_NAME_EXISTS",
      );
    }
    throw error;
  }
}

