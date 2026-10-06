// =============================================================================
// collection.service.ts — Domain 8: Collection Sessions (Jummah box, Eid, etc.)
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  CollectionStatus,
  DonationStatus,
  DonationSource,
  CategoryType,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import {
  validateDonationFinanceEntities,
  generateNextReceiptNumber,
  isDateInClosedPeriod,
} from "../donation/donation.service.js";
import type {
  CreateCollectionSessionInput,
  VerifyCollectionSessionInput,
  GetCollectionsQueryInput,
} from "./collection.validation.js";

export interface CollectionActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

const COLLECTION_SESSION_DEFAULT_INCLUDE = {
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  account: { select: { id: true, name: true, type: true } },
  category: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  verifiedBy: { select: { id: true, name: true, email: true } },
  donation: {
    select: {
      id: true,
      amount: true,
      receiptNumber: true,
      status: true,
      date: true,
    },
  },
} as const;

function mapCollectionSessionResponse(session: any) {
  return {
    id: session.id,
    mosqueId: session.mosqueId,
    occasion: session.occasion,
    date: session.date,
    totalAmount: session.totalAmount.toString(),
    notes: session.notes ?? null,
    status: session.status,
    fundId: session.fundId ?? null,
    fund: session.fund
      ? {
          id: session.fund.id,
          name: session.fund.name,
          type: session.fund.type,
          isRestricted: session.fund.isRestricted,
        }
      : null,
    accountId: session.accountId ?? null,
    account: session.account
      ? {
          id: session.account.id,
          name: session.account.name,
          type: session.account.type,
        }
      : null,
    categoryId: session.categoryId ?? null,
    category: session.category
      ? {
          id: session.category.id,
          name: session.category.name,
          type: session.category.type,
        }
      : null,
    createdById: session.createdById,
    createdBy: session.createdBy
      ? {
          id: session.createdBy.id,
          name: session.createdBy.name,
          email: session.createdBy.email ?? null,
        }
      : null,
    verifiedById: session.verifiedById ?? null,
    verifiedBy: session.verifiedBy
      ? {
          id: session.verifiedBy.id,
          name: session.verifiedBy.name,
          email: session.verifiedBy.email ?? null,
        }
      : null,
    verifiedAt: session.verifiedAt ?? null,
    donationId: session.donationId ?? null,
    donation: session.donation
      ? {
          id: session.donation.id,
          amount: session.donation.amount.toString(),
          receiptNumber: session.donation.receiptNumber,
          status: session.donation.status,
          date: session.donation.date,
        }
      : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * POST /collections
 * Starts a counting session: occasion, date, counted totalAmount, notes. Status is OPEN.
 * Access: ADMIN, TREASURER, STAFF
 */
export async function createCollectionSession(
  mosqueId: string,
  input: CreateCollectionSessionInput,
  actor: CollectionActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOperator =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.STAFF;
  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot start collection sessions.`,
      "FORBIDDEN_ROLE",
    );
  }

  // Pre-validate fund, account, category if provided
  if (input.fundId) {
    const fund = await prisma.fund.findFirst({
      where: { id: input.fundId, mosqueId: resolvedMosqueId },
    });
    if (!fund) {
      throw HttpError.badRequest("Selected fund does not exist in this mosque.", "FUND_NOT_FOUND");
    }
  }

  if (input.accountId) {
    const account = await prisma.account.findFirst({
      where: { id: input.accountId, mosqueId: resolvedMosqueId, isArchived: false },
    });
    if (!account) {
      throw HttpError.badRequest("Selected account does not exist or is archived.", "ACCOUNT_NOT_FOUND");
    }
  }

  if (input.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, mosqueId: resolvedMosqueId, isArchived: false },
    });
    if (!category) {
      throw HttpError.badRequest("Selected category does not exist or is archived.", "CATEGORY_NOT_FOUND");
    }
    if (category.type !== CategoryType.INCOME) {
      throw HttpError.badRequest("Collection category must be an INCOME category.", "INVALID_CATEGORY_TYPE");
    }
    if (category.fundId && input.fundId && category.fundId !== input.fundId) {
      throw HttpError.badRequest("Category does not belong to the selected fund.", "CATEGORY_FUND_MISMATCH");
    }
  }

  const session = await prisma.collectionSession.create({
    data: {
      mosqueId: resolvedMosqueId,
      occasion: input.occasion,
      date: input.date,
      totalAmount: input.totalAmount,
      notes: input.notes ?? null,
      status: CollectionStatus.OPEN,
      fundId: input.fundId ?? null,
      accountId: input.accountId ?? null,
      categoryId: input.categoryId ?? null,
      createdById: actor.userId,
    },
    include: COLLECTION_SESSION_DEFAULT_INCLUDE,
  });

  return mapCollectionSessionResponse(session);
}

/**
 * POST /collections/:id/verify
 * Confirms the count. Verification MUST be done by a second person (ADMIN or TREAS),
 * not the counter who created the session.
 * Atomically posts one anonymous income entry to the chosen fund and account.
 * Access: ADMIN, TREASURER
 */
export async function verifyCollectionSession(
  mosqueId: string,
  collectionId: string,
  input: VerifyCollectionSessionInput,
  actor: CollectionActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Verifier role guard (ADMIN or TREAS only)
  const isVerifier =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isVerifier) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot verify collection sessions. Only ADMIN and TREASURER can verify.`,
      "FORBIDDEN_ROLE",
    );
  }

  // Fetch mosque accounting boundaries
  const mosque = await prisma.mosque.findUnique({
    where: { id: resolvedMosqueId },
    select: { id: true, closedPeriodUntil: true, fiscalYearStart: true },
  });
  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  // Fetch target collection session
  const session = await prisma.collectionSession.findFirst({
    where: { id: collectionId, mosqueId: resolvedMosqueId },
    include: COLLECTION_SESSION_DEFAULT_INCLUDE,
  });

  if (!session) {
    throw HttpError.notFound("Collection session not found.", "COLLECTION_NOT_FOUND");
  }

  if (session.status === CollectionStatus.VERIFIED) {
    throw HttpError.badRequest("Collection session has already been verified.", "ALREADY_VERIFIED");
  }

  if (session.status !== CollectionStatus.OPEN) {
    throw HttpError.badRequest(
      `Cannot verify collection session with status '${session.status}'. Only OPEN sessions can be verified.`,
      "INVALID_COLLECTION_STATUS",
    );
  }

  // TWO-PERSON VERIFICATION INVARIANT:
  // Verifier must be a distinct person from the counter
  if (session.createdById === actor.userId) {
    throw HttpError.badRequest(
      "Verification must be performed by a second person, not the counter who created the session.",
      "SELF_VERIFICATION_NOT_ALLOWED",
    );
  }

  // Resolve target finance entities
  const fundId = input.fundId ?? session.fundId;
  const accountId = input.accountId ?? session.accountId;
  const categoryId = input.categoryId ?? session.categoryId;

  if (!fundId) {
    throw HttpError.badRequest("A target fund must be selected to verify this collection.", "MISSING_FUND");
  }
  if (!accountId) {
    throw HttpError.badRequest("A target account must be selected to verify this collection.", "MISSING_ACCOUNT");
  }
  if (!categoryId) {
    throw HttpError.badRequest("A target income category must be selected to verify this collection.", "MISSING_CATEGORY");
  }

  // Check period closure
  if (isDateInClosedPeriod(session.date, mosque)) {
    throw HttpError.badRequest(
      "Cannot verify a collection session recorded in a closed accounting period.",
      "PERIOD_CLOSED",
    );
  }

  // Execute verification and donation posting in a single atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Validate Account, Fund, Category consistency
    await validateDonationFinanceEntities(
      tx,
      resolvedMosqueId,
      accountId,
      fundId,
      categoryId,
    );

    // 2. Generate unique receipt number for the anonymous donation
    const receiptNumber = await generateNextReceiptNumber(
      tx,
      resolvedMosqueId,
      session.date.getFullYear(),
    );

    // 3. Post one anonymous income entry
    const notes = input.notes ?? session.notes;
    const donation = await tx.donation.create({
      data: {
        mosqueId: resolvedMosqueId,
        amount: session.totalAmount,
        accountId,
        fundId,
        categoryId,
        date: session.date,
        source: DonationSource.CASH_BOX,
        status: DonationStatus.POSTED,
        receiptNumber,
        isAnonymousPublic: true,
        donorName: `${session.occasion} Collection`,
        notes: notes
          ? `Collection count session (${session.occasion}): ${notes}`
          : `Collection count session (${session.occasion})`,
        createdById: session.createdById,
        postedById: actor.userId,
        postedAt: new Date(),
      },
    });

    // 4. Transition CollectionSession to VERIFIED and link posted donation
    const updatedSession = await tx.collectionSession.update({
      where: { id: session.id },
      data: {
        status: CollectionStatus.VERIFIED,
        verifiedById: actor.userId,
        verifiedAt: new Date(),
        fundId,
        accountId,
        categoryId,
        donationId: donation.id,
        notes: notes ?? null,
      },
      include: COLLECTION_SESSION_DEFAULT_INCLUDE,
    });

    return updatedSession;
  });

  return mapCollectionSessionResponse(result);
}

/**
 * GET /collections
 * History of counts with who counted and who verified.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getCollections(
  mosqueId: string,
  query: GetCollectionsQueryInput,
  actor: CollectionActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view collection sessions.",
      "FORBIDDEN_ROLE",
    );
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.CollectionSessionWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.occasion ? { occasion: { contains: query.occasion, mode: "insensitive" } } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          date: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  };

  const [sessions, total] = await Promise.all([
    prisma.collectionSession.findMany({
      where,
      include: COLLECTION_SESSION_DEFAULT_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.collectionSession.count({ where }),
  ]);

  return {
    data: sessions.map(mapCollectionSessionResponse),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * GET /collections/:id
 * Fetches single collection session by ID.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getCollectionById(
  mosqueId: string,
  collectionId: string,
  actor: CollectionActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view collection sessions.",
      "FORBIDDEN_ROLE",
    );
  }

  const session = await prisma.collectionSession.findFirst({
    where: { id: collectionId, mosqueId: resolvedMosqueId },
    include: COLLECTION_SESSION_DEFAULT_INCLUDE,
  });

  if (!session) {
    throw HttpError.notFound("Collection session not found.", "COLLECTION_NOT_FOUND");
  }

  return mapCollectionSessionResponse(session);
}

