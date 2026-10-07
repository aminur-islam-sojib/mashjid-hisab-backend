// ---------------------------------------------------------------------------
// Expense Service — Mosque Disbursements & Operational Spending
// ---------------------------------------------------------------------------

import { prisma, isPrismaP2002 } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  ExpenseStatus,
  DonationStatus,
  TransferLeg,
  TransferStatus,
  CategoryType,
  AccountType,
  FundType,
  AuditAction,
  AuditEntity,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import { isDateInClosedPeriod } from "../donation/donation.service.js";
import { recordAuditLog } from "../audit/audit.service.js";
import type {
  CreateExpenseInput,
  GetMosqueExpensesQueryInput,
  UpdateExpenseInput,
} from "./expense.validation.js";

export interface ExpenseActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export interface ApprovalTrailUser {
  id: string;
  name: string;
  email: string | null;
}

export interface ApprovalTrailStep {
  step: "RECORDED" | "SUBMITTED_FOR_APPROVAL" | "APPROVED" | "POSTED" | "VOIDED";
  label: string;
  performedBy: ApprovalTrailUser | null;
  performedAt: Date;
  details?: Record<string, unknown>;
}

export interface ExpenseApprovalTrail {
  status: ExpenseStatus;
  requiresAdminApproval: boolean;
  createdBy: ApprovalTrailUser | null;
  createdAt: Date;
  approvedBy: ApprovalTrailUser | null;
  approvedAt: Date | null;
  postedBy: ApprovalTrailUser | null;
  postedAt: Date | null;
  voidInfo: {
    voidedBy: ApprovalTrailUser | null;
    voidedAt: Date | null;
    voidReason: string | null;
    reversalVoucherNo: string | null;
  } | null;
  timeline: ApprovalTrailStep[];
}

export interface ExpenseResponseItem {
  id: string;
  mosqueId: string;
  amount: string;
  accountId: string;
  fundId: string;
  categoryId: string;
  date: Date;
  payee: string;
  voucherNo: string | null;
  status: ExpenseStatus;
  notes: string | null;
  attachments: string[];
  approvalTrail?: ExpenseApprovalTrail;
  approvedById: string | null;
  approvedAt: Date | null;
  voidReason: string | null;
  voidedById: string | null;
  voidedAt: Date | null;
  reversalOfId: string | null;
  reversalOfVoucherNo?: string | null;
  reversalEntryVoucherNo?: string | null;
  createdById: string | null;
  postedById: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  account?: {
    id: string;
    name: string;
    type: AccountType;
    accountNumber: string | null;
  };
  fund?: {
    id: string;
    name: string;
    type: FundType;
    isRestricted: boolean;
  };
  category?: {
    id: string;
    name: string;
    type: CategoryType;
  };
  createdBy?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  postedBy?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  approvedBy?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  voidedBy?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;
  reversalOf?: {
    id: string;
    voucherNo: string | null;
    amount?: string | null;
    date?: Date;
  } | null;
  reversalEntry?: {
    id: string;
    voucherNo: string | null;
    amount?: string | null;
    date?: Date;
  } | null;
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

export const EXPENSE_DEFAULT_INCLUDE = {
  account: { select: { id: true, name: true, type: true, accountNumber: true } },
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  category: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  postedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  voidedBy: { select: { id: true, name: true, email: true } },
  reversalOf: { select: { id: true, voucherNo: true, amount: true, date: true } },
  reversalEntry: { select: { id: true, voucherNo: true, amount: true, date: true } },
} as const;

/**
 * Calculates current available balance in a physical Account.
 * Balance = openingBalance + total POSTED donations - total POSTED expenses
 *           + total POSTED transfer inflows - total POSTED transfer outflows.
 */
export async function getAccountBalance(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<bigint> {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  if (!account) return 0n;

  const donations = await tx.donation.aggregate({
    where: {
      accountId,
      OR: [
        { status: DonationStatus.POSTED },
        { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const expenses = await tx.expense.aggregate({
    where: {
      accountId,
      OR: [
        { status: ExpenseStatus.POSTED },
        { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const transferInflows = await tx.transfer.aggregate({
    where: {
      accountId,
      leg: TransferLeg.TO,
      OR: [
        { status: TransferStatus.POSTED },
        { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const transferOutflows = await tx.transfer.aggregate({
    where: {
      accountId,
      leg: TransferLeg.FROM,
      OR: [
        { status: TransferStatus.POSTED },
        { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  return (
    account.openingBalance +
    (donations._sum.amount ?? 0n) -
    (expenses._sum.amount ?? 0n) +
    (transferInflows._sum.amount ?? 0n) -
    (transferOutflows._sum.amount ?? 0n)
  );
}

/**
 * Calculates current available balance in an accounting Fund.
 * Balance = total POSTED donations - total POSTED expenses
 *           + total POSTED transfer inflows - total POSTED transfer outflows.
 */
export async function getFundBalance(
  tx: Prisma.TransactionClient,
  fundId: string,
): Promise<bigint> {
  const donations = await tx.donation.aggregate({
    where: {
      fundId,
      OR: [
        { status: DonationStatus.POSTED },
        { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const expenses = await tx.expense.aggregate({
    where: {
      fundId,
      OR: [
        { status: ExpenseStatus.POSTED },
        { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const transferInflows = await tx.transfer.aggregate({
    where: {
      fundId,
      leg: TransferLeg.TO,
      OR: [
        { status: TransferStatus.POSTED },
        { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  const transferOutflows = await tx.transfer.aggregate({
    where: {
      fundId,
      leg: TransferLeg.FROM,
      OR: [
        { status: TransferStatus.POSTED },
        { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
      ],
    },
    _sum: { amount: true },
  });

  return (
    (donations._sum.amount ?? 0n) -
    (expenses._sum.amount ?? 0n) +
    (transferInflows._sum.amount ?? 0n) -
    (transferOutflows._sum.amount ?? 0n)
  );
}

/**
 * Validates financial linkages and balances for an expense record:
 *  1. Account must exist, belong to this mosque, and not be archived.
 *  2. Fund must exist, belong to this mosque, and not be archived.
 *  3. Category must exist, belong to this mosque, not be archived, and be CategoryType.EXPENSE.
 *  4. Category must belong to the selected fund (if restricted, must match explicitly).
 *  5. Account has enough available balance for the requested amount.
 *  6. Fund has enough available balance for the requested amount.
 */
export async function validateExpenseFinanceEntities(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  accountId: string,
  fundId: string,
  categoryId: string,
  amount: bigint,
) {
  // 1. Account Check
  const account = await tx.account.findFirst({
    where: { id: accountId, mosqueId },
    select: { id: true, name: true, type: true, accountNumber: true, openingBalance: true, isArchived: true },
  });
  if (!account) {
    throw HttpError.notFound("Account not found in this mosque.", "ACCOUNT_NOT_FOUND");
  }
  if (account.isArchived) {
    throw HttpError.badRequest("Cannot record expense from an archived account.", "ACCOUNT_ARCHIVED");
  }

  // 2. Fund Check
  const fund = await tx.fund.findFirst({
    where: { id: fundId, mosqueId },
    select: { id: true, name: true, type: true, isRestricted: true, isArchived: true },
  });
  if (!fund) {
    throw HttpError.notFound("Fund not found in this mosque.", "FUND_NOT_FOUND");
  }
  if (fund.isArchived) {
    throw HttpError.badRequest("Cannot record expense from an archived fund.", "FUND_ARCHIVED");
  }

  // 3. Category Check
  const category = await tx.category.findFirst({
    where: { id: categoryId, mosqueId },
    select: { id: true, name: true, type: true, fundId: true, isArchived: true },
  });
  if (!category) {
    throw HttpError.notFound("Category not found in this mosque.", "CATEGORY_NOT_FOUND");
  }
  if (category.isArchived) {
    throw HttpError.badRequest("Cannot record expense with an archived category.", "CATEGORY_ARCHIVED");
  }
  if (category.type !== CategoryType.EXPENSE) {
    throw HttpError.badRequest(
      "Expense category must be an EXPENSE category.",
      "INVALID_CATEGORY_TYPE",
    );
  }

  // 4. "the category belongs to the fund"
  if (category.fundId && category.fundId !== fund.id) {
    throw HttpError.badRequest(
      "Category is restricted to a different fund.",
      "CATEGORY_FUND_MISMATCH",
    );
  }
  if (fund.isRestricted && category.fundId !== fund.id) {
    throw HttpError.badRequest(
      `Fund '${fund.name}' is restricted and requires a category specifically allocated to it.`,
      "RESTRICTED_FUND_CATEGORY_MISMATCH",
    );
  }

  // 5. Account balance check
  const availableAccountBalance = await getAccountBalance(tx, account.id);
  if (availableAccountBalance < amount) {
    const availFormatted = (Number(availableAccountBalance) / 100).toFixed(2);
    const reqFormatted = (Number(amount) / 100).toFixed(2);
    throw HttpError.badRequest(
      `Insufficient funds in account '${account.name}'. Available: BDT ${availFormatted}, Requested: BDT ${reqFormatted}.`,
      "INSUFFICIENT_ACCOUNT_BALANCE",
    );
  }

  // 6. Fund balance check
  const availableFundBalance = await getFundBalance(tx, fund.id);
  if (availableFundBalance < amount) {
    const availFormatted = (Number(availableFundBalance) / 100).toFixed(2);
    const reqFormatted = (Number(amount) / 100).toFixed(2);
    throw HttpError.badRequest(
      `Insufficient balance in fund '${fund.name}'. Available: BDT ${availFormatted}, Requested: BDT ${reqFormatted}.`,
      "INSUFFICIENT_FUND_BALANCE",
    );
  }

  return { account, fund, category, availableAccountBalance, availableFundBalance };
}

/**
 * Generates the next sequential voucher number for a mosque in format VCH-YYYY-XXXXX.
 */
export async function generateVoucherNumber(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getFullYear();
  const prefix = `VCH-${year}-`;

  const latestExpense = await tx.expense.findFirst({
    where: {
      mosqueId,
      voucherNo: {
        startsWith: prefix,
      },
    },
    orderBy: {
      voucherNo: "desc",
    },
    select: {
      voucherNo: true,
    },
  });

  let nextSeq = 1;
  if (latestExpense?.voucherNo) {
    const parts = latestExpense.voucherNo.split("-");
    const lastSeq = parseInt(parts[2] || "0", 10);
    if (!isNaN(lastSeq) && lastSeq > 0) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

/**
 * Builds the chronological audit and approval trail for an expense.
 */
export function buildExpenseApprovalTrail(expense: any): ExpenseApprovalTrail {
  const createdUser: ApprovalTrailUser | null = expense.createdBy
    ? {
        id: expense.createdBy.id,
        name: expense.createdBy.name,
        email: expense.createdBy.email ?? null,
      }
    : null;

  const approvedUser: ApprovalTrailUser | null = expense.approvedBy
    ? {
        id: expense.approvedBy.id,
        name: expense.approvedBy.name,
        email: expense.approvedBy.email ?? null,
      }
    : null;

  const postedUser: ApprovalTrailUser | null = expense.postedBy
    ? {
        id: expense.postedBy.id,
        name: expense.postedBy.name,
        email: expense.postedBy.email ?? null,
      }
    : null;

  const voidedUser: ApprovalTrailUser | null = expense.voidedBy
    ? {
        id: expense.voidedBy.id,
        name: expense.voidedBy.name,
        email: expense.voidedBy.email ?? null,
      }
    : null;

  const requiresAdminApproval =
    expense.status === ExpenseStatus.PENDING_APPROVAL ||
    Boolean(expense.approvedAt || expense.approvedById);

  const timeline: ApprovalTrailStep[] = [];

  // 1. Initial creation
  timeline.push({
    step: "RECORDED",
    label: "Expense recorded",
    performedBy: createdUser,
    performedAt: expense.createdAt,
    details: {
      initialStatus: expense.status,
      voucherNo: expense.voucherNo ?? null,
    },
  });

  // 2. Routing to Admin approval if over limit or pending approval
  if (requiresAdminApproval) {
    timeline.push({
      step: "SUBMITTED_FOR_APPROVAL",
      label: "Submitted for Admin approval (exceeds approval limit)",
      performedBy: createdUser,
      performedAt: expense.createdAt,
    });
  }

  // 3. Admin approval stamp
  if (expense.approvedAt || expense.approvedById) {
    timeline.push({
      step: "APPROVED",
      label: "Approved by Admin",
      performedBy: approvedUser,
      performedAt: expense.approvedAt ?? expense.updatedAt,
    });
  }

  // 4. Ledger posting
  if (expense.postedAt || expense.postedById || expense.status === ExpenseStatus.POSTED) {
    timeline.push({
      step: "POSTED",
      label: expense.voucherNo
        ? `Posted to ledger with voucher ${expense.voucherNo}`
        : "Posted to ledger",
      performedBy: postedUser,
      performedAt: expense.postedAt ?? expense.createdAt,
      details: {
        voucherNo: expense.voucherNo ?? null,
      },
    });
  }

  // 5. Voided reversal
  if (expense.status === ExpenseStatus.VOIDED || expense.voidedAt) {
    timeline.push({
      step: "VOIDED",
      label: expense.voidReason ? `Voided: ${expense.voidReason}` : "Voided",
      performedBy: voidedUser,
      performedAt: expense.voidedAt ?? expense.updatedAt,
      details: {
        voidReason: expense.voidReason ?? null,
        reversalVoucherNo: expense.reversalEntry?.voucherNo ?? null,
      },
    });
  }

  const voidInfo =
    expense.status === ExpenseStatus.VOIDED || expense.voidedAt
      ? {
          voidedBy: voidedUser,
          voidedAt: expense.voidedAt ?? expense.updatedAt,
          voidReason: expense.voidReason ?? null,
          reversalVoucherNo: expense.reversalEntry?.voucherNo ?? null,
        }
      : null;

  return {
    status: expense.status,
    requiresAdminApproval,
    createdBy: createdUser,
    createdAt: expense.createdAt,
    approvedBy: approvedUser,
    approvedAt: expense.approvedAt ?? null,
    postedBy: postedUser,
    postedAt: expense.postedAt ?? null,
    voidInfo,
    timeline,
  };
}

/**
 * Maps a Prisma Expense record to public API representation.
 */
function mapExpenseResponse(expense: any): ExpenseResponseItem {
  const approvalTrail = buildExpenseApprovalTrail(expense);

  return {
    id: expense.id,
    mosqueId: expense.mosqueId,
    amount: expense.amount.toString(),
    accountId: expense.accountId,
    fundId: expense.fundId,
    categoryId: expense.categoryId,
    date: expense.date,
    payee: expense.payee,
    voucherNo: expense.voucherNo,
    status: expense.status,
    notes: expense.notes,
    attachments: expense.attachments ?? [],
    approvalTrail,
    approvedById: expense.approvedById,
    approvedAt: expense.approvedAt,
    voidReason: expense.voidReason,
    voidedById: expense.voidedById,
    voidedAt: expense.voidedAt,
    reversalOfId: expense.reversalOfId,
    reversalOfVoucherNo: expense.reversalOf?.voucherNo ?? null,
    reversalEntryVoucherNo: expense.reversalEntry?.voucherNo ?? null,
    createdById: expense.createdById,
    postedById: expense.postedById,
    postedAt: expense.postedAt,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    account: expense.account
      ? {
          id: expense.account.id,
          name: expense.account.name,
          type: expense.account.type,
          accountNumber: expense.account.accountNumber ?? null,
        }
      : undefined,
    fund: expense.fund
      ? {
          id: expense.fund.id,
          name: expense.fund.name,
          type: expense.fund.type,
          isRestricted: expense.fund.isRestricted,
        }
      : undefined,
    category: expense.category
      ? {
          id: expense.category.id,
          name: expense.category.name,
          type: expense.category.type,
        }
      : undefined,
    createdBy: expense.createdBy
      ? {
          id: expense.createdBy.id,
          name: expense.createdBy.name,
          email: expense.createdBy.email ?? null,
        }
      : null,
    postedBy: expense.postedBy
      ? {
          id: expense.postedBy.id,
          name: expense.postedBy.name,
          email: expense.postedBy.email ?? null,
        }
      : null,
    approvedBy: expense.approvedBy
      ? {
          id: expense.approvedBy.id,
          name: expense.approvedBy.name,
          email: expense.approvedBy.email ?? null,
        }
      : null,
    voidedBy: expense.voidedBy
      ? {
          id: expense.voidedBy.id,
          name: expense.voidedBy.name,
          email: expense.voidedBy.email ?? null,
        }
      : null,
    reversalOf: expense.reversalOf
      ? {
          id: expense.reversalOf.id,
          voucherNo: expense.reversalOf.voucherNo,
          amount: expense.reversalOf.amount?.toString() ?? null,
          date: expense.reversalOf.date,
        }
      : null,
    reversalEntry: expense.reversalEntry
      ? {
          id: expense.reversalEntry.id,
          voucherNo: expense.reversalEntry.voucherNo,
          amount: expense.reversalEntry.amount?.toString() ?? null,
          date: expense.reversalEntry.date,
        }
      : null,
  };
}

/**
 * Records a new expense / disbursement for a mosque.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN, TREASURER, or STAFF can call.
 *  - Validates payee, voucherNo, and required bill attachments.
 *  - Checks that fund and account have sufficient balance.
 *  - Verifies that category belongs to the fund.
 *  - Status & Workflow:
 *      - MOSQUE_ADMIN: posts immediately (status = POSTED, voucher generated).
 *      - TREASURER: posts immediately UNLESS amount > mosque.expenseApprovalLimit.
 *                   Above limit, status = PENDING_APPROVAL and needs ADMIN.
 *      - STAFF: saved as PENDING for review.
 */
export async function createExpense(
  mosqueId: string,
  input: CreateExpenseInput,
  actor: ExpenseActor,
): Promise<ExpenseResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Operator role check
  const isOperator =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.STAFF;

  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot record expenses.`,
      "FORBIDDEN_ROLE",
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 1. Fetch mosque settings
      const mosque = await tx.mosque.findUnique({
        where: { id: resolvedMosqueId },
        select: {
          id: true,
          expenseApprovalLimit: true,
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
          "Cannot record expense in a closed accounting period or previous fiscal year.",
          "PERIOD_CLOSED",
        );
      }

      // 3. Balance & Category checks
      await validateExpenseFinanceEntities(
        tx,
        resolvedMosqueId,
        input.accountId,
        input.fundId,
        input.categoryId,
        input.amount,
      );

      // 4. Lifecycle status & voucher determination
      let status: ExpenseStatus = ExpenseStatus.PENDING;
      let voucherNo: string | null = input.voucherNo ?? null;
      let postedById: string | null = null;
      let postedAt: Date | null = null;

      const isAboveApprovalLimit =
        mosque.expenseApprovalLimit !== null &&
        mosque.expenseApprovalLimit !== undefined &&
        input.amount > mosque.expenseApprovalLimit;

      if (actor.role === Role.MOSQUE_ADMIN) {
        // ADMIN posts immediately
        status = ExpenseStatus.POSTED;
        postedById = actor.userId;
        postedAt = new Date();
        if (!voucherNo) {
          voucherNo = await generateVoucherNumber(tx, resolvedMosqueId, input.date);
        }
      } else if (actor.role === Role.TREASURER) {
        // TREASURER posts immediately UNLESS above approval limit
        if (isAboveApprovalLimit) {
          status = ExpenseStatus.PENDING_APPROVAL;
        } else {
          status = ExpenseStatus.POSTED;
          postedById = actor.userId;
          postedAt = new Date();
          if (!voucherNo) {
            voucherNo = await generateVoucherNumber(tx, resolvedMosqueId, input.date);
          }
        }
      } else {
        // STAFF is saved as PENDING (or PENDING_APPROVAL if above limit)
        status = isAboveApprovalLimit
          ? ExpenseStatus.PENDING_APPROVAL
          : ExpenseStatus.PENDING;
      }

      // 5. Create expense record
      const expense = await tx.expense.create({
        data: {
          mosqueId: resolvedMosqueId,
          amount: input.amount,
          accountId: input.accountId,
          fundId: input.fundId,
          categoryId: input.categoryId,
          date: input.date,
          payee: input.payee,
          voucherNo,
          status,
          notes: input.notes,
          attachments: input.attachments,
          createdById: actor.userId,
          postedById,
          postedAt,
        },
        include: EXPENSE_DEFAULT_INCLUDE,
      });

      await recordAuditLog(tx, {
        mosqueId: resolvedMosqueId,
        actorId: actor.userId,
        action: AuditAction.CREATE,
        entity: AuditEntity.EXPENSE,
        entityId: expense.id,
        summary: `Recorded expense of ${expense.amount.toString()} poisha for ${expense.payee} (${expense.voucherNo || "PENDING"})`,
        metadata: {
          amount: expense.amount.toString(),
          voucherNo: expense.voucherNo,
          payee: expense.payee,
          status: expense.status,
        },
      });

      return expense;
    });

    return mapExpenseResponse(created);
  } catch (error: any) {
    if (isPrismaP2002(error)) {
      throw HttpError.conflict(
        `Voucher number '${input.voucherNo}' already exists in this mosque.`,
        "DUPLICATE_VOUCHER_NUMBER",
      );
    }
    throw error;
  }
}

/**
 * Retrieves a paginated list of expenses for a mosque.
 *
 * Authorization:
 *  - MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER (Oversight roles).
 *  - Other roles blocked with 403 Forbidden.
 *
 * Supported filters:
 *  - payee: substring search on payee
 *  - voucherNo: exact/substring search on voucher
 *  - fund / fundId: target fund CUID
 *  - account / accountId: target account CUID
 *  - category / categoryId: target category CUID
 *  - status: ExpenseStatus (PENDING, PENDING_APPROVAL, POSTED, REJECTED, VOIDED)
 *  - startDate / endDate: date boundaries
 *  - search: full-text across voucherNo, payee, notes
 *  - pagination: page, limit
 */
export async function getMosqueExpenses(
  mosqueId: string,
  query: GetMosqueExpensesQueryInput,
  actor: ExpenseActor,
): Promise<PaginatedResult<ExpenseResponseItem>> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Oversight role guard
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view mosque expenses.`,
      "FORBIDDEN_ROLE",
    );
  }

  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
  const skip = (page - 1) * limit;

  const andConditions: Prisma.ExpenseWhereInput[] = [
    { mosqueId: resolvedMosqueId },
  ];

  // Status filter
  if (query.status) {
    andConditions.push({ status: query.status });
  }

  // Fund filter
  const targetFundId = query.fund ?? query.fundId;
  if (targetFundId) {
    andConditions.push({ fundId: targetFundId });
  }

  // Account filter
  const targetAccountId = query.account ?? query.accountId;
  if (targetAccountId) {
    andConditions.push({ accountId: targetAccountId });
  }

  // Category filter
  const targetCategoryId = query.category ?? query.categoryId;
  if (targetCategoryId) {
    andConditions.push({ categoryId: targetCategoryId });
  }

  // Payee filter
  if (query.payee) {
    andConditions.push({
      payee: { contains: query.payee, mode: "insensitive" },
    });
  }

  // Voucher filter
  if (query.voucherNo) {
    andConditions.push({
      voucherNo: { contains: query.voucherNo, mode: "insensitive" },
    });
  }

  // Date range filter
  if (query.startDate || query.endDate) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.startDate) dateFilter.gte = query.startDate;
    if (query.endDate) dateFilter.lte = query.endDate;
    andConditions.push({ date: dateFilter });
  }

  // Full-text search across voucherNo, payee, notes
  if (query.search) {
    andConditions.push({
      OR: [
        { voucherNo: { contains: query.search, mode: "insensitive" } },
        { payee: { contains: query.search, mode: "insensitive" } },
        { notes: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.ExpenseWhereInput = { AND: andConditions };

  const [totalCount, expenses] = await prisma.$transaction([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: EXPENSE_DEFAULT_INCLUDE,
    }),
  ]);

  return {
    items: expenses.map(mapExpenseResponse),
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
 * Retrieves a single expense record by ID with full details, bill attachments, and approval trail.
 *
 * Authorization:
 *  - MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER (Oversight roles).
 *  - Other roles blocked with 403 Forbidden.
 */
export async function getExpenseById(
  mosqueId: string,
  expenseId: string,
  actor: ExpenseActor,
): Promise<ExpenseResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Oversight role guard
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view mosque expenses.`,
      "FORBIDDEN_ROLE",
    );
  }

  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      mosqueId: resolvedMosqueId,
    },
    include: EXPENSE_DEFAULT_INCLUDE,
  });

  if (!expense) {
    throw HttpError.notFound("Expense record not found in this mosque.", "EXPENSE_NOT_FOUND");
  }

  return mapExpenseResponse(expense);
}

/**
 * Updates non-financial fields on an existing expense entry (notes, payee, attachments).
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN and TREASURER can perform updates (FINANCIAL_OPERATOR_ROLES).
 *  - Financial fields (amount, fund, account, date, category, voucher) are rejected by validation with TRANSACTION_IMMUTABLE.
 *  - Cannot edit a voided expense (frozen for audit compliance).
 *  - Returns updated expense record with full relations and approval trail.
 */
export async function updateExpense(
  mosqueId: string,
  expenseId: string,
  input: UpdateExpenseInput,
  actor: ExpenseActor,
): Promise<ExpenseResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Financial operator role guard (MOSQUE_ADMIN, TREASURER)
  const isFinancialOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinancialOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot modify expense records.`,
      "FORBIDDEN_ROLE",
    );
  }

  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!expense) {
    throw HttpError.notFound("Expense record not found in this mosque.", "EXPENSE_NOT_FOUND");
  }

  // Voided expenses cannot be edited
  if (expense.status === ExpenseStatus.VOIDED) {
    throw HttpError.badRequest(
      "Cannot edit a voided expense. Voided records are permanently frozen for audit compliance.",
      "EXPENSE_VOIDED",
    );
  }

  const dataToUpdate: Prisma.ExpenseUpdateInput = {};
  if (input.notes !== undefined) dataToUpdate.notes = input.notes;
  if (input.payee !== undefined) dataToUpdate.payee = input.payee;
  if (input.attachments !== undefined) dataToUpdate.attachments = input.attachments;

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: dataToUpdate,
    include: EXPENSE_DEFAULT_INCLUDE,
  });

  return mapExpenseResponse(updated);
}

export interface VoidExpenseResult {
  voidedExpense: ExpenseResponseItem;
  reversalEntry: ExpenseResponseItem;
  restoredAccountBalance: string;
  restoredFundBalance: string;
}

/**
 * Voids a posted expense entry and creates an offsetting reversal entry in the ledger.
 *
 * Rules & Guarantees:
 *  - Only MOSQUE_ADMIN can void expenses.
 *  - Reason is required (min 3 chars).
 *  - Fails with 400 ALREADY_VOIDED if expense is already voided.
 *  - Fails with 400 CANNOT_VOID_REVERSAL if expense is itself a reversal entry.
 *  - Fails with 400 CANNOT_VOID_PENDING if expense is still in PENDING or PENDING_APPROVAL status.
 *  - Fails with 400 PERIOD_CLOSED if expense date falls within a closed accounting period or previous fiscal year.
 *  - Performs an atomic Prisma transaction that marks original record as VOIDED,
 *    and inserts an offsetting reversal entry (negative amount, status POSTED, voucherNo REV-...)
 *    linked via reversalOfId.
 *  - Restores the account and fund available balance.
 */
export async function voidExpense(
  mosqueId: string,
  expenseId: string,
  reason: string,
  actor: ExpenseActor,
): Promise<VoidExpenseResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Admin-only role guard
  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot void expense records. Only Mosque Admins can void expenses.`,
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

  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!expense) {
    throw HttpError.notFound("Expense record not found in this mosque.", "EXPENSE_NOT_FOUND");
  }

  if (expense.status === ExpenseStatus.VOIDED) {
    throw HttpError.badRequest("Expense has already been voided.", "ALREADY_VOIDED");
  }

  if (
    expense.status === ExpenseStatus.PENDING ||
    expense.status === ExpenseStatus.PENDING_APPROVAL
  ) {
    throw HttpError.badRequest(
      "Cannot void an unposted pending expense. Reject or delete the pending record instead.",
      "CANNOT_VOID_PENDING",
    );
  }

  if (expense.amount < 0n || expense.reversalOfId) {
    throw HttpError.badRequest(
      "Cannot void a reversal entry.",
      "CANNOT_VOID_REVERSAL",
    );
  }

  if (isDateInClosedPeriod(expense.date, mosque)) {
    throw HttpError.badRequest(
      "Cannot void an expense from a closed accounting period or previous fiscal year.",
      "PERIOD_CLOSED",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Mark original expense as VOIDED
    const voided = await tx.expense.update({
      where: { id: expenseId },
      data: {
        status: ExpenseStatus.VOIDED,
        voidReason: reason,
        voidedById: actor.userId,
        voidedAt: new Date(),
      },
      include: EXPENSE_DEFAULT_INCLUDE,
    });

    // 2. Generate unique reversal voucher number
    const reversalVoucherNo = expense.voucherNo
      ? `REV-${expense.voucherNo}`
      : `REV-${expense.id.slice(0, 8).toUpperCase()}`;

    // 3. Create offsetting reversal entry
    const reversal = await tx.expense.create({
      data: {
        mosqueId: resolvedMosqueId,
        amount: -expense.amount,
        accountId: expense.accountId,
        fundId: expense.fundId,
        categoryId: expense.categoryId,
        date: new Date(),
        payee: expense.payee,
        voucherNo: reversalVoucherNo,
        status: ExpenseStatus.POSTED,
        notes: `Reversal entry for voucher ${expense.voucherNo ?? expense.id}: ${reason}`,
        attachments: expense.attachments,
        reversalOfId: expense.id,
        createdById: actor.userId,
        postedById: actor.userId,
        postedAt: new Date(),
      },
      include: EXPENSE_DEFAULT_INCLUDE,
    });

    // Attach created reversal entry to voided record for complete linkage in return payload
    (voided as any).reversalEntry = reversal;

    // Compute restored balances
    const restoredAccountBalance = await getAccountBalance(tx, expense.accountId);
    const restoredFundBalance = await getFundBalance(tx, expense.fundId);

    await recordAuditLog(tx, {
      mosqueId: resolvedMosqueId,
      actorId: actor.userId,
      action: AuditAction.VOID,
      entity: AuditEntity.EXPENSE,
      entityId: expense.id,
      summary: `Voided expense (${expense.voucherNo || expense.id}): ${reason}`,
      metadata: {
        amount: expense.amount.toString(),
        reason,
        voucherNo: expense.voucherNo,
        reversalVoucherNo,
      },
    });

    return {
      voidedExpense: mapExpenseResponse(voided),
      reversalEntry: mapExpenseResponse(reversal),
      restoredAccountBalance: restoredAccountBalance.toString(),
      restoredFundBalance: restoredFundBalance.toString(),
    };
  });

  return result;
}




