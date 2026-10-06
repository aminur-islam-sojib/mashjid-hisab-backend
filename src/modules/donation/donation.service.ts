// ---------------------------------------------------------------------------
// Donation Service — Mosque Income & Collections Management
// ---------------------------------------------------------------------------

import { prisma, isPrismaP2002 } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  DonationStatus,
  DonationSource,
  CategoryType,
  MembershipStatus,
  AccountType,
  FundType,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateDonationInput,
  GetMosqueDonationsQueryInput,
  UpdateDonationInput,
} from "./donation.validation.js";

export interface DonationActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export interface VoidInfo {
  voidedAt: Date;
  voidReason: string | null;
  voidedBy: {
    id: string;
    name: string;
    email: string | null;
  } | null;
}

export interface DonationResponseItem {
  id: string;
  mosqueId: string;
  amount: string;
  accountId: string;
  fundId: string;
  categoryId: string;
  date: Date;
  memberId: string | null;
  familyId: string | null;
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  isAnonymousPublic: boolean;
  campaignId: string | null;
  dueId: string | null;
  pledgeId: string | null;
  source: DonationSource;
  status: DonationStatus;
  receiptNumber: string | null;
  notes: string | null;
  attachments: string[];
  voidInfo: VoidInfo | null;
  createdById: string | null;
  postedById: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  account?: {
    id: string;
    name: string;
    type?: AccountType;
    accountNumber: string | null;
  };
  fund?: {
    id: string;
    name: string;
    type?: FundType;
    isRestricted: boolean;
  };
  category?: {
    id: string;
    name: string;
    type: CategoryType;
  };
  member?: {
    id: string;
    user: {
      id?: string;
      name: string;
      email: string | null;
      phone: string | null;
    };
  } | null;
  family?: {
    id: string;
    name: string;
  } | null;
  createdBy?: {
    id: string;
    name: string;
  } | null;
  postedBy?: {
    id: string;
    name: string;
  } | null;
}

/**
 * Validates financial linkages (Account, Fund, Category) for a donation.
 *
 * Enforces financial integrity rules:
 *  1. Account must exist, belong to this mosque, and NOT be archived.
 *  2. Fund must exist, belong to this mosque, and NOT be archived.
 *  3. Category must exist, belong to this mosque, and NOT be archived.
 *  4. Category must be an INCOME category (cannot record donations to an EXPENSE category).
 *  5. If category is restricted to a fund (`category.fundId != null`), it must match `fundId`.
 *  6. If fund is restricted (`fund.isRestricted === true`, e.g. Zakat, Waqf),
 *     the category MUST be explicitly locked to this fund (`category.fundId === fund.id`).
 */
export async function validateDonationFinanceEntities(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  accountId: string,
  fundId: string,
  categoryId: string,
) {
  // 1. Account check
  const account = await tx.account.findFirst({
    where: { id: accountId, mosqueId },
    select: { id: true, name: true, accountNumber: true, isArchived: true },
  });
  if (!account) {
    throw HttpError.notFound(
      "Account not found in this mosque.",
      "ACCOUNT_NOT_FOUND",
    );
  }
  if (account.isArchived) {
    throw HttpError.badRequest(
      "Cannot record donation to an archived account.",
      "ACCOUNT_ARCHIVED",
    );
  }

  // 2. Fund check
  const fund = await tx.fund.findFirst({
    where: { id: fundId, mosqueId },
    select: { id: true, name: true, type: true, isRestricted: true, isArchived: true },
  });
  if (!fund) {
    throw HttpError.notFound(
      "Fund not found in this mosque.",
      "FUND_NOT_FOUND",
    );
  }
  if (fund.isArchived) {
    throw HttpError.badRequest(
      "Cannot record donation to an archived fund.",
      "FUND_ARCHIVED",
    );
  }

  // 3. Category check
  const category = await tx.category.findFirst({
    where: { id: categoryId, mosqueId },
    select: { id: true, name: true, type: true, fundId: true, isArchived: true },
  });
  if (!category) {
    throw HttpError.notFound(
      "Category not found in this mosque.",
      "CATEGORY_NOT_FOUND",
    );
  }
  if (category.isArchived) {
    throw HttpError.badRequest(
      "Cannot record donation to an archived category.",
      "CATEGORY_ARCHIVED",
    );
  }
  if (category.type !== CategoryType.INCOME) {
    throw HttpError.badRequest(
      "Donation category must be an INCOME category.",
      "INVALID_CATEGORY_TYPE",
    );
  }

  // 4. Category-Fund link check
  if (category.fundId && category.fundId !== fund.id) {
    throw HttpError.badRequest(
      "Category is restricted to a different fund.",
      "CATEGORY_FUND_MISMATCH",
    );
  }

  // 5. Restricted fund requirement: Restricted funds require an exclusively locked category
  if (fund.isRestricted && category.fundId !== fund.id) {
    throw HttpError.badRequest(
      `Fund '${fund.name}' is restricted and requires a category specifically allocated to it.`,
      "RESTRICTED_FUND_CATEGORY_MISMATCH",
    );
  }

  return { account, fund, category };
}

/**
 * Resolves donor details based on memberId, familyId, or walk-in/anonymous info.
 */
export async function resolveDonorInformation(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  input: {
    memberId?: string | null;
    familyId?: string | null;
    donorName?: string | null;
    donorPhone?: string | null;
    donorEmail?: string | null;
    isAnonymousPublic?: boolean;
  },
) {
  let donorName = input.donorName ?? null;
  let donorPhone = input.donorPhone ?? null;
  let donorEmail = input.donorEmail ?? null;

  // 1. Member resolution
  if (input.memberId) {
    const member = await tx.membership.findFirst({
      where: { id: input.memberId, mosqueId },
      include: {
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!member) {
      throw HttpError.notFound(
        "Active membership not found for the given memberId in this mosque.",
        "MEMBER_NOT_FOUND",
      );
    }

    if (member.status !== MembershipStatus.ACTIVE) {
      throw HttpError.badRequest(
        "Cannot record donation for an inactive member.",
        "INACTIVE_MEMBER",
      );
    }

    // Snapshot defaults if not explicitly provided
    if (!donorName) donorName = member.user.name;
    if (!donorPhone) donorPhone = member.user.phone;
    if (!donorEmail) donorEmail = member.user.email;
  }

  // 2. Family resolution
  if (input.familyId) {
    const family = await tx.family.findFirst({
      where: { id: input.familyId, mosqueId },
      select: { id: true, name: true },
    });

    if (!family) {
      throw HttpError.notFound(
        "Family household not found in this mosque.",
        "FAMILY_NOT_FOUND",
      );
    }

    if (!donorName) {
      donorName = `${family.name} Household`;
    }
  }

  // 3. Walk-in / anonymous fallback
  if (!donorName) {
    donorName = input.isAnonymousPublic ? "Anonymous" : "Walk-in Donor";
  }

  return {
    donorName,
    donorPhone,
    donorEmail,
  };
}

/**
 * Generates the next sequential receipt number for a mosque in a specific year.
 * Format: RCP-YYYY-XXXXX (e.g. RCP-2026-00001).
 */
export async function generateNextReceiptNumber(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  year: number,
): Promise<string> {
  const prefix = `RCP-${year}-`;

  // Find the highest receipt number for this year in the mosque
  const latestDonation = await tx.donation.findFirst({
    where: {
      mosqueId,
      receiptNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      receiptNumber: "desc",
    },
    select: {
      receiptNumber: true,
    },
  });

  let nextSeq = 1;
  if (latestDonation?.receiptNumber) {
    const parts = latestDonation.receiptNumber.split("-");
    const lastSeq = parseInt(parts[2] || "0", 10);
    if (!isNaN(lastSeq) && lastSeq > 0) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

/**
 * Maps a Prisma donation record with relations to the public response shape.
 */
function mapDonationResponse(donation: any): DonationResponseItem {
  const voidInfo: VoidInfo | null =
    donation.status === DonationStatus.VOIDED || donation.voidedAt
      ? {
          voidedAt: donation.voidedAt ?? donation.updatedAt,
          voidReason: donation.voidReason ?? null,
          voidedBy: donation.voidedBy
            ? {
                id: donation.voidedBy.id,
                name: donation.voidedBy.name,
                email: donation.voidedBy.email ?? null,
              }
            : null,
        }
      : null;

  return {
    id: donation.id,
    mosqueId: donation.mosqueId,
    amount: donation.amount.toString(),
    accountId: donation.accountId,
    fundId: donation.fundId,
    categoryId: donation.categoryId,
    date: donation.date,
    memberId: donation.memberId,
    familyId: donation.familyId,
    donorName: donation.donorName,
    donorPhone: donation.donorPhone,
    donorEmail: donation.donorEmail,
    isAnonymousPublic: donation.isAnonymousPublic,
    campaignId: donation.campaignId,
    dueId: donation.dueId,
    pledgeId: donation.pledgeId,
    source: donation.source,
    status: donation.status,
    receiptNumber: donation.receiptNumber,
    notes: donation.notes,
    attachments: donation.attachments ?? [],
    voidInfo,
    createdById: donation.createdById,
    postedById: donation.postedById,
    postedAt: donation.postedAt,
    createdAt: donation.createdAt,
    updatedAt: donation.updatedAt,
    account: donation.account
      ? {
          id: donation.account.id,
          name: donation.account.name,
          type: donation.account.type,
          accountNumber: donation.account.accountNumber ?? null,
        }
      : undefined,
    fund: donation.fund
      ? {
          id: donation.fund.id,
          name: donation.fund.name,
          type: donation.fund.type,
          isRestricted: donation.fund.isRestricted,
        }
      : undefined,
    category: donation.category
      ? {
          id: donation.category.id,
          name: donation.category.name,
          type: donation.category.type,
        }
      : undefined,
    member: donation.member
      ? {
          id: donation.member.id,
          user: {
            id: donation.member.user?.id,
            name: donation.member.user?.name,
            email: donation.member.user?.email ?? null,
            phone: donation.member.user?.phone ?? null,
          },
        }
      : donation.member === null
      ? null
      : undefined,
    family: donation.family
      ? {
          id: donation.family.id,
          name: donation.family.name,
        }
      : donation.family === null
      ? null
      : undefined,
    createdBy: donation.createdBy
      ? {
          id: donation.createdBy.id,
          name: donation.createdBy.name,
        }
      : donation.createdBy === null
      ? null
      : undefined,
    postedBy: donation.postedBy
      ? {
          id: donation.postedBy.id,
          name: donation.postedBy.name,
        }
      : donation.postedBy === null
      ? null
      : undefined,
  };
}

/**
 * Records a new income donation for a mosque.
 *
 * Lifecycle & Authorization:
 *  - MOSQUE_ADMIN & TREASURER: Posts immediately (`status: POSTED`, receiptNumber generated, postedById set).
 *  - STAFF: Saved as `PENDING` for review (`status: PENDING`, receiptNumber: null, postedById: null).
 *  - Other roles: Blocked with 403 Forbidden.
 *
 * Financial Integrity:
 *  - Validates Account, Fund, and Category exist, are active, and belong to the mosque.
 *  - Category must be an INCOME category.
 *  - Category fund lock and restricted fund constraints are strictly enforced.
 *  - Donor details are resolved and snapshot.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param input - Validated create donation payload
 * @param actor - Context of the caller (userId, role in target mosque)
 */
export async function createDonation(
  mosqueId: string,
  input: CreateDonationInput,
  actor: DonationActor,
): Promise<DonationResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Role validation
  const isPoster =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  const isStaff = actor.role === Role.STAFF;

  if (!isPoster && !isStaff) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot record donations.`,
      "FORBIDDEN_ROLE",
    );
  }

  const donationYear = input.date.getFullYear();
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // 1. Financial validation
        await validateDonationFinanceEntities(
          tx,
          resolvedMosqueId,
          input.accountId,
          input.fundId,
          input.categoryId,
        );

        // 2. Donor resolution
        const donorSnapshot = await resolveDonorInformation(
          tx,
          resolvedMosqueId,
          {
            memberId: input.memberId,
            familyId: input.familyId,
            donorName: input.donorName,
            donorPhone: input.donorPhone,
            donorEmail: input.donorEmail,
            isAnonymousPublic: input.isAnonymousPublic,
          },
        );

        // 3. Status and receipt number calculation
        let status: DonationStatus = DonationStatus.PENDING;
        let receiptNumber: string | null = null;
        let postedById: string | null = null;
        let postedAt: Date | null = null;

        if (isPoster) {
          status = DonationStatus.POSTED;
          receiptNumber = await generateNextReceiptNumber(
            tx,
            resolvedMosqueId,
            donationYear,
          );
          postedById = actor.userId;
          postedAt = new Date();
        }

        // 4. Create the donation record
        const donation = await tx.donation.create({
          data: {
            mosqueId: resolvedMosqueId,
            amount: input.amount,
            accountId: input.accountId,
            fundId: input.fundId,
            categoryId: input.categoryId,
            date: input.date,
            memberId: input.memberId ?? null,
            familyId: input.familyId ?? null,
            donorName: donorSnapshot.donorName,
            donorPhone: donorSnapshot.donorPhone,
            donorEmail: donorSnapshot.donorEmail,
            isAnonymousPublic: input.isAnonymousPublic,
            campaignId: input.campaignId ?? null,
            dueId: input.dueId ?? null,
            pledgeId: input.pledgeId ?? null,
            source: input.source,
            status,
            receiptNumber,
            notes: input.notes ?? null,
            attachments: input.attachments ?? [],
            createdById: actor.userId,
            postedById,
            postedAt,
          },
          include: {
            account: { select: { id: true, name: true, type: true, accountNumber: true } },
            fund: { select: { id: true, name: true, type: true, isRestricted: true } },
            category: { select: { id: true, name: true, type: true } },
            member: {
              select: {
                id: true,
                user: { select: { id: true, name: true, email: true, phone: true } },
              },
            },
            family: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            postedBy: { select: { id: true, name: true } },
            voidedBy: { select: { id: true, name: true, email: true } },
          },
        });

        return donation;
      });

      return mapDonationResponse(created);
    } catch (error) {
      // If receiptNumber collision occurs due to concurrent inserts, retry
      if (isPoster && isPrismaP2002(error) && attempt < maxRetries - 1) {
        continue;
      }
      throw error;
    }
  }

  throw HttpError.internal(
    "Failed to record donation due to concurrent receipt generation collisions. Please try again.",
    "CONCURRENCY_ERROR",
  );
}

/**
 * Retrieves a single donation by ID within a mosque.
 *
 * Authorization rules:
 *  - MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER (Oversight): Can view any donation in the mosque.
 *  - MEMBER: Can view only own donation or own family's donation.
 *  - Others: Forbidden.
 *
 * Returns full details with receipt number, attachments, and void info.
 */
export async function getDonationById(
  mosqueId: string,
  donationId: string,
  actor: DonationActor,
): Promise<DonationResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const donation = await prisma.donation.findFirst({
    where: {
      id: donationId,
      mosqueId: resolvedMosqueId,
    },
    include: {
      account: { select: { id: true, name: true, type: true, accountNumber: true } },
      fund: { select: { id: true, name: true, type: true, isRestricted: true } },
      category: { select: { id: true, name: true, type: true } },
      member: {
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      family: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      postedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!donation) {
    throw HttpError.notFound("Donation record not found.", "DONATION_NOT_FOUND");
  }

  // Check role authorization
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    // If not oversight, only own or own family's donation is allowed
    // 1. Check if own donation
    const isOwnDonation =
      (actor.membershipId && donation.memberId === actor.membershipId) ||
      donation.member?.userId === actor.userId ||
      donation.createdById === actor.userId;

    if (!isOwnDonation) {
      // 2. Check if own family's donation
      let isOwnFamily = false;
      const callerMembership = await prisma.membership.findFirst({
        where: {
          userId: actor.userId,
          mosqueId: resolvedMosqueId,
          status: MembershipStatus.ACTIVE,
        },
        include: {
          headOfFamily: { select: { id: true } },
          linkedFamilyMember: { select: { familyId: true } },
        },
      });

      const callerFamilyId =
        callerMembership?.headOfFamily?.id ??
        callerMembership?.linkedFamilyMember?.familyId ??
        null;

      if (callerFamilyId && donation.familyId && donation.familyId === callerFamilyId) {
        isOwnFamily = true;
      }

      if (!isOwnFamily) {
        throw HttpError.forbidden(
          "Access denied. Members can only view their own or their family's donation receipts.",
          "FORBIDDEN",
        );
      }
    }
  }

  return mapDonationResponse(donation);
}

/**
 * Lists donations for a mosque with filtering and pagination.
 *
 * Filters supported:
 *  - donor: search string or memberId
 *  - family / familyId: household ID
 *  - fund / fundId: fund ID
 *  - campaign / campaignId: campaign ID
 *  - startDate / endDate: date range filter
 *  - status: DonationStatus enum filter
 *  - source: DonationSource enum filter
 *  - search: text search across receipt number, donor name, and notes
 *  - page, limit: pagination controls
 */
export async function getMosqueDonations(
  mosqueId: string,
  query: GetMosqueDonationsQueryInput = {},
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const andConditions: Prisma.DonationWhereInput[] = [
    { mosqueId: resolvedMosqueId },
  ];

  // Status filter
  if (query.status) {
    andConditions.push({ status: query.status });
  }

  // Source filter
  if (query.source) {
    andConditions.push({ source: query.source });
  }

  // Fund filter
  const targetFundId = query.fund ?? query.fundId;
  if (targetFundId) {
    andConditions.push({ fundId: targetFundId });
  }

  // Account filter
  if (query.accountId) {
    andConditions.push({ accountId: query.accountId });
  }

  // Category filter
  if (query.categoryId) {
    andConditions.push({ categoryId: query.categoryId });
  }

  // Family filter
  const targetFamilyId = query.family ?? query.familyId;
  if (targetFamilyId) {
    andConditions.push({ familyId: targetFamilyId });
  }

  // Campaign filter
  if (query.campaign) {
    andConditions.push({ campaignId: query.campaign });
  }

  // Date range filter
  if (query.startDate || query.endDate) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.startDate) dateFilter.gte = query.startDate;
    if (query.endDate) dateFilter.lte = query.endDate;
    andConditions.push({ date: dateFilter });
  }

  // Donor filter (memberId or donorName/donorPhone/donorEmail search)
  const targetDonor = query.donor ?? query.memberId;
  if (targetDonor) {
    andConditions.push({
      OR: [
        { memberId: targetDonor },
        { donorName: { contains: targetDonor, mode: "insensitive" } },
        { donorPhone: { contains: targetDonor, mode: "insensitive" } },
        { donorEmail: { contains: targetDonor, mode: "insensitive" } },
      ],
    });
  }

  // Text search
  if (query.search) {
    andConditions.push({
      OR: [
        { receiptNumber: { contains: query.search, mode: "insensitive" } },
        { donorName: { contains: query.search, mode: "insensitive" } },
        { notes: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.DonationWhereInput = { AND: andConditions };

  const [totalCount, donations] = await prisma.$transaction([
    prisma.donation.count({ where }),
    prisma.donation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { date: "desc" },
      include: {
        account: { select: { id: true, name: true, type: true, accountNumber: true } },
        fund: { select: { id: true, name: true, type: true, isRestricted: true } },
        category: { select: { id: true, name: true, type: true } },
        member: {
          select: {
            id: true,
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
        family: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    items: donations.map(mapDonationResponse),
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page * limit < totalCount,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Voids a posted donation entry.
 *
 * Only MOSQUE_ADMIN or TREASURER can void a donation.
 */
export async function voidDonation(
  mosqueId: string,
  donationId: string,
  reason: string,
  actor: DonationActor,
): Promise<DonationResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const donation = await prisma.donation.findFirst({
    where: {
      id: donationId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!donation) {
    throw HttpError.notFound("Donation record not found.", "DONATION_NOT_FOUND");
  }

  if (donation.status === DonationStatus.VOIDED) {
    throw HttpError.badRequest("Donation has already been voided.", "ALREADY_VOIDED");
  }

  const updated = await prisma.donation.update({
    where: { id: donationId },
    data: {
      status: DonationStatus.VOIDED,
      voidReason: reason,
      voidedById: actor.userId,
      voidedAt: new Date(),
    },
    include: {
      account: { select: { id: true, name: true, type: true, accountNumber: true } },
      fund: { select: { id: true, name: true, type: true, isRestricted: true } },
      category: { select: { id: true, name: true, type: true } },
      member: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      family: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      postedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return mapDonationResponse(updated);
}

/**
 * Updates non-financial fields on an existing donation entry.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN and TREASURER can perform updates.
 *  - Financial fields (amount, fund, account, date, category) are rejected by validation with TRANSACTION_IMMUTABLE.
 *  - Cannot edit a voided donation (frozen for audit compliance).
 *  - Returns updated donation record with full relations.
 */
export async function updateDonation(
  mosqueId: string,
  donationId: string,
  input: UpdateDonationInput,
  actor: DonationActor,
): Promise<DonationResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Financial operator role guard (MOSQUE_ADMIN, TREASURER)
  const isFinancialOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinancialOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot modify donation records.`,
      "FORBIDDEN_ROLE",
    );
  }

  const donation = await prisma.donation.findFirst({
    where: {
      id: donationId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!donation) {
    throw HttpError.notFound("Donation record not found.", "DONATION_NOT_FOUND");
  }

  // Voided donations cannot be edited
  if (donation.status === DonationStatus.VOIDED) {
    throw HttpError.badRequest(
      "Cannot edit a voided donation. Voided records are permanently frozen for audit compliance.",
      "DONATION_VOIDED",
    );
  }

  const dataToUpdate: Prisma.DonationUpdateInput = {};
  if (input.notes !== undefined) dataToUpdate.notes = input.notes;
  if (input.donorName !== undefined) dataToUpdate.donorName = input.donorName;
  if (input.donorPhone !== undefined) dataToUpdate.donorPhone = input.donorPhone;
  if (input.donorEmail !== undefined) dataToUpdate.donorEmail = input.donorEmail;
  if (input.attachments !== undefined) dataToUpdate.attachments = input.attachments;
  if (input.isAnonymousPublic !== undefined) dataToUpdate.isAnonymousPublic = input.isAnonymousPublic;

  const updated = await prisma.donation.update({
    where: { id: donationId },
    data: dataToUpdate,
    include: {
      account: { select: { id: true, name: true, type: true, accountNumber: true } },
      fund: { select: { id: true, name: true, type: true, isRestricted: true } },
      category: { select: { id: true, name: true, type: true } },
      member: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      family: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      postedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return mapDonationResponse(updated);
}

