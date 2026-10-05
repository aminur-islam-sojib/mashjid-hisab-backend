// ---------------------------------------------------------------------------
// Fund Service — Mosque Financial Funds Management
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  FundType,
  type Fund,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateFundInput,
  GetMosqueFundsQuery,
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
