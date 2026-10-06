// ---------------------------------------------------------------------------
// Expense Service — Mosque Disbursements & Operational Spending
// ---------------------------------------------------------------------------

import { prisma, isPrismaP2002 } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  ExpenseStatus,
  DonationStatus,
  CategoryType,
  AccountType,
  FundType,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import { isDateInClosedPeriod } from "../donation/donation.service.js";
import type { CreateExpenseInput } from "./expense.validation.js";

export interface ExpenseActor {
  userId: string;
  role: Role;
  membershipId?: string;
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
  approvedById: string | null;
  approvedAt: Date | null;
  voidReason: string | null;
  voidedById: string | null;
  voidedAt: Date | null;
  reversalOfId: string | null;
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
  } | null;
  postedBy?: {
    id: string;
    name: string;
  } | null;
  approvedBy?: {
    id: string;
    name: string;
  } | null;
}

export const EXPENSE_DEFAULT_INCLUDE = {
  account: { select: { id: true, name: true, type: true, accountNumber: true } },
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  category: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

/**
 * Calculates current available balance in a physical Account.
 * Balance = openingBalance + total POSTED donations - total POSTED expenses.
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
    where: { accountId, status: DonationStatus.POSTED },
    _sum: { amount: true },
  });

  const expenses = await tx.expense.aggregate({
    where: { accountId, status: ExpenseStatus.POSTED },
    _sum: { amount: true },
  });

  return (
    account.openingBalance +
    (donations._sum.amount ?? 0n) -
    (expenses._sum.amount ?? 0n)
  );
}

/**
 * Calculates current available balance in an accounting Fund.
 * Balance = total POSTED donations - total POSTED expenses.
 */
export async function getFundBalance(
  tx: Prisma.TransactionClient,
  fundId: string,
): Promise<bigint> {
  const donations = await tx.donation.aggregate({
    where: { fundId, status: DonationStatus.POSTED },
    _sum: { amount: true },
  });

  const expenses = await tx.expense.aggregate({
    where: { fundId, status: ExpenseStatus.POSTED },
    _sum: { amount: true },
  });

  return (
    (donations._sum.amount ?? 0n) -
    (expenses._sum.amount ?? 0n)
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
 * Maps a Prisma Expense record to public API representation.
 */
function mapExpenseResponse(expense: any): ExpenseResponseItem {
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
    approvedById: expense.approvedById,
    approvedAt: expense.approvedAt,
    voidReason: expense.voidReason,
    voidedById: expense.voidedById,
    voidedAt: expense.voidedAt,
    reversalOfId: expense.reversalOfId,
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
        }
      : null,
    postedBy: expense.postedBy
      ? {
          id: expense.postedBy.id,
          name: expense.postedBy.name,
        }
      : null,
    approvedBy: expense.approvedBy
      ? {
          id: expense.approvedBy.id,
          name: expense.approvedBy.name,
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

