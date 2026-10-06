// ---------------------------------------------------------------------------
// Transaction Service — Unified Ledger & Approvals
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  DonationStatus,
  ExpenseStatus,
  TransferLeg,
  TransferStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import {
  isDateInClosedPeriod,
  generateNextReceiptNumber,
} from "../donation/donation.service.js";
import {
  generateVoucherNumber,
  getAccountBalance,
  getFundBalance,
} from "../expense/expense.service.js";
import { TRANSFER_PAIR_INCLUDE } from "../transfer/transfer.service.js";
import type {
  GetTransactionsQueryInput,
  GetPendingTransactionsQueryInput,
  RejectTransactionInput,
  CursorPayload,
} from "./transaction.validation.js";

export interface TransactionActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export type TransactionType = "DONATION" | "EXPENSE" | "TRANSFER";

export interface TransactionHistoryStep {
  step: "RECORDED" | "SUBMITTED_FOR_APPROVAL" | "APPROVED" | "POSTED" | "REJECTED" | "VOIDED";
  label: string;
  performedBy: { id: string; name: string; email: string | null } | null;
  performedAt: Date;
  details?: Record<string, unknown>;
}

export interface UnifiedTransactionItem {
  id: string;
  type: TransactionType;
  transactionNumber: string | null;
  amount: string;
  date: Date;
  status: string;
  party: string | null;
  accountId: string;
  accountName?: string;
  toAccountId?: string | null;
  toAccountName?: string | null;
  fundId: string;
  fundName?: string;
  toFundId?: string | null;
  toFundName?: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  notes: string | null;
  attachments?: string[];
  requiresAdminApproval?: boolean;
  rejectionReason?: string | null;
  voidReason?: string | null;
  createdById: string | null;
  createdBy?: { id: string; name: string; email: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  history?: TransactionHistoryStep[];
}

export interface CursorPaginatedResult<T> {
  items: T[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

/**
 * Base64url encodes cursor payload { date, id }
 */
export function encodeCursor(date: Date, id: string): string {
  const payload: CursorPayload = {
    date: date.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decodes cursor string into { date, id }
 */
export function decodeCursor(cursor: string): { date: Date; id: string } | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    if (raw && typeof raw.date === "string" && typeof raw.id === "string") {
      const d = new Date(raw.date);
      if (!isNaN(d.getTime())) {
        return { date: d, id: raw.id };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/transactions
 * Master ledger query across Donations, Expenses, and Transfers with cursor pagination.
 */
export async function getTransactions(
  mosqueId: string,
  query: GetTransactionsQueryInput,
  actor: TransactionActor,
): Promise<CursorPaginatedResult<UnifiedTransactionItem>> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Oversight role authorization
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view the master transactions ledger.`,
      "FORBIDDEN_ROLE",
    );
  }

  const limit = query.limit || 20;
  const fetchLimit = limit + 1;
  const cursorObj = query.cursor ? decodeCursor(query.cursor) : null;

  // Cursor condition for descending order: date < cursor.date OR (date == cursor.date AND id < cursor.id)
  const cursorWhere = cursorObj
    ? {
        OR: [
          { date: { lt: cursorObj.date } },
          { date: cursorObj.date, id: { lt: cursorObj.id } },
        ],
      }
    : undefined;

  const shouldFetchDonations =
    !query.type || query.type === "DONATION" || query.type === "INCOME";
  const shouldFetchExpenses = !query.type || query.type === "EXPENSE";
  const shouldFetchTransfers =
    (!query.type || query.type === "TRANSFER") && !query.categoryId;

  // 1. Fetch Donations
  const fetchDonationsPromise = (async (): Promise<UnifiedTransactionItem[]> => {
    if (!shouldFetchDonations) return [];

    const andConditions: Prisma.DonationWhereInput[] = [
      { mosqueId: resolvedMosqueId },
      { reversalOfId: null },
    ];

    if (cursorWhere) andConditions.push(cursorWhere);
    if (query.status) {
      if (Object.values(DonationStatus).includes(query.status as DonationStatus)) {
        andConditions.push({ status: query.status as DonationStatus });
      } else {
        return [];
      }
    }
    if (query.categoryId) andConditions.push({ categoryId: query.categoryId });
    if (query.fundId) andConditions.push({ fundId: query.fundId });
    if (query.accountId) andConditions.push({ accountId: query.accountId });
    if (query.createdBy) andConditions.push({ createdById: query.createdBy });

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.startDate) dateFilter.gte = query.startDate;
      if (query.endDate) dateFilter.lte = query.endDate;
      andConditions.push({ date: dateFilter });
    }

    if (query.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { donorName: { contains: s, mode: "insensitive" } },
          { donorPhone: { contains: s, mode: "insensitive" } },
          { donorEmail: { contains: s, mode: "insensitive" } },
          { receiptNumber: { contains: s, mode: "insensitive" } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }

    const rows = await prisma.donation.findMany({
      where: { AND: andConditions },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: fetchLimit,
    });

    return rows.map((d) => ({
      id: d.id,
      type: "DONATION" as const,
      transactionNumber: d.receiptNumber,
      amount: d.amount.toString(),
      date: d.date,
      status: d.status,
      party: d.isAnonymousPublic ? "Anonymous" : d.donorName || "Walk-in Donor",
      accountId: d.accountId,
      accountName: d.account?.name,
      fundId: d.fundId,
      fundName: d.fund?.name,
      categoryId: d.categoryId,
      categoryName: d.category?.name,
      notes: d.notes,
      attachments: d.attachments,
      rejectionReason: d.rejectionReason,
      voidReason: d.voidReason,
      createdById: d.createdById,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  })();

  // 2. Fetch Expenses
  const fetchExpensesPromise = (async (): Promise<UnifiedTransactionItem[]> => {
    if (!shouldFetchExpenses) return [];

    const andConditions: Prisma.ExpenseWhereInput[] = [
      { mosqueId: resolvedMosqueId },
      { reversalOfId: null },
    ];

    if (cursorWhere) andConditions.push(cursorWhere);
    if (query.status) {
      if (Object.values(ExpenseStatus).includes(query.status as ExpenseStatus)) {
        andConditions.push({ status: query.status as ExpenseStatus });
      } else {
        return [];
      }
    }
    if (query.categoryId) andConditions.push({ categoryId: query.categoryId });
    if (query.fundId) andConditions.push({ fundId: query.fundId });
    if (query.accountId) andConditions.push({ accountId: query.accountId });
    if (query.createdBy) andConditions.push({ createdById: query.createdBy });

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.startDate) dateFilter.gte = query.startDate;
      if (query.endDate) dateFilter.lte = query.endDate;
      andConditions.push({ date: dateFilter });
    }

    if (query.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { payee: { contains: s, mode: "insensitive" } },
          { voucherNo: { contains: s, mode: "insensitive" } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }

    const rows = await prisma.expense.findMany({
      where: { AND: andConditions },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: fetchLimit,
    });

    return rows.map((e) => ({
      id: e.id,
      type: "EXPENSE" as const,
      transactionNumber: e.voucherNo,
      amount: e.amount.toString(),
      date: e.date,
      status: e.status,
      party: e.payee,
      accountId: e.accountId,
      accountName: e.account?.name,
      fundId: e.fundId,
      fundName: e.fund?.name,
      categoryId: e.categoryId,
      categoryName: e.category?.name,
      notes: e.notes,
      attachments: e.attachments,
      requiresAdminApproval: e.status === ExpenseStatus.PENDING_APPROVAL,
      rejectionReason: e.rejectionReason,
      voidReason: e.voidReason,
      createdById: e.createdById,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  })();

  // 3. Fetch Transfers (FROM leg represents the transfer pair in unified ledger)
  const fetchTransfersPromise = (async (): Promise<UnifiedTransactionItem[]> => {
    if (!shouldFetchTransfers) return [];

    const andConditions: Prisma.TransferWhereInput[] = [
      { mosqueId: resolvedMosqueId },
      { leg: TransferLeg.FROM },
      { reversalOfId: null },
    ];

    if (cursorWhere) andConditions.push(cursorWhere);
    if (query.status) {
      if (Object.values(TransferStatus).includes(query.status as TransferStatus)) {
        andConditions.push({ status: query.status as TransferStatus });
      } else {
        return [];
      }
    }
    if (query.fundId) {
      andConditions.push({
        OR: [
          { fundId: query.fundId },
          { linkedTransfer: { fundId: query.fundId } },
        ],
      });
    }
    if (query.accountId) {
      andConditions.push({
        OR: [
          { accountId: query.accountId },
          { linkedTransfer: { accountId: query.accountId } },
        ],
      });
    }
    if (query.createdBy) andConditions.push({ createdById: query.createdBy });

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.startDate) dateFilter.gte = query.startDate;
      if (query.endDate) dateFilter.lte = query.endDate;
      andConditions.push({ date: dateFilter });
    }

    if (query.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { transferNumber: { contains: s, mode: "insensitive" } },
          { reason: { contains: s, mode: "insensitive" } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }

    const rows = await prisma.transfer.findMany({
      where: { AND: andConditions },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        linkedTransfer: {
          include: {
            account: { select: { id: true, name: true } },
            fund: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: fetchLimit,
    });

    return rows.map((t) => ({
      id: t.id,
      type: "TRANSFER" as const,
      transactionNumber: t.transferNumber,
      amount: t.amount.toString(),
      date: t.date,
      status: t.status,
      party: t.isFundTransfer ? "Fund Transfer" : "Account Transfer",
      accountId: t.accountId,
      accountName: t.account?.name,
      toAccountId: t.linkedTransfer?.accountId ?? null,
      toAccountName: t.linkedTransfer?.account?.name ?? null,
      fundId: t.fundId,
      fundName: t.fund?.name,
      toFundId: t.linkedTransfer?.fundId ?? null,
      toFundName: t.linkedTransfer?.fund?.name ?? null,
      categoryId: null,
      categoryName: null,
      notes: t.reason ? `${t.reason}${t.notes ? ` — ${t.notes}` : ""}` : t.notes,
      voidReason: t.voidReason,
      createdById: t.createdById,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  })();

  const [donations, expenses, transfers] = await Promise.all([
    fetchDonationsPromise,
    fetchExpensesPromise,
    fetchTransfersPromise,
  ]);

  // Merge and sort in-memory
  const merged = [...donations, ...expenses, ...transfers];
  merged.sort((a, b) => {
    const diff = b.date.getTime() - a.date.getTime();
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  const hasNextPage = merged.length > limit;
  const pageItems = merged.slice(0, limit);
  const lastItem = pageItems[pageItems.length - 1];

  const nextCursor =
    hasNextPage && lastItem
      ? encodeCursor(lastItem.date, lastItem.id)
      : null;

  return {
    items: pageItems,
    pagination: {
      limit,
      nextCursor,
      hasNextPage,
    },
  };
}

/**
 * Builds chronological audit history for a donation entry.
 */
function buildDonationHistory(donation: any): TransactionHistoryStep[] {
  const history: TransactionHistoryStep[] = [];

  // 1. RECORDED
  history.push({
    step: "RECORDED",
    label: "Donation recorded",
    performedBy: donation.createdBy
      ? { id: donation.createdBy.id, name: donation.createdBy.name, email: donation.createdBy.email ?? null }
      : null,
    performedAt: donation.createdAt,
    details: {
      source: donation.source,
      donor: donation.donorName || "Walk-in",
      amount: donation.amount.toString(),
    },
  });

  // 2. POSTED
  if (donation.postedAt || donation.postedById || donation.status === DonationStatus.POSTED) {
    history.push({
      step: "POSTED",
      label: donation.receiptNumber
        ? `Posted with receipt ${donation.receiptNumber}`
        : "Posted to ledger",
      performedBy: donation.postedBy
        ? { id: donation.postedBy.id, name: donation.postedBy.name, email: donation.postedBy.email ?? null }
        : null,
      performedAt: donation.postedAt ?? donation.createdAt,
      details: {
        receiptNumber: donation.receiptNumber ?? null,
      },
    });
  }

  // 3. REJECTED
  if (donation.status === DonationStatus.REJECTED || donation.rejectedAt) {
    history.push({
      step: "REJECTED",
      label: donation.rejectionReason
        ? `Rejected: ${donation.rejectionReason}`
        : "Rejected",
      performedBy: donation.rejectedBy
        ? { id: donation.rejectedBy.id, name: donation.rejectedBy.name, email: donation.rejectedBy.email ?? null }
        : null,
      performedAt: donation.rejectedAt ?? donation.updatedAt,
      details: {
        reason: donation.rejectionReason ?? null,
      },
    });
  }

  // 4. VOIDED
  if (donation.status === DonationStatus.VOIDED || donation.voidedAt) {
    history.push({
      step: "VOIDED",
      label: donation.voidReason ? `Voided: ${donation.voidReason}` : "Voided",
      performedBy: donation.voidedBy
        ? { id: donation.voidedBy.id, name: donation.voidedBy.name, email: donation.voidedBy.email ?? null }
        : null,
      performedAt: donation.voidedAt ?? donation.updatedAt,
      details: {
        reason: donation.voidReason ?? null,
        reversalReceiptNumber: donation.reversalEntry?.receiptNumber ?? null,
      },
    });
  }

  return history;
}

/**
 * Builds chronological audit history for an expense entry.
 */
function buildExpenseHistory(expense: any): TransactionHistoryStep[] {
  const history: TransactionHistoryStep[] = [];

  // 1. RECORDED
  history.push({
    step: "RECORDED",
    label: "Expense recorded",
    performedBy: expense.createdBy
      ? { id: expense.createdBy.id, name: expense.createdBy.name, email: expense.createdBy.email ?? null }
      : null,
    performedAt: expense.createdAt,
    details: {
      payee: expense.payee,
      amount: expense.amount.toString(),
    },
  });

  // 2. SUBMITTED_FOR_APPROVAL
  if (expense.status === ExpenseStatus.PENDING_APPROVAL) {
    history.push({
      step: "SUBMITTED_FOR_APPROVAL",
      label: "Submitted for Admin approval (exceeds approval limit)",
      performedBy: expense.createdBy
        ? { id: expense.createdBy.id, name: expense.createdBy.name, email: expense.createdBy.email ?? null }
        : null,
      performedAt: expense.createdAt,
    });
  }

  // 3. APPROVED
  if (expense.approvedAt || expense.approvedById) {
    history.push({
      step: "APPROVED",
      label: "Approved by Admin",
      performedBy: expense.approvedBy
        ? { id: expense.approvedBy.id, name: expense.approvedBy.name, email: expense.approvedBy.email ?? null }
        : null,
      performedAt: expense.approvedAt ?? expense.updatedAt,
    });
  }

  // 4. POSTED
  if (expense.postedAt || expense.postedById || expense.status === ExpenseStatus.POSTED) {
    history.push({
      step: "POSTED",
      label: expense.voucherNo
        ? `Posted with voucher ${expense.voucherNo}`
        : "Posted to ledger",
      performedBy: expense.postedBy
        ? { id: expense.postedBy.id, name: expense.postedBy.name, email: expense.postedBy.email ?? null }
        : null,
      performedAt: expense.postedAt ?? expense.createdAt,
      details: {
        voucherNo: expense.voucherNo ?? null,
      },
    });
  }

  // 5. REJECTED
  if (expense.status === ExpenseStatus.REJECTED || expense.rejectedAt) {
    history.push({
      step: "REJECTED",
      label: expense.rejectionReason
        ? `Rejected: ${expense.rejectionReason}`
        : "Rejected",
      performedBy: expense.rejectedBy
        ? { id: expense.rejectedBy.id, name: expense.rejectedBy.name, email: expense.rejectedBy.email ?? null }
        : null,
      performedAt: expense.rejectedAt ?? expense.updatedAt,
      details: {
        reason: expense.rejectionReason ?? null,
      },
    });
  }

  // 6. VOIDED
  if (expense.status === ExpenseStatus.VOIDED || expense.voidedAt) {
    history.push({
      step: "VOIDED",
      label: expense.voidReason ? `Voided: ${expense.voidReason}` : "Voided",
      performedBy: expense.voidedBy
        ? { id: expense.voidedBy.id, name: expense.voidedBy.name, email: expense.voidedBy.email ?? null }
        : null,
      performedAt: expense.voidedAt ?? expense.updatedAt,
      details: {
        reason: expense.voidReason ?? null,
        reversalVoucherNo: expense.reversalEntry?.voucherNo ?? null,
      },
    });
  }

  return history;
}

/**
 * Builds chronological audit history for a transfer pair.
 */
function buildTransferHistory(transfer: any): TransactionHistoryStep[] {
  const history: TransactionHistoryStep[] = [];

  // 1. RECORDED & POSTED
  history.push({
    step: "POSTED",
    label: `Transfer executed with ${transfer.transferNumber}`,
    performedBy: transfer.createdBy
      ? { id: transfer.createdBy.id, name: transfer.createdBy.name, email: transfer.createdBy.email ?? null }
      : null,
    performedAt: transfer.createdAt,
    details: {
      transferNumber: transfer.transferNumber,
      amount: transfer.amount.toString(),
      isFundTransfer: transfer.isFundTransfer,
      reason: transfer.reason,
    },
  });

  // 2. VOIDED
  if (transfer.status === TransferStatus.VOIDED || transfer.voidedAt) {
    history.push({
      step: "VOIDED",
      label: transfer.voidReason ? `Voided: ${transfer.voidReason}` : "Voided",
      performedBy: transfer.voidedBy
        ? { id: transfer.voidedBy.id, name: transfer.voidedBy.name, email: transfer.voidedBy.email ?? null }
        : null,
      performedAt: transfer.voidedAt ?? transfer.updatedAt,
      details: {
        reason: transfer.voidReason ?? null,
        reversalTransferNumber: transfer.reversalEntry?.transferNumber ?? null,
      },
    });
  }

  return history;
}

/**
 * GET /api/transactions/:id
 * Single entry with its full history (created, approved, voided, etc.).
 */
export async function getTransactionById(
  mosqueId: string,
  id: string,
  actor: TransactionActor,
): Promise<UnifiedTransactionItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view transaction details.`,
      "FORBIDDEN_ROLE",
    );
  }

  // 1. Check Donation
  const donation = await prisma.donation.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      postedBy: { select: { id: true, name: true, email: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
      rejectedBy: { select: { id: true, name: true, email: true } },
      reversalEntry: { select: { id: true, receiptNumber: true } },
    },
  });

  if (donation) {
    return {
      id: donation.id,
      type: "DONATION",
      transactionNumber: donation.receiptNumber,
      amount: donation.amount.toString(),
      date: donation.date,
      status: donation.status,
      party: donation.isAnonymousPublic ? "Anonymous" : donation.donorName || "Walk-in Donor",
      accountId: donation.accountId,
      accountName: donation.account?.name,
      fundId: donation.fundId,
      fundName: donation.fund?.name,
      categoryId: donation.categoryId,
      categoryName: donation.category?.name,
      notes: donation.notes,
      attachments: donation.attachments,
      rejectionReason: donation.rejectionReason,
      voidReason: donation.voidReason,
      createdById: donation.createdById,
      createdBy: donation.createdBy,
      createdAt: donation.createdAt,
      updatedAt: donation.updatedAt,
      history: buildDonationHistory(donation),
    };
  }

  // 2. Check Expense
  const expense = await prisma.expense.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      postedBy: { select: { id: true, name: true, email: true } },
      voidedBy: { select: { id: true, name: true, email: true } },
      rejectedBy: { select: { id: true, name: true, email: true } },
      reversalEntry: { select: { id: true, voucherNo: true } },
    },
  });

  if (expense) {
    return {
      id: expense.id,
      type: "EXPENSE",
      transactionNumber: expense.voucherNo,
      amount: expense.amount.toString(),
      date: expense.date,
      status: expense.status,
      party: expense.payee,
      accountId: expense.accountId,
      accountName: expense.account?.name,
      fundId: expense.fundId,
      fundName: expense.fund?.name,
      categoryId: expense.categoryId,
      categoryName: expense.category?.name,
      notes: expense.notes,
      attachments: expense.attachments,
      requiresAdminApproval: expense.status === ExpenseStatus.PENDING_APPROVAL,
      rejectionReason: expense.rejectionReason,
      voidReason: expense.voidReason,
      createdById: expense.createdById,
      createdBy: expense.createdBy,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      history: buildExpenseHistory(expense),
    };
  }

  // 3. Check Transfer
  const transfer = await prisma.transfer.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      OR: [{ id }, { transferNumber: id }],
    },
    include: TRANSFER_PAIR_INCLUDE,
  });

  if (transfer) {
    const fromLeg = transfer.leg === TransferLeg.FROM ? transfer : transfer.linkedTransfer ?? transfer;
    const toLeg = transfer.leg === TransferLeg.TO ? transfer : transfer.linkedTransfer ?? transfer;

    return {
      id: fromLeg.id,
      type: "TRANSFER",
      transactionNumber: fromLeg.transferNumber,
      amount: fromLeg.amount.toString(),
      date: fromLeg.date,
      status: fromLeg.status,
      party: fromLeg.isFundTransfer ? "Fund Transfer" : "Account Transfer",
      accountId: fromLeg.accountId,
      accountName: fromLeg.account?.name,
      toAccountId: toLeg.accountId,
      toAccountName: toLeg.account?.name,
      fundId: fromLeg.fundId,
      fundName: fromLeg.fund?.name,
      toFundId: toLeg.fundId,
      toFundName: toLeg.fund?.name,
      categoryId: null,
      categoryName: null,
      notes: fromLeg.reason
        ? `${fromLeg.reason}${fromLeg.notes ? ` — ${fromLeg.notes}` : ""}`
        : fromLeg.notes,
      voidReason: fromLeg.voidReason,
      createdById: fromLeg.createdById,
      createdBy: fromLeg.createdBy,
      createdAt: fromLeg.createdAt,
      updatedAt: fromLeg.updatedAt,
      history: buildTransferHistory(fromLeg),
    };
  }

  throw HttpError.notFound("Transaction record not found.", "TRANSACTION_NOT_FOUND");
}

export interface PendingQueueResult {
  items: UnifiedTransactionItem[];
  totalPending: number;
}

/**
 * GET /api/transactions/pending
 * The approval queue: STAFF entries and over-limit expenses.
 */
export async function getPendingTransactions(
  mosqueId: string,
  query: GetPendingTransactionsQueryInput,
  actor: TransactionActor,
): Promise<PendingQueueResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Operator role check
  const isOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot view the approval queue.`,
      "FORBIDDEN_ROLE",
    );
  }

  const limit = query.limit || 50;

  const shouldFetchDonations = !query.type || query.type === "DONATION";
  const shouldFetchExpenses = !query.type || query.type === "EXPENSE";

  // 1. Pending donations
  const fetchDonations = (async (): Promise<UnifiedTransactionItem[]> => {
    if (!shouldFetchDonations) return [];

    const andConditions: Prisma.DonationWhereInput[] = [
      { mosqueId: resolvedMosqueId },
      { status: DonationStatus.PENDING },
      { reversalOfId: null },
    ];

    if (query.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { donorName: { contains: s, mode: "insensitive" } },
          { donorPhone: { contains: s, mode: "insensitive" } },
          { donorEmail: { contains: s, mode: "insensitive" } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }

    const rows = await prisma.donation.findMany({
      where: { AND: andConditions },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return rows.map((d) => ({
      id: d.id,
      type: "DONATION" as const,
      transactionNumber: d.receiptNumber,
      amount: d.amount.toString(),
      date: d.date,
      status: d.status,
      party: d.isAnonymousPublic ? "Anonymous" : d.donorName || "Walk-in Donor",
      accountId: d.accountId,
      accountName: d.account?.name,
      fundId: d.fundId,
      fundName: d.fund?.name,
      categoryId: d.categoryId,
      categoryName: d.category?.name,
      notes: d.notes,
      attachments: d.attachments,
      requiresAdminApproval: false,
      createdById: d.createdById,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  })();

  // 2. Pending expenses
  const fetchExpenses = (async (): Promise<UnifiedTransactionItem[]> => {
    if (!shouldFetchExpenses) return [];

    const andConditions: Prisma.ExpenseWhereInput[] = [
      { mosqueId: resolvedMosqueId },
      {
        status: {
          in: [ExpenseStatus.PENDING, ExpenseStatus.PENDING_APPROVAL],
        },
      },
      { reversalOfId: null },
    ];

    if (query.search) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { payee: { contains: s, mode: "insensitive" } },
          { notes: { contains: s, mode: "insensitive" } },
        ],
      });
    }

    const rows = await prisma.expense.findMany({
      where: { AND: andConditions },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return rows.map((e) => ({
      id: e.id,
      type: "EXPENSE" as const,
      transactionNumber: e.voucherNo,
      amount: e.amount.toString(),
      date: e.date,
      status: e.status,
      party: e.payee,
      accountId: e.accountId,
      accountName: e.account?.name,
      fundId: e.fundId,
      fundName: e.fund?.name,
      categoryId: e.categoryId,
      categoryName: e.category?.name,
      notes: e.notes,
      attachments: e.attachments,
      requiresAdminApproval: e.status === ExpenseStatus.PENDING_APPROVAL,
      createdById: e.createdById,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  })();

  const [donations, expenses] = await Promise.all([fetchDonations, fetchExpenses]);
  const merged = [...donations, ...expenses];
  merged.sort((a, b) => {
    const dDiff = b.date.getTime() - a.date.getTime();
    if (dDiff !== 0) return dDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return {
    items: merged.slice(0, limit),
    totalPending: merged.length,
  };
}

/**
 * POST /api/transactions/:id/approve
 * Approves a pending donation or expense, moves it to POSTED, and assigns sequential receipt/voucher number.
 *
 * Rules:
 *  - Allowed: MOSQUE_ADMIN, TREASURER.
 *  - Over-limit expenses (PENDING_APPROVAL): MOSQUE_ADMIN only!
 *  - Self-approval blocked: approver !== creator with SELF_APPROVAL_NOT_ALLOWED.
 *  - Closed period validation.
 *  - Verifies available balances for expenses before posting.
 */
export async function approveTransaction(
  mosqueId: string,
  id: string,
  actor: TransactionActor,
): Promise<UnifiedTransactionItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Financial operator role guard
  const isOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot approve transactions.`,
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

  // 1. Check Donation
  const donation = await prisma.donation.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (donation) {
    // Already posted check
    if (donation.status === DonationStatus.POSTED) {
      throw HttpError.badRequest("Transaction is already posted.", "ALREADY_POSTED");
    }

    if (donation.status !== DonationStatus.PENDING) {
      throw HttpError.badRequest(
        `Cannot approve donation with status '${donation.status}'. Only PENDING entries can be approved.`,
        "INVALID_TRANSACTION_STATUS",
      );
    }

    // Self-approval rule
    if (donation.createdById === actor.userId) {
      throw HttpError.badRequest(
        "Self-approval is not allowed. A different administrator or treasurer must approve your entry.",
        "SELF_APPROVAL_NOT_ALLOWED",
      );
    }

    // Closed period check
    if (isDateInClosedPeriod(donation.date, mosque)) {
      throw HttpError.badRequest(
        "Cannot approve a donation recorded in a closed accounting period or previous fiscal year.",
        "PERIOD_CLOSED",
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      let receiptNumber = donation.receiptNumber;
      if (!receiptNumber) {
        receiptNumber = await generateNextReceiptNumber(tx, resolvedMosqueId, donation.date.getFullYear());
      }

      return tx.donation.update({
        where: { id: donation.id },
        data: {
          status: DonationStatus.POSTED,
          receiptNumber,
          postedById: actor.userId,
          postedAt: new Date(),
        },
        include: {
          account: { select: { id: true, name: true } },
          fund: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          postedBy: { select: { id: true, name: true, email: true } },
        },
      });
    });

    return {
      id: updated.id,
      type: "DONATION",
      transactionNumber: updated.receiptNumber,
      amount: updated.amount.toString(),
      date: updated.date,
      status: updated.status,
      party: updated.isAnonymousPublic ? "Anonymous" : updated.donorName || "Walk-in Donor",
      accountId: updated.accountId,
      accountName: updated.account?.name,
      fundId: updated.fundId,
      fundName: updated.fund?.name,
      categoryId: updated.categoryId,
      categoryName: updated.category?.name,
      notes: updated.notes,
      attachments: updated.attachments,
      createdById: updated.createdById,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      history: buildDonationHistory(updated),
    };
  }

  // 2. Check Expense
  const expense = await prisma.expense.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (expense) {
    if (expense.status === ExpenseStatus.POSTED) {
      throw HttpError.badRequest("Transaction is already posted.", "ALREADY_POSTED");
    }

    if (
      expense.status !== ExpenseStatus.PENDING &&
      expense.status !== ExpenseStatus.PENDING_APPROVAL
    ) {
      throw HttpError.badRequest(
        `Cannot approve expense with status '${expense.status}'. Only PENDING or PENDING_APPROVAL entries can be approved.`,
        "INVALID_TRANSACTION_STATUS",
      );
    }

    // Self-approval rule (always checked first)
    if (expense.createdById === actor.userId) {
      throw HttpError.badRequest(
        "Self-approval is not allowed. A different administrator or treasurer must approve your entry.",
        "SELF_APPROVAL_NOT_ALLOWED",
      );
    }

    // Over-limit expense role guard
    if (
      expense.status === ExpenseStatus.PENDING_APPROVAL &&
      actor.role !== Role.MOSQUE_ADMIN
    ) {
      throw HttpError.forbidden(
        "Over-limit expenses require MOSQUE_ADMIN role for approval. Treasurers cannot approve over-limit expenses.",
        "FORBIDDEN_ROLE",
      );
    }

    // Closed period check
    if (isDateInClosedPeriod(expense.date, mosque)) {
      throw HttpError.badRequest(
        "Cannot approve an expense recorded in a closed accounting period or previous fiscal year.",
        "PERIOD_CLOSED",
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Validate available balances in account and fund prior to posting
      const availableAccountBalance = await getAccountBalance(tx, expense.accountId);
      if (availableAccountBalance < expense.amount) {
        throw HttpError.badRequest(
          `Insufficient funds in account '${expense.account?.name}'. Available: ${availableAccountBalance} poisha, Requested: ${expense.amount} poisha.`,
          "INSUFFICIENT_ACCOUNT_BALANCE",
        );
      }

      const availableFundBalance = await getFundBalance(tx, expense.fundId);
      if (availableFundBalance < expense.amount) {
        throw HttpError.badRequest(
          `Insufficient balance in fund '${expense.fund?.name}'. Available: ${availableFundBalance} poisha, Requested: ${expense.amount} poisha.`,
          "INSUFFICIENT_FUND_BALANCE",
        );
      }

      let voucherNo = expense.voucherNo;
      if (!voucherNo) {
        voucherNo = await generateVoucherNumber(tx, resolvedMosqueId, expense.date);
      }

      const now = new Date();
      return tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.POSTED,
          voucherNo,
          approvedById: actor.userId,
          approvedAt: now,
          postedById: actor.userId,
          postedAt: now,
        },
        include: {
          account: { select: { id: true, name: true } },
          fund: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
          postedBy: { select: { id: true, name: true, email: true } },
        },
      });
    });

    return {
      id: updated.id,
      type: "EXPENSE",
      transactionNumber: updated.voucherNo,
      amount: updated.amount.toString(),
      date: updated.date,
      status: updated.status,
      party: updated.payee,
      accountId: updated.accountId,
      accountName: updated.account?.name,
      fundId: updated.fundId,
      fundName: updated.fund?.name,
      categoryId: updated.categoryId,
      categoryName: updated.category?.name,
      notes: updated.notes,
      attachments: updated.attachments,
      createdById: updated.createdById,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      history: buildExpenseHistory(updated),
    };
  }

  throw HttpError.notFound("Transaction record not found.", "TRANSACTION_NOT_FOUND");
}

export interface RejectTransactionResult {
  transaction: UnifiedTransactionItem;
  notification: {
    sent: boolean;
    recipientUserId: string | null;
    recipientName: string | null;
    recipientEmail: string | null;
    message: string;
  };
}

/**
 * POST /api/transactions/:id/reject
 * Rejects a pending donation or expense with a required reason.
 * Has no effect on balances, and notifies the creator.
 */
export async function rejectTransaction(
  mosqueId: string,
  id: string,
  input: RejectTransactionInput,
  actor: TransactionActor,
): Promise<RejectTransactionResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Operator role check
  const isOperator =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  if (!isOperator) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot reject transactions.`,
      "FORBIDDEN_ROLE",
    );
  }

  // 1. Check Donation
  const donation = await prisma.donation.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (donation) {
    if (donation.status === DonationStatus.POSTED) {
      throw HttpError.badRequest(
        "Cannot reject an already posted donation. Use void endpoint instead.",
        "CANNOT_REJECT_POSTED",
      );
    }

    if (donation.status === DonationStatus.REJECTED) {
      throw HttpError.badRequest("Donation has already been rejected.", "ALREADY_REJECTED");
    }

    if (donation.status !== DonationStatus.PENDING) {
      throw HttpError.badRequest(
        `Cannot reject donation with status '${donation.status}'. Only PENDING entries can be rejected.`,
        "INVALID_TRANSACTION_STATUS",
      );
    }

    const now = new Date();
    const updated = await prisma.donation.update({
      where: { id: donation.id },
      data: {
        status: DonationStatus.REJECTED,
        rejectionReason: input.reason,
        rejectedById: actor.userId,
        rejectedAt: now,
      },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        rejectedBy: { select: { id: true, name: true, email: true } },
      },
    });

    const notificationMessage = `Your donation entry for ${updated.amount} poisha was rejected: ${input.reason}`;
    console.log(
      `🔔 [NOTIFICATION DISPATCHED] To User: ${updated.createdBy?.email ?? updated.createdById} — ${notificationMessage}`,
    );

    return {
      transaction: {
        id: updated.id,
        type: "DONATION",
        transactionNumber: updated.receiptNumber,
        amount: updated.amount.toString(),
        date: updated.date,
        status: updated.status,
        party: updated.isAnonymousPublic ? "Anonymous" : updated.donorName || "Walk-in Donor",
        accountId: updated.accountId,
        accountName: updated.account?.name,
        fundId: updated.fundId,
        fundName: updated.fund?.name,
        categoryId: updated.categoryId,
        categoryName: updated.category?.name,
        notes: updated.notes,
        attachments: updated.attachments,
        rejectionReason: updated.rejectionReason,
        createdById: updated.createdById,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        history: buildDonationHistory(updated),
      },
      notification: {
        sent: true,
        recipientUserId: updated.createdById,
        recipientName: updated.createdBy?.name ?? null,
        recipientEmail: updated.createdBy?.email ?? null,
        message: notificationMessage,
      },
    };
  }

  // 2. Check Expense
  const expense = await prisma.expense.findFirst({
    where: { id, mosqueId: resolvedMosqueId },
    include: {
      account: { select: { id: true, name: true } },
      fund: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (expense) {
    if (expense.status === ExpenseStatus.POSTED) {
      throw HttpError.badRequest(
        "Cannot reject an already posted expense. Use void endpoint instead.",
        "CANNOT_REJECT_POSTED",
      );
    }

    if (expense.status === ExpenseStatus.REJECTED) {
      throw HttpError.badRequest("Expense has already been rejected.", "ALREADY_REJECTED");
    }

    if (
      expense.status !== ExpenseStatus.PENDING &&
      expense.status !== ExpenseStatus.PENDING_APPROVAL
    ) {
      throw HttpError.badRequest(
        `Cannot reject expense with status '${expense.status}'. Only PENDING or PENDING_APPROVAL entries can be rejected.`,
        "INVALID_TRANSACTION_STATUS",
      );
    }

    const now = new Date();
    const updated = await prisma.expense.update({
      where: { id: expense.id },
      data: {
        status: ExpenseStatus.REJECTED,
        rejectionReason: input.reason,
        rejectedById: actor.userId,
        rejectedAt: now,
      },
      include: {
        account: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        rejectedBy: { select: { id: true, name: true, email: true } },
      },
    });

    const notificationMessage = `Your expense entry to '${updated.payee}' for ${updated.amount} poisha was rejected: ${input.reason}`;
    console.log(
      `🔔 [NOTIFICATION DISPATCHED] To User: ${updated.createdBy?.email ?? updated.createdById} — ${notificationMessage}`,
    );

    return {
      transaction: {
        id: updated.id,
        type: "EXPENSE",
        transactionNumber: updated.voucherNo,
        amount: updated.amount.toString(),
        date: updated.date,
        status: updated.status,
        party: updated.payee,
        accountId: updated.accountId,
        accountName: updated.account?.name,
        fundId: updated.fundId,
        fundName: updated.fund?.name,
        categoryId: updated.categoryId,
        categoryName: updated.category?.name,
        notes: updated.notes,
        attachments: updated.attachments,
        rejectionReason: updated.rejectionReason,
        createdById: updated.createdById,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        history: buildExpenseHistory(updated),
      },
      notification: {
        sent: true,
        recipientUserId: updated.createdById,
        recipientName: updated.createdBy?.name ?? null,
        recipientEmail: updated.createdBy?.email ?? null,
        message: notificationMessage,
      },
    };
  }

  throw HttpError.notFound("Transaction record not found.", "TRANSACTION_NOT_FOUND");
}
