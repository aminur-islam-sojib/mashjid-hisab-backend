import { createHmac, randomBytes } from "node:crypto";
import config from "../../config/index.js";
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
  AuditAction,
  AuditEntity,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateDonationInput,
  GetMosqueDonationsQueryInput,
  UpdateDonationInput,
} from "./donation.validation.js";
import { syncPledgeStatus } from "../pledge/pledge.service.js";
import { syncDueStatus } from "../chanda/chanda.service.js";
import { recordAuditLog } from "../audit/audit.service.js";

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
  reversalReceiptNumber?: string | null;
}

export interface ReceiptDonorData {
  type: "MEMBER" | "FAMILY" | "WALK_IN" | "ANONYMOUS";
  name: string;
  phone: string | null;
  email: string | null;
  memberId: string | null;
  familyId: string | null;
  isAnonymousPublic: boolean;
}

export interface DonationReceiptData {
  receiptNumber: string;
  verificationCode: string;
  date: Date;
  issuedAt: Date;
  status: DonationStatus;
  isVoided: boolean;
  voidInfo: VoidInfo | null;
  mosque: {
    id: string;
    name: string;
    slug: string;
    address: string | null;
    timezone: string;
  };
  donor: ReceiptDonorData;
  amount: {
    raw: string;
    formatted: string;
    currency: string;
  };
  fund: {
    id: string;
    name: string;
    isRestricted: boolean;
  };
  category: {
    id: string;
    name: string;
  };
  account: {
    id: string;
    name: string;
    accountNumber: string | null;
  };
  source: DonationSource;
  notes: string | null;
  reversalOfReceiptNumber: string | null;
}

export interface VoidDonationResult {
  voidedDonation: DonationResponseItem;
  reversalEntry: DonationResponseItem;
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
  reversalOfId?: string | null;
  reversalOfReceiptNumber?: string | null;
  reversalEntryReceiptNumber?: string | null;
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
 * Reusable Prisma relation inclusion selector for consistent donation data across endpoints.
 */
export const DONATION_DEFAULT_INCLUDE = {
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
  reversalOf: { select: { id: true, receiptNumber: true } },
  reversalEntry: { select: { id: true, receiptNumber: true } },
} as const;

/**
 * Evaluates whether a given donation date falls within a closed accounting period.
 *
 * Rules:
 *  1. If `mosque.closedPeriodUntil` is set, any date on or before that threshold is closed.
 *  2. If the transaction falls into a past fiscal year (before current fiscal year start),
 *     the period is automatically considered closed.
 */
export function isDateInClosedPeriod(
  donationDate: Date,
  mosque: {
    closedPeriodUntil?: Date | null;
    fiscalYearStart?: number | null;
  },
): boolean {
  const targetDate = new Date(donationDate);

  // 1. Explicitly configured closed period
  if (mosque.closedPeriodUntil) {
    const closedUntil = new Date(mosque.closedPeriodUntil);
    if (targetDate.getTime() <= closedUntil.getTime()) {
      return true;
    }
  }

  // 2. Fiscal year boundary
  const fyStartMonth = mosque.fiscalYearStart ?? 7; // 1-12 (7 = July by default)
  const now = new Date();
  const currentCalYear = now.getFullYear();
  const currentCalMonth = now.getMonth() + 1; // 1-12

  let currentFyStartYear = currentCalYear;
  if (currentCalMonth < fyStartMonth) {
    currentFyStartYear = currentCalYear - 1;
  }

  const currentFyStartDate = new Date(Date.UTC(currentFyStartYear, fyStartMonth - 1, 1, 0, 0, 0, 0));

  if (targetDate.getTime() < currentFyStartDate.getTime()) {
    return true;
  }

  return false;
}

/**
 * Generates an HMAC-SHA256 based cryptographic verification code for donation receipts.
 * Format: VC-XXXX-XXXX-XXXX
 */
export function generateReceiptVerificationCode(params: {
  id: string;
  receiptNumber: string;
  amount: string;
  mosqueId: string;
  createdAt: Date;
}): string {
  const secret = config.JWT_ACCESS_SECRET || "receipt-verification-salt";
  const payload = `${params.id}:${params.receiptNumber}:${params.amount}:${params.mosqueId}:${params.createdAt.toISOString()}`;
  const hmac = createHmac("sha256", secret).update(payload).digest("hex").toUpperCase();
  return `VC-${hmac.substring(0, 4)}-${hmac.substring(4, 8)}-${hmac.substring(8, 12)}`;
}

/**
 * Generates a high-entropy random verification code for donation receipts.
 * Format: VC-XXXX-XXXX-XXXX
 */
export function generateSecureVerificationCode(): string {
  const bytes = randomBytes(6).toString("hex").toUpperCase();
  return `VC-${bytes.substring(0, 4)}-${bytes.substring(4, 8)}-${bytes.substring(8, 12)}`;
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
          reversalReceiptNumber: donation.reversalEntry?.receiptNumber ?? null,
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
    reversalOfId: donation.reversalOfId ?? null,
    reversalOfReceiptNumber: donation.reversalOf?.receiptNumber ?? null,
    reversalEntryReceiptNumber: donation.reversalEntry?.receiptNumber ?? null,
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
        // 0. Closed accounting period check
        const mosque = await tx.mosque.findUnique({
          where: { id: resolvedMosqueId },
          select: { closedPeriodUntil: true, fiscalYearStart: true },
        });
        if (mosque && isDateInClosedPeriod(input.date, mosque)) {
          throw HttpError.badRequest(
            "Cannot record donation in a closed accounting period or previous fiscal year.",
            "PERIOD_CLOSED",
          );
        }

        // 1. Financial validation
        await validateDonationFinanceEntities(
          tx,
          resolvedMosqueId,
          input.accountId,
          input.fundId,
          input.categoryId,
        );

        // 1b. Pledge validation if provided
        if (input.pledgeId) {
          const pledge = await tx.pledge.findFirst({
            where: { id: input.pledgeId, mosqueId: resolvedMosqueId },
          });
          if (!pledge) {
            throw HttpError.notFound("Pledge not found in this mosque.", "PLEDGE_NOT_FOUND");
          }
          if (pledge.status === "CANCELLED") {
            throw HttpError.badRequest("Cannot record donation against a cancelled pledge.", "PLEDGE_CANCELLED");
          }
        }

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
        let verificationCode: string | null = null;
        let postedById: string | null = null;
        let postedAt: Date | null = null;

        if (isPoster) {
          status = DonationStatus.POSTED;
          receiptNumber = await generateNextReceiptNumber(
            tx,
            resolvedMosqueId,
            donationYear,
          );
          verificationCode = generateSecureVerificationCode();
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
            verificationCode,
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

        if (status === DonationStatus.POSTED && input.pledgeId) {
          await syncPledgeStatus(tx, input.pledgeId);
        }

        await recordAuditLog(tx, {
          mosqueId: resolvedMosqueId,
          actorId: actor.userId,
          action: AuditAction.CREATE,
          entity: AuditEntity.DONATION,
          entityId: donation.id,
          summary: `Recorded donation of ${donation.amount.toString()} poisha (${receiptNumber || "PENDING"})`,
          metadata: {
            amount: donation.amount.toString(),
            receiptNumber,
            status: donation.status,
            donorName: donorSnapshot.donorName,
          },
        });

        return donation;
      }, { maxWait: 10000, timeout: 25000 });

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
 * Voids a posted donation entry and creates an offsetting reversal entry in the ledger.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN or TREASURER can void donations.
 *  - Reason is required.
 *  - Fails with 400 ALREADY_VOIDED if donation is already voided.
 *  - Fails with 400 CANNOT_VOID_REVERSAL if donation is itself a reversal entry.
 *  - Fails with 400 CANNOT_VOID_PENDING if donation is still in PENDING status.
 *  - Fails with 400 PERIOD_CLOSED if donation date falls within a closed accounting period
 *    or previous fiscal year.
 *  - Performs an atomic Prisma transaction that marks original record as VOIDED,
 *    and inserts an offsetting reversal entry (negative amount, status POSTED, receiptNumber REV-...)
 *    linked via reversalOfId.
 */
export async function voidDonation(
  mosqueId: string,
  donationId: string,
  reason: string,
  actor: DonationActor,
): Promise<VoidDonationResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Financial operator role guard
  const isFinancialOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinancialOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot void donation records.`,
      "FORBIDDEN_ROLE",
    );
  }

  // Fetch mosque accounting period boundaries
  const mosque = await prisma.mosque.findUnique({
    where: { id: resolvedMosqueId },
    select: { id: true, closedPeriodUntil: true, fiscalYearStart: true },
  });

  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
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

  if (donation.status === DonationStatus.VOIDED) {
    throw HttpError.badRequest("Donation has already been voided.", "ALREADY_VOIDED");
  }

  if (donation.status === DonationStatus.PENDING) {
    throw HttpError.badRequest(
      "Cannot void an unposted pending donation. Reject or delete the pending record instead.",
      "CANNOT_VOID_PENDING",
    );
  }

  if (donation.amount < 0n || donation.reversalOfId) {
    throw HttpError.badRequest(
      "Cannot void a reversal entry.",
      "CANNOT_VOID_REVERSAL",
    );
  }

  if (isDateInClosedPeriod(donation.date, mosque)) {
    throw HttpError.badRequest(
      "Cannot void a donation from a closed accounting period or previous fiscal year.",
      "PERIOD_CLOSED",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Mark original donation as VOIDED
    const voided = await tx.donation.update({
      where: { id: donationId },
      data: {
        status: DonationStatus.VOIDED,
        voidReason: reason,
        voidedById: actor.userId,
        voidedAt: new Date(),
      },
      include: DONATION_DEFAULT_INCLUDE,
    });

    // 2. Generate unique reversal receipt number
    const reversalReceiptNumber = donation.receiptNumber
      ? `REV-${donation.receiptNumber}`
      : `REV-${donation.id.slice(0, 8).toUpperCase()}`;

    // 3. Create offsetting reversal entry
    const reversal = await tx.donation.create({
      data: {
        mosqueId: resolvedMosqueId,
        amount: -donation.amount,
        accountId: donation.accountId,
        fundId: donation.fundId,
        categoryId: donation.categoryId,
        date: new Date(),
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
        status: DonationStatus.POSTED,
        receiptNumber: reversalReceiptNumber,
        verificationCode: generateSecureVerificationCode(),
        notes: `Reversal entry for receipt ${donation.receiptNumber ?? donation.id}: ${reason}`,
        attachments: donation.attachments,
        reversalOfId: donation.id,
        createdById: actor.userId,
        postedById: actor.userId,
        postedAt: new Date(),
      },
      include: DONATION_DEFAULT_INCLUDE,
    });

    // Attach created reversal entry to voided record for complete linkage in return payload
    (voided as any).reversalEntry = reversal;

    // Resync pledge status if this donation was pledged
    if (donation.pledgeId) {
      await syncPledgeStatus(tx, donation.pledgeId);
    }

    // Resync due status if this donation was for a due
    if (donation.dueId) {
      await syncDueStatus(tx, donation.dueId);
    }

    await recordAuditLog(tx, {
      mosqueId: resolvedMosqueId,
      actorId: actor.userId,
      action: AuditAction.VOID,
      entity: AuditEntity.DONATION,
      entityId: donation.id,
      summary: `Voided donation (${donation.receiptNumber || donation.id}): ${reason}`,
      metadata: {
        amount: donation.amount.toString(),
        reason,
        receiptNumber: donation.receiptNumber,
        reversalReceiptNumber,
      },
    });

    return {
      voidedDonation: mapDonationResponse(voided),
      reversalEntry: mapDonationResponse(reversal),
    };
  }, { maxWait: 10000, timeout: 25000 });

  return result;
}

/**
 * Returns structured donation receipt data for client rendering or printing.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN, TREASURER, or MEMBER (own only) can view receipt.
 *  - Fails with 400 RECEIPT_NOT_AVAILABLE if donation is pending or has no receiptNumber.
 *  - Fails with 403 FORBIDDEN if member is not the owner of the donation.
 *  - Includes mosque details, donor details, formatted and minor unit amounts,
 *    fund, category, account, void info (if voided), and cryptographic verification code.
 */
export async function getDonationReceipt(
  mosqueId: string,
  donationId: string,
  actor: DonationActor,
): Promise<DonationReceiptData> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const donation = await prisma.donation.findFirst({
    where: {
      id: donationId,
      mosqueId: resolvedMosqueId,
    },
    include: {
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          timezone: true,
        },
      },
      ...DONATION_DEFAULT_INCLUDE,
    },
  });

  if (!donation) {
    throw HttpError.notFound("Donation record not found.", "DONATION_NOT_FOUND");
  }

  // Must have receiptNumber (cannot issue receipt for pending/unposted entries)
  if (!donation.receiptNumber) {
    throw HttpError.badRequest(
      "Receipt is not available for unposted or pending donations.",
      "RECEIPT_NOT_AVAILABLE",
    );
  }

  // Authorization check: ADMIN and TREASURER can view any receipt; MEMBER can only view own
  const isFinancialOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  if (!isFinancialOperator) {
    const isOwnDonation =
      (actor.membershipId && donation.memberId === actor.membershipId) ||
      donation.member?.userId === actor.userId ||
      donation.member?.user?.id === actor.userId ||
      donation.createdById === actor.userId;

    if (!isOwnDonation) {
      throw HttpError.forbidden(
        "Access denied. Members can only access receipts for their own donations.",
        "FORBIDDEN",
      );
    }
  }

  let verificationCode = donation.verificationCode;
  if (!verificationCode) {
    verificationCode = generateReceiptVerificationCode({
      id: donation.id,
      receiptNumber: donation.receiptNumber,
      amount: donation.amount.toString(),
      mosqueId: donation.mosqueId,
      createdAt: donation.createdAt,
    });

    // Best-effort non-blocking backfill for legacy receipt records
    prisma.donation
      .update({
        where: { id: donation.id },
        data: { verificationCode },
      })
      .catch(() => {});
  }

  let donorType: "MEMBER" | "FAMILY" | "WALK_IN" | "ANONYMOUS" = "WALK_IN";
  let donorName = donation.donorName || "Walk-in Donor";
  let donorPhone = donation.donorPhone ?? null;
  let donorEmail = donation.donorEmail ?? null;

  if (donation.memberId && donation.member) {
    donorType = "MEMBER";
    donorName = donation.member.user?.name || donorName;
    donorPhone = donation.donorPhone || donation.member.user?.phone || null;
    donorEmail = donation.donorEmail || donation.member.user?.email || null;
  } else if (donation.familyId && donation.family) {
    donorType = "FAMILY";
    donorName = donation.family.name || donorName;
  } else if (donation.isAnonymousPublic) {
    donorType = "ANONYMOUS";
  }

  const isVoided = donation.status === DonationStatus.VOIDED || !!donation.voidedAt;
  const voidInfo: VoidInfo | null = isVoided
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
        reversalReceiptNumber: donation.reversalEntry?.receiptNumber ?? null,
      }
    : null;

  return {
    receiptNumber: donation.receiptNumber,
    verificationCode,
    date: donation.date,
    issuedAt: donation.postedAt ?? donation.createdAt,
    status: donation.status,
    isVoided,
    voidInfo,
    mosque: {
      id: donation.mosque.id,
      name: donation.mosque.name,
      slug: donation.mosque.slug,
      address: donation.mosque.address,
      timezone: donation.mosque.timezone,
    },
    donor: {
      type: donorType,
      name: donorName,
      phone: donorPhone,
      email: donorEmail,
      memberId: donation.memberId,
      familyId: donation.familyId,
      isAnonymousPublic: donation.isAnonymousPublic,
    },
    amount: {
      raw: donation.amount.toString(),
      formatted: (Number(donation.amount) / 100).toFixed(2),
      currency: "BDT",
    },
    fund: {
      id: donation.fund.id,
      name: donation.fund.name,
      isRestricted: donation.fund.isRestricted,
    },
    category: {
      id: donation.category.id,
      name: donation.category.name,
    },
    account: {
      id: donation.account.id,
      name: donation.account.name,
      accountNumber: donation.account.accountNumber,
    },
    source: donation.source,
    notes: donation.notes,
    reversalOfReceiptNumber: donation.reversalOf?.receiptNumber ?? null,
  };
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

