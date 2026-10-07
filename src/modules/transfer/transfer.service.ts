// ---------------------------------------------------------------------------
// Transfer Service — Mosque Account & Fund Transfers
// ---------------------------------------------------------------------------

import { prisma, isPrismaP2002 } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  TransferLeg,
  TransferStatus,
  AccountType,
  FundType,
  AuditAction,
  AuditEntity,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import { isDateInClosedPeriod } from "../donation/donation.service.js";
import { recordAuditLog } from "../audit/audit.service.js";
import {
  getAccountBalance,
  getFundBalance,
} from "../expense/expense.service.js";
import type {
  CreateTransferInput,
  GetMosqueTransfersQueryInput,
} from "./transfer.validation.js";

export interface TransferActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export interface TransferLegDto {
  id: string;
  leg: TransferLeg;
  amount: string;
  accountId: string;
  fundId: string;
  status: TransferStatus;
}

export interface TransferPairResponseItem {
  id: string;
  transferNumber: string;
  amount: string;
  date: Date;
  status: TransferStatus;
  isFundTransfer: boolean;
  reason: string | null;
  notes: string | null;
  fromAccount: {
    id: string;
    name: string;
    type: AccountType;
    accountNumber: string | null;
  };
  toAccount: {
    id: string;
    name: string;
    type: AccountType;
    accountNumber: string | null;
  };
  fromFund: {
    id: string;
    name: string;
    type: FundType;
    isRestricted: boolean;
  };
  toFund: {
    id: string;
    name: string;
    type: FundType;
    isRestricted: boolean;
  };
  fromLeg: TransferLegDto;
  toLeg: TransferLegDto;
  voidInfo?: {
    voidedAt: Date | null;
    voidReason: string | null;
    voidedBy: {
      id: string;
      name: string;
      email: string | null;
    } | null;
    reversalTransferNumber: string | null;
  } | null;
  createdBy: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export const TRANSFER_LEG_INCLUDE = {
  account: { select: { id: true, name: true, type: true, accountNumber: true } },
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  voidedBy: { select: { id: true, name: true, email: true } },
  reversalOf: {
    select: { id: true, transferNumber: true, leg: true, amount: true, date: true },
  },
  reversalEntry: {
    select: { id: true, transferNumber: true, leg: true, amount: true, date: true },
  },
} as const;

export const TRANSFER_PAIR_INCLUDE = {
  ...TRANSFER_LEG_INCLUDE,
  linkedTransfer: {
    include: TRANSFER_LEG_INCLUDE,
  },
} as const;

/**
 * Maps database leg pairs into a client-facing TransferPairResponseItem.
 */
export function mapTransferPairResponse(
  fromLeg: any,
  toLeg: any,
): TransferPairResponseItem {
  const voidedUser = fromLeg.voidedBy
    ? {
        id: fromLeg.voidedBy.id,
        name: fromLeg.voidedBy.name,
        email: fromLeg.voidedBy.email ?? null,
      }
    : null;

  const createdUser = fromLeg.createdBy
    ? {
        id: fromLeg.createdBy.id,
        name: fromLeg.createdBy.name,
        email: fromLeg.createdBy.email ?? null,
      }
    : null;

  const voidInfo =
    fromLeg.status === TransferStatus.VOIDED || fromLeg.voidedAt
      ? {
          voidedAt: fromLeg.voidedAt ?? fromLeg.updatedAt,
          voidReason: fromLeg.voidReason ?? null,
          voidedBy: voidedUser,
          reversalTransferNumber: fromLeg.reversalEntry?.transferNumber ?? null,
        }
      : null;

  return {
    id: fromLeg.id,
    transferNumber: fromLeg.transferNumber,
    amount: fromLeg.amount.toString(),
    date: fromLeg.date,
    status: fromLeg.status,
    isFundTransfer: fromLeg.isFundTransfer,
    reason: fromLeg.reason ?? null,
    notes: fromLeg.notes ?? null,
    fromAccount: {
      id: fromLeg.account.id,
      name: fromLeg.account.name,
      type: fromLeg.account.type,
      accountNumber: fromLeg.account.accountNumber,
    },
    toAccount: {
      id: toLeg.account.id,
      name: toLeg.account.name,
      type: toLeg.account.type,
      accountNumber: toLeg.account.accountNumber,
    },
    fromFund: {
      id: fromLeg.fund.id,
      name: fromLeg.fund.name,
      type: fromLeg.fund.type,
      isRestricted: fromLeg.fund.isRestricted,
    },
    toFund: {
      id: toLeg.fund.id,
      name: toLeg.fund.name,
      type: toLeg.fund.type,
      isRestricted: toLeg.fund.isRestricted,
    },
    fromLeg: {
      id: fromLeg.id,
      leg: fromLeg.leg,
      amount: fromLeg.amount.toString(),
      accountId: fromLeg.accountId,
      fundId: fromLeg.fundId,
      status: fromLeg.status,
    },
    toLeg: {
      id: toLeg.id,
      leg: toLeg.leg,
      amount: toLeg.amount.toString(),
      accountId: toLeg.accountId,
      fundId: toLeg.fundId,
      status: toLeg.status,
    },
    voidInfo,
    createdBy: createdUser,
    createdAt: fromLeg.createdAt,
    updatedAt: fromLeg.updatedAt,
  };
}

/**
 * Generates the next sequential transfer number for a mosque in the format:
 * TRF-YYYY-XXXXX (e.g. TRF-2026-00001)
 */
export async function generateNextTransferNumber(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  date: Date,
): Promise<string> {
  const year = date.getFullYear();
  const prefix = `TRF-${year}-`;

  const latestTransfer = await tx.transfer.findFirst({
    where: {
      mosqueId,
      transferNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      transferNumber: "desc",
    },
    select: {
      transferNumber: true,
    },
  });

  let nextSeq = 1;
  if (latestTransfer?.transferNumber) {
    const parts = latestTransfer.transferNumber.split("-");
    const lastSeq = parseInt(parts[2] || "0", 10);
    if (!isNaN(lastSeq) && lastSeq > 0) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

/**
 * Validates financial linkages and balances for a transfer:
 *  1. fromAccount & toAccount must exist, belong to this mosque, and not be archived.
 *  2. fromFund & toFund must exist, belong to this mosque, and not be archived.
 *  3. fromAccount must have enough available balance.
 *  4. fromFund must have enough available balance.
 *  5. If fund-to-fund: fromFund cannot be restricted.
 */
export async function validateTransferFinanceEntities(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  input: CreateTransferInput,
  actor: TransferActor,
) {
  const isFundTransfer = input.fromFundId !== input.toFundId;

  // Fund-to-fund role authorization
  if (isFundTransfer) {
    if (actor.role !== Role.MOSQUE_ADMIN) {
      throw HttpError.forbidden(
        `Fund-to-fund transfers require MOSQUE_ADMIN role. Role '${actor.role}' is not authorized.`,
        "FORBIDDEN_ROLE",
      );
    }
    if (!input.reason || input.reason.trim().length < 3) {
      throw HttpError.badRequest(
        "A clear reason (at least 3 characters) is required for fund-to-fund transfers.",
        "MISSING_TRANSFER_REASON",
      );
    }
  }

  // 1. Source Account Check
  const fromAccount = await tx.account.findFirst({
    where: { id: input.fromAccountId, mosqueId },
    select: { id: true, name: true, type: true, isArchived: true },
  });
  if (!fromAccount) {
    throw HttpError.notFound("Source account not found in this mosque.", "ACCOUNT_NOT_FOUND");
  }
  if (fromAccount.isArchived) {
    throw HttpError.badRequest("Cannot transfer from an archived account.", "ACCOUNT_ARCHIVED");
  }

  // 2. Destination Account Check
  const toAccount = await tx.account.findFirst({
    where: { id: input.toAccountId, mosqueId },
    select: { id: true, name: true, type: true, isArchived: true },
  });
  if (!toAccount) {
    throw HttpError.notFound("Destination account not found in this mosque.", "ACCOUNT_NOT_FOUND");
  }
  if (toAccount.isArchived) {
    throw HttpError.badRequest("Cannot transfer to an archived account.", "ACCOUNT_ARCHIVED");
  }

  // 3. Source Fund Check
  const fromFund = await tx.fund.findFirst({
    where: { id: input.fromFundId, mosqueId },
    select: { id: true, name: true, type: true, isRestricted: true, isArchived: true },
  });
  if (!fromFund) {
    throw HttpError.notFound("Source fund not found in this mosque.", "FUND_NOT_FOUND");
  }
  if (fromFund.isArchived) {
    throw HttpError.badRequest("Cannot transfer from an archived fund.", "FUND_ARCHIVED");
  }

  // Restricted fund policy: fund-to-fund transfer out of restricted fund is strictly blocked
  if (isFundTransfer && fromFund.isRestricted) {
    throw HttpError.badRequest(
      `Transfers out of restricted fund '${fromFund.name}' are strictly blocked by Shariah policy.`,
      "RESTRICTED_FUND_TRANSFER_BLOCKED",
    );
  }

  // 4. Destination Fund Check
  const toFund = await tx.fund.findFirst({
    where: { id: input.toFundId, mosqueId },
    select: { id: true, name: true, type: true, isRestricted: true, isArchived: true },
  });
  if (!toFund) {
    throw HttpError.notFound("Destination fund not found in this mosque.", "FUND_NOT_FOUND");
  }
  if (toFund.isArchived) {
    throw HttpError.badRequest("Cannot transfer to an archived fund.", "FUND_ARCHIVED");
  }

  // 5. Source Account Balance Check
  const availableAccountBalance = await getAccountBalance(tx, fromAccount.id);
  if (availableAccountBalance < input.amount) {
    throw HttpError.badRequest(
      `Insufficient funds in account '${fromAccount.name}'. Available: ${availableAccountBalance} poisha, Requested: ${input.amount} poisha.`,
      "INSUFFICIENT_ACCOUNT_BALANCE",
    );
  }

  // 6. Source Fund Balance Check
  const availableFundBalance = await getFundBalance(tx, fromFund.id);
  if (availableFundBalance < input.amount) {
    throw HttpError.badRequest(
      `Insufficient balance in fund '${fromFund.name}'. Available: ${availableFundBalance} poisha, Requested: ${input.amount} poisha.`,
      "INSUFFICIENT_FUND_BALANCE",
    );
  }

  return { fromAccount, toAccount, fromFund, toFund, isFundTransfer };
}

/**
 * Records a new money transfer between accounts (intra-fund or fund-to-fund).
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN or TREASURER can initiate transfers.
 *  - Fund-to-fund transfers require MOSQUE_ADMIN role, a mandatory reason,
 *    and are strictly blocked out of restricted funds (e.g. Zakat, Waqf).
 *  - Checks available balance in source account and source fund.
 *  - Atomically creates two linked entries (legs): FROM and TO.
 *  - Both legs share the same sequential transferNumber (TRF-YYYY-XXXXX)
 *    and reference each other via linkedTransferId.
 */
export async function createTransfer(
  mosqueId: string,
  input: CreateTransferInput,
  actor: TransferActor,
): Promise<TransferPairResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Financial operator role guard
  const isOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot execute transfers. Only Mosque Admins and Treasurers are authorized.`,
      "FORBIDDEN_ROLE",
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch mosque settings
      const mosque = await tx.mosque.findUnique({
        where: { id: resolvedMosqueId },
        select: {
          id: true,
          closedPeriodUntil: true,
          fiscalYearStart: true,
        },
      });

      if (!mosque) {
        throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
      }

      // 2. Closed period check
      if (isDateInClosedPeriod(input.date, mosque)) {
        throw HttpError.badRequest(
          "Cannot record transfer in a closed accounting period or previous fiscal year.",
          "PERIOD_CLOSED",
        );
      }

      // 3. Validate accounts, funds, role authorization, and balances
      const { isFundTransfer } = await validateTransferFinanceEntities(
        tx,
        resolvedMosqueId,
        input,
        actor,
      );

      // 4. Generate next sequential transfer number
      const transferNumber = await generateNextTransferNumber(
        tx,
        resolvedMosqueId,
        input.date,
      );

      // 5. Create FROM leg (outflow)
      const fromLeg = await tx.transfer.create({
        data: {
          mosqueId: resolvedMosqueId,
          transferNumber,
          leg: TransferLeg.FROM,
          amount: input.amount,
          accountId: input.fromAccountId,
          fundId: input.fromFundId,
          date: input.date,
          status: TransferStatus.POSTED,
          isFundTransfer,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          createdById: actor.userId,
        },
        include: TRANSFER_LEG_INCLUDE,
      });

      // 6. Create TO leg (inflow), linked to FROM leg
      const toLeg = await tx.transfer.create({
        data: {
          mosqueId: resolvedMosqueId,
          transferNumber,
          leg: TransferLeg.TO,
          amount: input.amount,
          accountId: input.toAccountId,
          fundId: input.toFundId,
          date: input.date,
          status: TransferStatus.POSTED,
          isFundTransfer,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          linkedTransferId: fromLeg.id,
          createdById: actor.userId,
        },
        include: TRANSFER_LEG_INCLUDE,
      });

      // 7. Cross-link FROM leg to TO leg
      const updatedFromLeg = await tx.transfer.update({
        where: { id: fromLeg.id },
        data: { linkedTransferId: toLeg.id },
        include: TRANSFER_LEG_INCLUDE,
      });

      await recordAuditLog(tx, {
        mosqueId: resolvedMosqueId,
        actorId: actor.userId,
        action: AuditAction.TRANSFER,
        entity: AuditEntity.TRANSFER,
        entityId: transferNumber,
        summary: `Transfer ${transferNumber} recorded for amount ${input.amount.toString()} poisha${isFundTransfer ? " (fund-to-fund)" : ""}`,
        metadata: {
          transferNumber,
          amount: input.amount.toString(),
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          fromFundId: input.fromFundId,
          toFundId: input.toFundId,
          isFundTransfer,
          reason: input.reason ?? null,
        },
      });

      return mapTransferPairResponse(updatedFromLeg, toLeg);
    });

    return result;
  } catch (error) {
    if (isPrismaP2002(error)) {
      throw HttpError.conflict(
        "A transfer with this identifier already exists in the mosque.",
        "DUPLICATE_TRANSFER",
      );
    }
    throw error;
  }
}

/**
 * Retrieves a paginated list of transfers for a mosque represented as linked pairs.
 *
 * Authorization:
 *  - MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER (Oversight roles).
 */
export async function getMosqueTransfers(
  mosqueId: string,
  query: GetMosqueTransfersQueryInput,
  actor: TransferActor,
): Promise<PaginatedResult<TransferPairResponseItem>> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Oversight role guard
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view mosque transfers.`,
      "FORBIDDEN_ROLE",
    );
  }

  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
  const skip = (page - 1) * limit;

  // We query FROM legs with reversalOfId: null as the canonical pair heads
  const andConditions: Prisma.TransferWhereInput[] = [
    { mosqueId: resolvedMosqueId },
    { leg: TransferLeg.FROM },
    { reversalOfId: null },
  ];

  // Status filter
  if (query.status) {
    andConditions.push({ status: query.status });
  }

  // isFundTransfer filter
  if (query.isFundTransfer !== undefined) {
    andConditions.push({ isFundTransfer: query.isFundTransfer });
  }

  // Account filter: matches either FROM account or TO account (linked leg)
  if (query.accountId) {
    andConditions.push({
      OR: [
        { accountId: query.accountId },
        { linkedTransfer: { accountId: query.accountId } },
      ],
    });
  }

  // Fund filter: matches either FROM fund or TO fund (linked leg)
  if (query.fundId) {
    andConditions.push({
      OR: [
        { fundId: query.fundId },
        { linkedTransfer: { fundId: query.fundId } },
      ],
    });
  }

  // Date boundaries
  if (query.dateFrom || query.dateTo) {
    const dateCondition: Prisma.DateTimeFilter = {};
    if (query.dateFrom) dateCondition.gte = query.dateFrom;
    if (query.dateTo) dateCondition.lte = query.dateTo;
    andConditions.push({ date: dateCondition });
  }

  // Full-text search
  if (query.search) {
    const s = query.search.trim();
    andConditions.push({
      OR: [
        { transferNumber: { contains: s, mode: "insensitive" } },
        { reason: { contains: s, mode: "insensitive" } },
        { notes: { contains: s, mode: "insensitive" } },
        { account: { name: { contains: s, mode: "insensitive" } } },
        { fund: { name: { contains: s, mode: "insensitive" } } },
      ],
    });
  }

  const whereClause: Prisma.TransferWhereInput = { AND: andConditions };

  // Sorting
  const orderBy: Prisma.TransferOrderByWithRelationInput = {};
  if (query.sortBy === "amount") {
    orderBy.amount = query.sortOrder;
  } else if (query.sortBy === "createdAt") {
    orderBy.createdAt = query.sortOrder;
  } else {
    orderBy.date = query.sortOrder;
  }

  const [totalCount, fromLegs] = await Promise.all([
    prisma.transfer.count({ where: whereClause }),
    prisma.transfer.findMany({
      where: whereClause,
      include: TRANSFER_PAIR_INCLUDE,
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  const items: TransferPairResponseItem[] = fromLegs.map((fromLeg) => {
    const toLeg = fromLeg.linkedTransfer ?? fromLeg;
    return mapTransferPairResponse(fromLeg, toLeg);
  });

  const totalPages = Math.ceil(totalCount / limit);

  return {
    items,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Retrieves a single transfer by ID or transfer number as a linked pair.
 *
 * Authorization:
 *  - MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER.
 */
export async function getTransferById(
  mosqueId: string,
  identifier: string,
  actor: TransferActor,
): Promise<TransferPairResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view mosque transfers.`,
      "FORBIDDEN_ROLE",
    );
  }

  const targetLeg = await prisma.transfer.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      OR: [{ id: identifier }, { transferNumber: identifier }],
    },
    include: TRANSFER_PAIR_INCLUDE,
  });

  if (!targetLeg) {
    throw HttpError.notFound("Transfer record not found.", "TRANSFER_NOT_FOUND");
  }

  let fromLeg: any;
  let toLeg: any;

  if (targetLeg.leg === TransferLeg.FROM) {
    fromLeg = targetLeg;
    toLeg = targetLeg.linkedTransfer;
  } else {
    toLeg = targetLeg;
    fromLeg = targetLeg.linkedTransfer;
  }

  if (!toLeg || !fromLeg) {
    // Attempt fallback query by transferNumber
    const legs = await prisma.transfer.findMany({
      where: {
        mosqueId: resolvedMosqueId,
        transferNumber: targetLeg.transferNumber,
        reversalOfId: null,
      },
      include: TRANSFER_LEG_INCLUDE,
    });
    fromLeg = legs.find((l) => l.leg === TransferLeg.FROM) ?? targetLeg;
    toLeg = legs.find((l) => l.leg === TransferLeg.TO) ?? targetLeg;
  }

  return mapTransferPairResponse(fromLeg, toLeg);
}

export interface VoidTransferResult {
  voidedTransfer: TransferPairResponseItem;
  reversalTransfer: TransferPairResponseItem;
  restoredBalances: {
    fromAccountBalance: string;
    toAccountBalance: string;
    fromFundBalance: string;
    toFundBalance: string;
  };
}

/**
 * Voids a posted transfer and creates offsetting reversal entries for BOTH legs atomically.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN can void transfers.
 *  - Reason is mandatory (min 3 chars).
 *  - Fails if transfer is already voided.
 *  - Fails if transfer is itself a reversal entry.
 *  - Fails if transfer falls within a closed accounting period.
 *  - Reverses both legs together atomically and restores fund and account balances.
 */
export async function voidTransfer(
  mosqueId: string,
  identifier: string,
  reason: string,
  actor: TransferActor,
): Promise<VoidTransferResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Admin-only role guard
  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot void transfers. Only Mosque Admins can void transfers.`,
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

  // Find target transfer leg
  const target = await prisma.transfer.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      OR: [{ id: identifier }, { transferNumber: identifier }],
    },
  });

  if (!target) {
    throw HttpError.notFound("Transfer record not found.", "TRANSFER_NOT_FOUND");
  }

  if (target.status === TransferStatus.VOIDED) {
    throw HttpError.badRequest("Transfer has already been voided.", "ALREADY_VOIDED");
  }

  if (target.amount < 0n || target.reversalOfId) {
    throw HttpError.badRequest(
      "Cannot void a reversal entry.",
      "CANNOT_VOID_REVERSAL",
    );
  }

  if (isDateInClosedPeriod(target.date, mosque)) {
    throw HttpError.badRequest(
      "Cannot void a transfer from a closed accounting period or previous fiscal year.",
      "PERIOD_CLOSED",
    );
  }

  // Locate both original legs
  const originalLegs = await prisma.transfer.findMany({
    where: {
      mosqueId: resolvedMosqueId,
      transferNumber: target.transferNumber,
      reversalOfId: null,
    },
    include: TRANSFER_LEG_INCLUDE,
  });

  const fromLeg = originalLegs.find((l) => l.leg === TransferLeg.FROM);
  const toLeg = originalLegs.find((l) => l.leg === TransferLeg.TO);

  if (!fromLeg || !toLeg) {
    throw HttpError.notFound(
      "Incomplete transfer legs found for this transfer.",
      "TRANSFER_LEGS_INCOMPLETE",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const reversalTransferNumber = `REV-${target.transferNumber}`;

    // 1. Mark original FROM leg as VOIDED
    const voidedFromLeg = await tx.transfer.update({
      where: { id: fromLeg.id },
      data: {
        status: TransferStatus.VOIDED,
        voidReason: reason,
        voidedById: actor.userId,
        voidedAt: now,
      },
      include: TRANSFER_LEG_INCLUDE,
    });

    // 2. Mark original TO leg as VOIDED
    const voidedToLeg = await tx.transfer.update({
      where: { id: toLeg.id },
      data: {
        status: TransferStatus.VOIDED,
        voidReason: reason,
        voidedById: actor.userId,
        voidedAt: now,
      },
      include: TRANSFER_LEG_INCLUDE,
    });

    // 3. Create offsetting reversal FROM leg (negative amount)
    const reversalFromLeg = await tx.transfer.create({
      data: {
        mosqueId: resolvedMosqueId,
        transferNumber: reversalTransferNumber,
        leg: TransferLeg.FROM,
        amount: -fromLeg.amount,
        accountId: fromLeg.accountId,
        fundId: fromLeg.fundId,
        date: now,
        status: TransferStatus.POSTED,
        isFundTransfer: fromLeg.isFundTransfer,
        reason: `Reversal of ${fromLeg.transferNumber}: ${reason}`,
        notes: fromLeg.notes,
        reversalOfId: fromLeg.id,
        createdById: actor.userId,
      },
      include: TRANSFER_LEG_INCLUDE,
    });

    // 4. Create offsetting reversal TO leg (negative amount)
    const reversalToLeg = await tx.transfer.create({
      data: {
        mosqueId: resolvedMosqueId,
        transferNumber: reversalTransferNumber,
        leg: TransferLeg.TO,
        amount: -toLeg.amount,
        accountId: toLeg.accountId,
        fundId: toLeg.fundId,
        date: now,
        status: TransferStatus.POSTED,
        isFundTransfer: toLeg.isFundTransfer,
        reason: `Reversal of ${toLeg.transferNumber}: ${reason}`,
        notes: toLeg.notes,
        linkedTransferId: reversalFromLeg.id,
        reversalOfId: toLeg.id,
        createdById: actor.userId,
      },
      include: TRANSFER_LEG_INCLUDE,
    });

    // 5. Cross-link reversal legs
    const updatedReversalFromLeg = await tx.transfer.update({
      where: { id: reversalFromLeg.id },
      data: { linkedTransferId: reversalToLeg.id },
      include: TRANSFER_LEG_INCLUDE,
    });

    await recordAuditLog(tx, {
      mosqueId: resolvedMosqueId,
      actorId: actor.userId,
      action: AuditAction.VOID,
      entity: AuditEntity.TRANSFER,
      entityId: fromLeg.transferNumber,
      summary: `Transfer ${fromLeg.transferNumber} voided with reversal ${reversalTransferNumber}: ${reason}`,
      metadata: {
        transferNumber: fromLeg.transferNumber,
        reversalTransferNumber,
        reason,
        amount: fromLeg.amount.toString(),
      },
    });

    // 6. Compute restored balances
    const [fromAccountBal, toAccountBal, fromFundBal, toFundBal] =
      await Promise.all([
        getAccountBalance(tx, fromLeg.accountId),
        getAccountBalance(tx, toLeg.accountId),
        getFundBalance(tx, fromLeg.fundId),
        getFundBalance(tx, toLeg.fundId),
      ]);

    // Attach reversal entries for response mapping
    (voidedFromLeg as any).reversalEntry = updatedReversalFromLeg;
    (voidedToLeg as any).reversalEntry = reversalToLeg;

    return {
      voidedTransfer: mapTransferPairResponse(voidedFromLeg, voidedToLeg),
      reversalTransfer: mapTransferPairResponse(
        updatedReversalFromLeg,
        reversalToLeg,
      ),
      restoredBalances: {
        fromAccountBalance: fromAccountBal.toString(),
        toAccountBalance: toAccountBal.toString(),
        fromFundBalance: fromFundBal.toString(),
        toFundBalance: toFundBal.toString(),
      },
    };
  });

  return result;
}

