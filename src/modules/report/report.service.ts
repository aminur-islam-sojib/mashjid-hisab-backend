// =============================================================================
// report.service.ts — Business Logic for Domain 10: Reports & Period Control
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  DonationStatus,
  ExpenseStatus,
  TransferStatus,
  TransferLeg,
  CollectionStatus,
  FundType,
  CategoryType,
  DonationSource,
  PeriodAction,
  ReportType,
  ExportFormat,
  ExportStatus,
  AuditAction,
  AuditEntity,
} from "../../../generated/prisma/client.js";
import { isDateInClosedPeriod } from "../donation/donation.service.js";
import { recordAuditLog } from "../audit/audit.service.js";
import type {
  BalancesReportQueryInput,
  IncomeExpenseReportQueryInput,
  FundStatementQueryInput,
  AccountStatementQueryInput,
  DonorsReportQueryInput,
  CreateReportExportInput,
  AccountReconciliationInput,
} from "./report.validation.js";

/**
 * Converts integer poisha (minor units) to formatted decimal currency string.
 * e.g. 10050n -> "100.50", -5000n -> "-50.00"
 */
export function formatPoishaToCurrency(poisha: bigint): string {
  const isNegative = poisha < 0n;
  const abs = isNegative ? -poisha : poisha;
  const major = abs / 100n;
  const minor = abs % 100n;
  const minorStr = minor < 10n ? `0${minor}` : `${minor}`;
  return `${isNegative ? "-" : ""}${major}.${minorStr}`;
}

// =============================================================================
// 1. GET /reports/dashboard
// =============================================================================

export async function getDashboardReport(mosqueId: string) {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // 1. Current Balances (Accounts & Funds)
  const [accounts, funds] = await Promise.all([
    prisma.account.findMany({
      where: { mosqueId, isArchived: false },
      select: { id: true, name: true, type: true, openingBalance: true },
    }),
    prisma.fund.findMany({
      where: { mosqueId, isArchived: false },
      select: { id: true, name: true, type: true, isRestricted: true },
    }),
  ]);

  let totalAccountsBalance = 0n;
  const accountsSummary = await Promise.all(
    accounts.map(async (acc) => {
      const [donations, expenses, transferIn, transferOut] = await Promise.all([
        prisma.donation.aggregate({
          where: {
            accountId: acc.id,
            OR: [
              { status: DonationStatus.POSTED },
              { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: {
            accountId: acc.id,
            OR: [
              { status: ExpenseStatus.POSTED },
              { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            accountId: acc.id,
            leg: TransferLeg.TO,
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            accountId: acc.id,
            leg: TransferLeg.FROM,
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
      ]);

      const balance =
        acc.openingBalance +
        (donations._sum.amount ?? 0n) -
        (expenses._sum.amount ?? 0n) +
        (transferIn._sum.amount ?? 0n) -
        (transferOut._sum.amount ?? 0n);

      totalAccountsBalance += balance;

      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        balance: balance.toString(),
        formattedBalance: formatPoishaToCurrency(balance),
      };
    }),
  );

  let totalFundsBalance = 0n;
  const fundsSummary = await Promise.all(
    funds.map(async (f) => {
      const [donations, expenses, transferIn, transferOut] = await Promise.all([
        prisma.donation.aggregate({
          where: {
            fundId: f.id,
            OR: [
              { status: DonationStatus.POSTED },
              { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: {
            fundId: f.id,
            OR: [
              { status: ExpenseStatus.POSTED },
              { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            fundId: f.id,
            leg: TransferLeg.TO,
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            fundId: f.id,
            leg: TransferLeg.FROM,
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
      ]);

      const balance =
        (donations._sum.amount ?? 0n) -
        (expenses._sum.amount ?? 0n) +
        (transferIn._sum.amount ?? 0n) -
        (transferOut._sum.amount ?? 0n);

      totalFundsBalance += balance;

      return {
        id: f.id,
        name: f.name,
        type: f.type,
        isRestricted: f.isRestricted,
        balance: balance.toString(),
        formattedBalance: formatPoishaToCurrency(balance),
      };
    }),
  );

  // 2. This Month's Income & Expense
  const [monthIncomeAgg, monthExpenseAgg] = await Promise.all([
    prisma.donation.aggregate({
      where: {
        mosqueId,
        status: DonationStatus.POSTED,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        mosqueId,
        status: ExpenseStatus.POSTED,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    }),
  ]);

  const monthIncome = monthIncomeAgg._sum.amount ?? 0n;
  const monthExpense = monthExpenseAgg._sum.amount ?? 0n;
  const monthNet = monthIncome - monthExpense;

  // 3. Pending Approvals
  const [pendingDonations, pendingExpenses, openCollections] = await Promise.all([
    prisma.donation.count({
      where: { mosqueId, status: DonationStatus.PENDING },
    }),
    prisma.expense.count({
      where: {
        mosqueId,
        status: { in: [ExpenseStatus.PENDING, ExpenseStatus.PENDING_APPROVAL] },
      },
    }),
    prisma.collectionSession.count({
      where: { mosqueId, status: CollectionStatus.OPEN },
    }),
  ]);

  // 4. Dues Collection Rate (for current month)
  const currentMonthDues = await prisma.due.findMany({
    where: { mosqueId, period: currentPeriod },
    select: { amount: true, paidAmount: true, status: true },
  });

  let duesExpected = 0n;
  let duesCollected = 0n;
  const dueStatusCounts = { UNPAID: 0, PARTIAL: 0, PAID: 0, WAIVED: 0, TOTAL: currentMonthDues.length };

  for (const d of currentMonthDues) {
    duesExpected += d.amount;
    duesCollected += d.paidAmount;
    if (d.status in dueStatusCounts) {
      dueStatusCounts[d.status as keyof typeof dueStatusCounts]++;
    }
  }

  const duesCollectionRate =
    duesExpected > 0n
      ? Number((duesCollected * 10000n) / duesExpected) / 100
      : 0;

  return {
    asOf: now,
    currentPeriod,
    balances: {
      totalAccounts: totalAccountsBalance.toString(),
      formattedTotalAccounts: formatPoishaToCurrency(totalAccountsBalance),
      totalFunds: totalFundsBalance.toString(),
      formattedTotalFunds: formatPoishaToCurrency(totalFundsBalance),
      accounts: accountsSummary,
      funds: fundsSummary,
    },
    thisMonth: {
      period: currentPeriod,
      startDate: startOfMonth,
      endDate: endOfMonth,
      income: monthIncome.toString(),
      formattedIncome: formatPoishaToCurrency(monthIncome),
      expense: monthExpense.toString(),
      formattedExpense: formatPoishaToCurrency(monthExpense),
      netSurplus: monthNet.toString(),
      formattedNetSurplus: formatPoishaToCurrency(monthNet),
    },
    pendingApprovals: {
      pendingDonations,
      pendingExpenses,
      openCollections,
      totalPending: pendingDonations + pendingExpenses + openCollections,
    },
    duesCollection: {
      period: currentPeriod,
      totalExpected: duesExpected.toString(),
      formattedTotalExpected: formatPoishaToCurrency(duesExpected),
      totalCollected: duesCollected.toString(),
      formattedTotalCollected: formatPoishaToCurrency(duesCollected),
      collectionRatePercentage: duesCollectionRate,
      counts: dueStatusCounts,
    },
  };
}

function toStartDate(val: unknown, fallback?: Date): Date {
  if (val instanceof Date) return val;
  if (typeof val === "string" && val.trim()) {
    const s = val.trim();
    return new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  }
  return fallback ?? new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

function toEndDate(val: unknown, fallback?: Date): Date {
  if (val instanceof Date) return val;
  if (typeof val === "string" && val.trim()) {
    const s = val.trim();
    return new Date(s.length === 10 ? `${s}T23:59:59.999Z` : s);
  }
  return fallback ?? new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31, 23, 59, 59, 999));
}

function toAsOfDate(val: unknown, fallback?: Date): Date {
  if (val instanceof Date) return val;
  if (typeof val === "string" && val.trim()) {
    const s = val.trim();
    return new Date(s.length === 10 ? `${s}T23:59:59.999Z` : s);
  }
  return fallback ?? new Date();
}

// =============================================================================
// 2. GET /reports/balances?asOf=
// =============================================================================

export async function getBalancesReport(mosqueId: string, query: BalancesReportQueryInput) {
  const cutoffDate = toAsOfDate(query.asOf);

  const [accounts, funds] = await Promise.all([
    prisma.account.findMany({
      where: { mosqueId, isArchived: false },
      select: { id: true, name: true, type: true, accountNumber: true, openingBalance: true },
      orderBy: { name: "asc" },
    }),
    prisma.fund.findMany({
      where: { mosqueId, isArchived: false },
      select: { id: true, name: true, type: true, isRestricted: true },
      orderBy: { name: "asc" },
    }),
  ]);

  let totalAccountsBalance = 0n;
  const accountsBalances = await Promise.all(
    accounts.map(async (acc) => {
      const [donations, expenses, transferIn, transferOut] = await Promise.all([
        prisma.donation.aggregate({
          where: {
            accountId: acc.id,
            date: { lte: cutoffDate },
            OR: [
              { status: DonationStatus.POSTED },
              { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: {
            accountId: acc.id,
            date: { lte: cutoffDate },
            OR: [
              { status: ExpenseStatus.POSTED },
              { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            accountId: acc.id,
            leg: TransferLeg.TO,
            date: { lte: cutoffDate },
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            accountId: acc.id,
            leg: TransferLeg.FROM,
            date: { lte: cutoffDate },
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
      ]);

      const balance =
        acc.openingBalance +
        (donations._sum.amount ?? 0n) -
        (expenses._sum.amount ?? 0n) +
        (transferIn._sum.amount ?? 0n) -
        (transferOut._sum.amount ?? 0n);

      totalAccountsBalance += balance;

      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        accountNumber: acc.accountNumber,
        openingBalance: acc.openingBalance.toString(),
        formattedOpeningBalance: formatPoishaToCurrency(acc.openingBalance),
        balance: balance.toString(),
        currentBalance: balance.toString(),
        formattedBalance: formatPoishaToCurrency(balance),
        formattedCurrentBalance: formatPoishaToCurrency(balance),
      };
    }),
  );

  let totalFundsBalance = 0n;
  const fundsBalances = await Promise.all(
    funds.map(async (f) => {
      const [donations, expenses, transferIn, transferOut] = await Promise.all([
        prisma.donation.aggregate({
          where: {
            fundId: f.id,
            date: { lte: cutoffDate },
            OR: [
              { status: DonationStatus.POSTED },
              { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: {
            fundId: f.id,
            date: { lte: cutoffDate },
            OR: [
              { status: ExpenseStatus.POSTED },
              { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            fundId: f.id,
            leg: TransferLeg.TO,
            date: { lte: cutoffDate },
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
        prisma.transfer.aggregate({
          where: {
            fundId: f.id,
            leg: TransferLeg.FROM,
            date: { lte: cutoffDate },
            OR: [
              { status: TransferStatus.POSTED },
              { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
            ],
          },
          _sum: { amount: true },
        }),
      ]);

      const balance =
        (donations._sum.amount ?? 0n) -
        (expenses._sum.amount ?? 0n) +
        (transferIn._sum.amount ?? 0n) -
        (transferOut._sum.amount ?? 0n);

      totalFundsBalance += balance;

      return {
        id: f.id,
        name: f.name,
        type: f.type,
        isRestricted: f.isRestricted,
        balance: balance.toString(),
        currentBalance: balance.toString(),
        formattedBalance: formatPoishaToCurrency(balance),
        formattedCurrentBalance: formatPoishaToCurrency(balance),
      };
    }),
  );

  return {
    asOf: cutoffDate,
    accounts: accountsBalances,
    totalAccountsBalance: totalAccountsBalance.toString(),
    totalAccountBalance: totalAccountsBalance.toString(),
    formattedTotalAccountsBalance: formatPoishaToCurrency(totalAccountsBalance),
    formattedTotalAccountBalance: formatPoishaToCurrency(totalAccountsBalance),
    funds: fundsBalances,
    totalFundsBalance: totalFundsBalance.toString(),
    totalFundBalance: totalFundsBalance.toString(),
    formattedTotalFundsBalance: formatPoishaToCurrency(totalFundsBalance),
    formattedTotalFundBalance: formatPoishaToCurrency(totalFundsBalance),
  };
}

// =============================================================================
// 3. GET /reports/income-expense
// =============================================================================

export async function getIncomeExpenseReport(
  mosqueId: string,
  query: IncomeExpenseReportQueryInput,
) {
  const startDate = toStartDate(query.startDate);
  const endDate = toEndDate(query.endDate);
  const groupBy = query.groupBy ?? "month";

  const donationWhere: any = {
    mosqueId,
    status: DonationStatus.POSTED,
    date: { gte: startDate, lte: endDate },
    ...(query.fundId ? { fundId: query.fundId } : {}),
  };

  const expenseWhere: any = {
    mosqueId,
    status: ExpenseStatus.POSTED,
    date: { gte: startDate, lte: endDate },
    ...(query.fundId ? { fundId: query.fundId } : {}),
  };

  const [donations, expenses] = await Promise.all([
    prisma.donation.findMany({
      where: donationWhere,
      select: {
        id: true,
        amount: true,
        date: true,
        fundId: true,
        categoryId: true,
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, type: true } },
      },
    }),
    prisma.expense.findMany({
      where: expenseWhere,
      select: {
        id: true,
        amount: true,
        date: true,
        fundId: true,
        categoryId: true,
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, type: true } },
      },
    }),
  ]);

  let totalIncome = 0n;
  for (const d of donations) {
    totalIncome += d.amount;
  }

  let totalExpense = 0n;
  for (const e of expenses) {
    totalExpense += e.amount;
  }

  const netSurplus = totalIncome - totalExpense;

  if (groupBy === "fund") {
    const fundMap = new Map<string, { fund: any; income: bigint; expense: bigint }>();

    for (const d of donations) {
      const existing = fundMap.get(d.fundId) ?? { fund: d.fund, income: 0n, expense: 0n };
      existing.income += d.amount;
      fundMap.set(d.fundId, existing);
    }

    for (const e of expenses) {
      const existing = fundMap.get(e.fundId) ?? { fund: e.fund, income: 0n, expense: 0n };
      existing.expense += e.amount;
      fundMap.set(e.fundId, existing);
    }

    const fundsList = Array.from(fundMap.values()).map(({ fund, income, expense }) => {
      const net = income - expense;
      return {
        fundId: fund.id,
        fundName: fund.name,
        name: fund.name,
        label: fund.name,
        fundType: fund.type,
        income: income.toString(),
        formattedIncome: formatPoishaToCurrency(income),
        expense: expense.toString(),
        formattedExpense: formatPoishaToCurrency(expense),
        net: net.toString(),
        formattedNet: formatPoishaToCurrency(net),
      };
    });

    return {
      period: { startDate, endDate },
      groupBy: "fund",
      totalIncome: totalIncome.toString(),
      formattedTotalIncome: formatPoishaToCurrency(totalIncome),
      totalExpense: totalExpense.toString(),
      totalExpenses: totalExpense.toString(),
      formattedTotalExpense: formatPoishaToCurrency(totalExpense),
      formattedTotalExpenses: formatPoishaToCurrency(totalExpense),
      netSurplus: netSurplus.toString(),
      netSavings: netSurplus.toString(),
      formattedNetSurplus: formatPoishaToCurrency(netSurplus),
      formattedNetSavings: formatPoishaToCurrency(netSurplus),
      data: fundsList,
      breakdown: fundsList,
      items: fundsList,
    };
  }

  if (groupBy === "category") {
    const incomeCatMap = new Map<string, { category: any; amount: bigint; count: number }>();
    for (const d of donations) {
      const existing = incomeCatMap.get(d.categoryId) ?? { category: d.category, amount: 0n, count: 0 };
      existing.amount += d.amount;
      existing.count++;
      incomeCatMap.set(d.categoryId, existing);
    }

    const expenseCatMap = new Map<string, { category: any; amount: bigint; count: number }>();
    for (const e of expenses) {
      const existing = expenseCatMap.get(e.categoryId) ?? { category: e.category, amount: 0n, count: 0 };
      existing.amount += e.amount;
      existing.count++;
      expenseCatMap.set(e.categoryId, existing);
    }

    const incomeCategories = Array.from(incomeCatMap.values()).map(({ category, amount, count }) => ({
      categoryId: category.id,
      categoryName: category.name,
      name: category.name,
      label: category.name,
      type: "INCOME",
      amount: amount.toString(),
      formattedAmount: formatPoishaToCurrency(amount),
      income: amount.toString(),
      expense: "0",
      count,
    }));

    const expenseCategories = Array.from(expenseCatMap.values()).map(({ category, amount, count }) => ({
      categoryId: category.id,
      categoryName: category.name,
      name: category.name,
      label: category.name,
      type: "EXPENSE",
      amount: amount.toString(),
      formattedAmount: formatPoishaToCurrency(amount),
      income: "0",
      expense: amount.toString(),
      count,
    }));

    const combinedBreakdown = [...incomeCategories, ...expenseCategories];

    return {
      period: { startDate, endDate },
      groupBy: "category",
      totalIncome: totalIncome.toString(),
      formattedTotalIncome: formatPoishaToCurrency(totalIncome),
      totalExpense: totalExpense.toString(),
      totalExpenses: totalExpense.toString(),
      formattedTotalExpense: formatPoishaToCurrency(totalExpense),
      formattedTotalExpenses: formatPoishaToCurrency(totalExpense),
      netSurplus: netSurplus.toString(),
      netSavings: netSurplus.toString(),
      formattedNetSurplus: formatPoishaToCurrency(netSurplus),
      formattedNetSavings: formatPoishaToCurrency(netSurplus),
      incomeCategories,
      expenseCategories,
      data: combinedBreakdown,
      breakdown: combinedBreakdown,
      items: combinedBreakdown,
    };
  }

  // Default: Group by Month (YYYY-MM)
  const monthMap = new Map<string, { income: bigint; expense: bigint }>();

  for (const d of donations) {
    const ym = `${d.date.getUTCFullYear()}-${String(d.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = monthMap.get(ym) ?? { income: 0n, expense: 0n };
    existing.income += d.amount;
    monthMap.set(ym, existing);
  }

  for (const e of expenses) {
    const ym = `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = monthMap.get(ym) ?? { income: 0n, expense: 0n };
    existing.expense += e.amount;
    monthMap.set(ym, existing);
  }

  const sortedMonths = Array.from(monthMap.keys()).sort();
  const monthlyData = sortedMonths.map((month) => {
    const { income, expense } = monthMap.get(month)!;
    const net = income - expense;
    return {
      month,
      name: month,
      label: month,
      income: income.toString(),
      formattedIncome: formatPoishaToCurrency(income),
      expense: expense.toString(),
      formattedExpense: formatPoishaToCurrency(expense),
      net: net.toString(),
      formattedNet: formatPoishaToCurrency(net),
    };
  });

  return {
    period: { startDate, endDate },
    groupBy: "month",
    totalIncome: totalIncome.toString(),
    formattedTotalIncome: formatPoishaToCurrency(totalIncome),
    totalExpense: totalExpense.toString(),
    totalExpenses: totalExpense.toString(),
    formattedTotalExpense: formatPoishaToCurrency(totalExpense),
    formattedTotalExpenses: formatPoishaToCurrency(totalExpense),
    netSurplus: netSurplus.toString(),
    netSavings: netSurplus.toString(),
    formattedNetSurplus: formatPoishaToCurrency(netSurplus),
    formattedNetSavings: formatPoishaToCurrency(netSurplus),
    data: monthlyData,
    breakdown: monthlyData,
    items: monthlyData,
  };
}

// =============================================================================
// 4. GET /reports/funds/:fundId/statement
// =============================================================================

export async function getFundStatement(
  mosqueId: string,
  fundId: string,
  query: FundStatementQueryInput,
) {
  const fund = await prisma.fund.findFirst({
    where: { id: fundId, mosqueId },
  });

  if (!fund) {
    throw HttpError.notFound("Fund not found.", "FUND_NOT_FOUND");
  }

  const now = new Date();
  const startDate = query.startDate ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endDate = query.endDate ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  // 1. Opening Balance (all activity strictly prior to startDate)
  const [priorDonations, priorExpenses, priorTransfersIn, priorTransfersOut] = await Promise.all([
    prisma.donation.aggregate({
      where: {
        fundId,
        date: { lt: startDate },
        OR: [
          { status: DonationStatus.POSTED },
          { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        fundId,
        date: { lt: startDate },
        OR: [
          { status: ExpenseStatus.POSTED },
          { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        fundId,
        leg: TransferLeg.TO,
        date: { lt: startDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        fundId,
        leg: TransferLeg.FROM,
        date: { lt: startDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  const openingBalance =
    (priorDonations._sum.amount ?? 0n) -
    (priorExpenses._sum.amount ?? 0n) +
    (priorTransfersIn._sum.amount ?? 0n) -
    (priorTransfersOut._sum.amount ?? 0n);

  // 2. Inflows during the period
  const [donationsInPeriod, transfersInPeriod] = await Promise.all([
    prisma.donation.findMany({
      where: {
        fundId,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        receiptNumber: true,
        source: true,
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.transfer.aggregate({
      where: {
        fundId,
        leg: TransferLeg.TO,
        status: TransferStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
  ]);

  let totalDonations = 0n;
  for (const d of donationsInPeriod) {
    totalDonations += d.amount;
  }
  const totalTransfersIn = transfersInPeriod._sum.amount ?? 0n;
  const totalInflow = totalDonations + totalTransfersIn;

  // 3. Outflows during the period
  const [expensesInPeriod, transfersOutPeriod] = await Promise.all([
    prisma.expense.findMany({
      where: {
        fundId,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        voucherNo: true,
        payee: true,
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.transfer.aggregate({
      where: {
        fundId,
        leg: TransferLeg.FROM,
        status: TransferStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
  ]);

  let totalExpenses = 0n;
  for (const e of expensesInPeriod) {
    totalExpenses += e.amount;
  }
  const totalTransfersOut = transfersOutPeriod._sum.amount ?? 0n;
  const totalOutflow = totalExpenses + totalTransfersOut;

  // 4. Closing Balance
  const closingBalance = openingBalance + totalInflow - totalOutflow;

  return {
    fund: {
      id: fund.id,
      name: fund.name,
      type: fund.type,
      isRestricted: fund.isRestricted,
      description: fund.description,
    },
    period: { startDate, endDate },
    openingBalance: openingBalance.toString(),
    formattedOpeningBalance: formatPoishaToCurrency(openingBalance),
    inflows: {
      totalDonations: totalDonations.toString(),
      formattedTotalDonations: formatPoishaToCurrency(totalDonations),
      totalTransfersIn: totalTransfersIn.toString(),
      formattedTotalTransfersIn: formatPoishaToCurrency(totalTransfersIn),
      totalInflow: totalInflow.toString(),
      formattedTotalInflow: formatPoishaToCurrency(totalInflow),
      donationCount: donationsInPeriod.length,
    },
    outflows: {
      totalExpenses: totalExpenses.toString(),
      formattedTotalExpenses: formatPoishaToCurrency(totalExpenses),
      totalTransfersOut: totalTransfersOut.toString(),
      formattedTotalTransfersOut: formatPoishaToCurrency(totalTransfersOut),
      totalOutflow: totalOutflow.toString(),
      formattedTotalOutflow: formatPoishaToCurrency(totalOutflow),
      expenseCount: expensesInPeriod.length,
    },
    closingBalance: closingBalance.toString(),
    formattedClosingBalance: formatPoishaToCurrency(closingBalance),
  };
}

// =============================================================================
// 5. GET /reports/accounts/:accountId/statement
// =============================================================================

export async function getAccountStatement(
  mosqueId: string,
  accountId: string,
  query: AccountStatementQueryInput,
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, mosqueId },
  });

  if (!account) {
    throw HttpError.notFound("Account not found.", "ACCOUNT_NOT_FOUND");
  }

  const now = new Date();
  const startDate = query.startDate ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endDate = query.endDate ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const page = query.page ?? 1;
  const limit = query.limit ?? 100;

  // 1. Opening Balance prior to startDate
  const [priorDonations, priorExpenses, priorTransfersIn, priorTransfersOut] = await Promise.all([
    prisma.donation.aggregate({
      where: {
        accountId,
        date: { lt: startDate },
        OR: [
          { status: DonationStatus.POSTED },
          { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        accountId,
        date: { lt: startDate },
        OR: [
          { status: ExpenseStatus.POSTED },
          { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        accountId,
        leg: TransferLeg.TO,
        date: { lt: startDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        accountId,
        leg: TransferLeg.FROM,
        date: { lt: startDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  const openingBalance =
    account.openingBalance +
    (priorDonations._sum.amount ?? 0n) -
    (priorExpenses._sum.amount ?? 0n) +
    (priorTransfersIn._sum.amount ?? 0n) -
    (priorTransfersOut._sum.amount ?? 0n);

  // 2. Transactions during the period
  const [donations, expenses, transfers] = await Promise.all([
    prisma.donation.findMany({
      where: {
        accountId,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        receiptNumber: true,
        notes: true,
        donorName: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        accountId,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        voucherNo: true,
        payee: true,
        notes: true,
      },
    }),
    prisma.transfer.findMany({
      where: {
        accountId,
        status: TransferStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        leg: true,
        notes: true,
        transferNumber: true,
      },
    }),
  ]);

  // Combine & Sort Chronologically
  type StatementEntry = {
    id: string;
    date: Date;
    createdAt: Date;
    type: "INCOME" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT";
    reference: string;
    description: string;
    inflow: bigint;
    outflow: bigint;
    runningBalance: bigint;
  };

  const allEntries: StatementEntry[] = [];

  for (const d of donations) {
    allEntries.push({
      id: d.id,
      date: d.date,
      createdAt: d.createdAt,
      type: "INCOME",
      reference: d.receiptNumber ?? "DONATION",
      description: d.notes ?? (d.donorName ? `Donation from ${d.donorName}` : "Donation"),
      inflow: d.amount,
      outflow: 0n,
      runningBalance: 0n,
    });
  }

  for (const e of expenses) {
    allEntries.push({
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      type: "EXPENSE",
      reference: e.voucherNo ?? "EXPENSE",
      description: e.notes ?? `Payment to ${e.payee}`,
      inflow: 0n,
      outflow: e.amount,
      runningBalance: 0n,
    });
  }

  for (const t of transfers) {
    if (t.leg === TransferLeg.TO) {
      allEntries.push({
        id: t.id,
        date: t.date,
        createdAt: t.createdAt,
        type: "TRANSFER_IN",
        reference: t.transferNumber ?? "TRANSFER",
        description: t.notes ?? "Transfer In",
        inflow: t.amount,
        outflow: 0n,
        runningBalance: 0n,
      });
    } else {
      allEntries.push({
        id: t.id,
        date: t.date,
        createdAt: t.createdAt,
        type: "TRANSFER_OUT",
        reference: t.transferNumber ?? "TRANSFER",
        description: t.notes ?? "Transfer Out",
        inflow: 0n,
        outflow: t.amount,
        runningBalance: 0n,
      });
    }
  }

  allEntries.sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    if (diff !== 0) return diff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let running = openingBalance;
  let totalInflow = 0n;
  let totalOutflow = 0n;

  for (const entry of allEntries) {
    running = running + entry.inflow - entry.outflow;
    entry.runningBalance = running;
    totalInflow += entry.inflow;
    totalOutflow += entry.outflow;
  }

  const closingBalance = running;

  // Pagination
  const totalCount = allEntries.length;
  const startIndex = (page - 1) * limit;
  const paginatedEntries = allEntries.slice(startIndex, startIndex + limit).map((entry) => ({
    id: entry.id,
    date: entry.date,
    type: entry.type,
    reference: entry.reference,
    description: entry.description,
    inflow: entry.inflow.toString(),
    formattedInflow: formatPoishaToCurrency(entry.inflow),
    outflow: entry.outflow.toString(),
    formattedOutflow: formatPoishaToCurrency(entry.outflow),
    runningBalance: entry.runningBalance.toString(),
    formattedRunningBalance: formatPoishaToCurrency(entry.runningBalance),
  }));

  return {
    account: {
      id: account.id,
      name: account.name,
      type: account.type,
      accountNumber: account.accountNumber,
    },
    period: { startDate, endDate },
    openingBalance: openingBalance.toString(),
    formattedOpeningBalance: formatPoishaToCurrency(openingBalance),
    closingBalance: closingBalance.toString(),
    formattedClosingBalance: formatPoishaToCurrency(closingBalance),
    totalInflow: totalInflow.toString(),
    formattedTotalInflow: formatPoishaToCurrency(totalInflow),
    totalOutflow: totalOutflow.toString(),
    formattedTotalOutflow: formatPoishaToCurrency(totalOutflow),
    transactions: paginatedEntries,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
  };
}

// =============================================================================
// 6. GET /reports/donors
// =============================================================================

export async function getDonorsReport(
  mosqueId: string,
  query: DonorsReportQueryInput,
) {
  const groupBy = query.groupBy ?? "member";
  const limit = query.limit ?? 50;

  const startDate = query.startDate ? toStartDate(query.startDate) : undefined;
  const endDate = query.endDate ? toEndDate(query.endDate) : undefined;

  const whereDonation: any = {
    mosqueId,
    status: DonationStatus.POSTED,
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
        }
      : {}),
  };

  const donations = await prisma.donation.findMany({
    where: whereDonation,
    select: {
      id: true,
      amount: true,
      date: true,
      memberId: true,
      familyId: true,
      donorName: true,
      donorPhone: true,
      donorEmail: true,
      member: {
        select: {
          id: true,
          user: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
      family: {
        select: {
          id: true,
          name: true,
          headMembership: {
            select: {
              id: true,
              user: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      },
    },
  });

  if (groupBy === "family") {
    const familyMap = new Map<
      string,
      {
        familyId: string;
        familyName: string;
        headName: string;
        totalGiven: bigint;
        donationCount: number;
        lastDonatedAt: Date;
      }
    >();

    for (const d of donations) {
      const familyId = d.familyId ?? "UNASSIGNED";
      const familyName = d.family?.name ?? (d.familyId ? "Unknown Family" : "Individual / Unassigned");
      const headName = d.family?.headMembership?.user?.name ?? "N/A";

      const existing = familyMap.get(familyId) ?? {
        familyId,
        familyName,
        headName,
        totalGiven: 0n,
        donationCount: 0,
        lastDonatedAt: d.date,
      };

      existing.totalGiven += d.amount;
      existing.donationCount++;
      if (d.date > existing.lastDonatedAt) {
        existing.lastDonatedAt = d.date;
      }

      familyMap.set(familyId, existing);
    }

    const familyList = Array.from(familyMap.values()).sort((a, b) => {
      if (b.totalGiven !== a.totalGiven) {
        return b.totalGiven > a.totalGiven ? 1 : -1;
      }
      return b.donationCount - a.donationCount;
    });

    const topDonors = familyList.slice(0, limit).map((f) => ({
      ...f,
      name: f.familyName,
      totalGiven: f.totalGiven.toString(),
      totalAmount: f.totalGiven.toString(),
      count: f.donationCount,
      donationCount: f.donationCount,
      formattedTotalGiven: formatPoishaToCurrency(f.totalGiven),
    }));

    return {
      groupBy: "family",
      count: familyList.length,
      donors: topDonors,
      topDonors,
      data: topDonors,
    };
  }

  // Default: Group by Member / Individual Donor
  const donorMap = new Map<
    string,
    {
      donorId: string;
      memberId: string | null;
      name: string;
      phone: string | null;
      email: string | null;
      totalGiven: bigint;
      donationCount: number;
      lastDonatedAt: Date;
    }
  >();

  for (const d of donations) {
    const donorId = d.memberId ? `member_${d.memberId}` : `phone_${d.donorPhone || d.donorName || d.id}`;
    const name = d.member?.user?.name ?? d.donorName ?? "Anonymous Donor";
    const phone = d.member?.user?.phone ?? d.donorPhone ?? null;
    const email = d.member?.user?.email ?? d.donorEmail ?? null;

    const existing = donorMap.get(donorId) ?? {
      donorId,
      memberId: d.memberId,
      name,
      phone,
      email,
      totalGiven: 0n,
      donationCount: 0,
      lastDonatedAt: d.date,
    };

    existing.totalGiven += d.amount;
    existing.donationCount++;
    if (d.date > existing.lastDonatedAt) {
      existing.lastDonatedAt = d.date;
    }

    donorMap.set(donorId, existing);
  }

  const allDonors = Array.from(donorMap.values()).sort((a, b) => {
    if (b.totalGiven !== a.totalGiven) {
      return b.totalGiven > a.totalGiven ? 1 : -1;
    }
    return b.donationCount - a.donationCount;
  });

  // Calculate Lapsed Donors (members with zero donations in last 60 days, but gave before)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const lapsedDonors = allDonors.filter((d) => d.lastDonatedAt < sixtyDaysAgo).map((d) => ({
    ...d,
    totalGiven: d.totalGiven.toString(),
    totalAmount: d.totalGiven.toString(),
    count: d.donationCount,
    donationCount: d.donationCount,
    formattedTotalGiven: formatPoishaToCurrency(d.totalGiven),
  }));

  const topDonors = allDonors.slice(0, limit).map((d) => ({
    ...d,
    totalGiven: d.totalGiven.toString(),
    totalAmount: d.totalGiven.toString(),
    count: d.donationCount,
    donationCount: d.donationCount,
    formattedTotalGiven: formatPoishaToCurrency(d.totalGiven),
  }));

  let totalGiving = 0n;
  for (const d of allDonors) {
    totalGiving += d.totalGiven;
  }

  return {
    groupBy: "member",
    totalDonorsCount: allDonors.length,
    totalDonationsCount: donations.length,
    totalGiving: totalGiving.toString(),
    formattedTotalGiving: formatPoishaToCurrency(totalGiving),
    topDonors,
    donors: topDonors,
    data: topDonors,
    lapsedDonors: lapsedDonors.slice(0, limit),
  };
}

// =============================================================================
// 7. GET /reports/fiscal-year/:year
// =============================================================================

export async function getFiscalYearReport(mosqueId: string, fiscalYear: number) {
  const mosque = await prisma.mosque.findUnique({
    where: { id: mosqueId },
    select: { id: true, name: true, fiscalYearStart: true },
  });

  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  const fyStartMonth = mosque.fiscalYearStart || 7; // e.g. 7 for July
  const startDate = new Date(Date.UTC(fiscalYear, fyStartMonth - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(fiscalYear + 1, fyStartMonth - 1, 0, 23, 59, 59, 999));

  // 1. Opening Balance at the start of the fiscal year
  const accounts = await prisma.account.findMany({
    where: { mosqueId, isArchived: false },
    select: { id: true, openingBalance: true },
  });

  let openingBalance = 0n;
  for (const acc of accounts) {
    const [donations, expenses, transferIn, transferOut] = await Promise.all([
      prisma.donation.aggregate({
        where: {
          accountId: acc.id,
          date: { lt: startDate },
          OR: [
            { status: DonationStatus.POSTED },
            { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
          ],
        },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          accountId: acc.id,
          date: { lt: startDate },
          OR: [
            { status: ExpenseStatus.POSTED },
            { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
          ],
        },
        _sum: { amount: true },
      }),
      prisma.transfer.aggregate({
        where: {
          accountId: acc.id,
          leg: TransferLeg.TO,
          date: { lt: startDate },
          OR: [
            { status: TransferStatus.POSTED },
            { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
          ],
        },
        _sum: { amount: true },
      }),
      prisma.transfer.aggregate({
        where: {
          accountId: acc.id,
          leg: TransferLeg.FROM,
          date: { lt: startDate },
          OR: [
            { status: TransferStatus.POSTED },
            { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
          ],
        },
        _sum: { amount: true },
      }),
    ]);

    openingBalance +=
      acc.openingBalance +
      (donations._sum.amount ?? 0n) -
      (expenses._sum.amount ?? 0n) +
      (transferIn._sum.amount ?? 0n) -
      (transferOut._sum.amount ?? 0n);
  }

  // 2. Fiscal Year Activity
  const [donations, expenses] = await Promise.all([
    prisma.donation.findMany({
      where: {
        mosqueId,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        mosqueId,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true } },
      },
    }),
  ]);

  let totalIncome = 0n;
  for (const d of donations) {
    totalIncome += d.amount;
  }

  let totalExpense = 0n;
  for (const e of expenses) {
    totalExpense += e.amount;
  }

  const netSurplus = totalIncome - totalExpense;
  const closingBalance = openingBalance + netSurplus;

  // Monthly breakdown (all 12 months)
  const monthlyBreakdown: { month: string; income: string; formattedIncome: string; expense: string; formattedExpense: string; net: string; formattedNet: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(Date.UTC(fiscalYear, fyStartMonth - 1 + m, 1));
    const ym = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;

    let mIncome = 0n;
    for (const d of donations) {
      const dYm = `${d.date.getUTCFullYear()}-${String(d.date.getUTCMonth() + 1).padStart(2, "0")}`;
      if (dYm === ym) mIncome += d.amount;
    }

    let mExpense = 0n;
    for (const e of expenses) {
      const eYm = `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, "0")}`;
      if (eYm === ym) mExpense += e.amount;
    }

    const mNet = mIncome - mExpense;
    monthlyBreakdown.push({
      month: ym,
      income: mIncome.toString(),
      formattedIncome: formatPoishaToCurrency(mIncome),
      expense: mExpense.toString(),
      formattedExpense: formatPoishaToCurrency(mExpense),
      net: mNet.toString(),
      formattedNet: formatPoishaToCurrency(mNet),
    });
  }

  return {
    fiscalYear,
    fiscalYearStartMonth: fyStartMonth,
    period: { startDate, endDate },
    openingBalance: openingBalance.toString(),
    formattedOpeningBalance: formatPoishaToCurrency(openingBalance),
    totalIncome: totalIncome.toString(),
    formattedTotalIncome: formatPoishaToCurrency(totalIncome),
    totalExpense: totalExpense.toString(),
    formattedTotalExpense: formatPoishaToCurrency(totalExpense),
    netSurplus: netSurplus.toString(),
    formattedNetSurplus: formatPoishaToCurrency(netSurplus),
    closingBalance: closingBalance.toString(),
    formattedClosingBalance: formatPoishaToCurrency(closingBalance),
    monthlyBreakdown,
  };
}

// =============================================================================
// 8 & 9. POST /reports/exports & GET /reports/exports/:exportId
// =============================================================================

function convertToCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCsv = (str: unknown) => {
    const s = String(str ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = headers.map(escapeCsv).join(",");
  const rowLines = rows.map((r) => r.map(escapeCsv).join(","));
  return [headerLine, ...rowLines].join("\n");
}

export async function createReportExport(
  mosqueId: string,
  userId: string,
  input: CreateReportExportInput,
) {
  let fileContent = "";
  const params = input.parameters ?? {};

  switch (input.reportType) {
    case ReportType.BALANCES: {
      const data = await getBalancesReport(mosqueId, params);
      const rows: (string | number)[][] = [];
      (data.accounts || []).forEach((a) => {
        rows.push(["Asset Account", a.name, a.type, a.formattedBalance]);
      });
      rows.push(["Summary", "Total Accounts Balance", "", data.formattedTotalAccountsBalance]);
      (data.funds || []).forEach((f) => {
        rows.push(["Fund Equity", f.name, f.isRestricted ? "Restricted" : "Unrestricted", f.formattedBalance]);
      });
      rows.push(["Summary", "Total Funds Balance", "", data.formattedTotalFundsBalance]);
      fileContent = convertToCsv(["Classification", "Name", "Type / Restriction", "Current Balance (BDT)"], rows);
      break;
    }
    case ReportType.INCOME_EXPENSE: {
      const data = await getIncomeExpenseReport(mosqueId, params as any);
      if (params.groupBy === "category" || (!params.groupBy && (data.incomeCategories || data.expenseCategories))) {
        const rows: (string | number)[][] = [];
        (data.incomeCategories || []).forEach((c: any) => {
          rows.push(["Income", c.categoryName, c.formattedAmount, c.count]);
        });
        (data.expenseCategories || []).forEach((c: any) => {
          rows.push(["Expense", c.categoryName, c.formattedAmount, c.count]);
        });
        rows.push(["Summary", "Total Income", data.formattedTotalIncome, ""]);
        rows.push(["Summary", "Total Expense", data.formattedTotalExpense, ""]);
        rows.push(["Summary", "Net Surplus / (Deficit)", data.formattedNetSurplus, ""]);
        fileContent = convertToCsv(["Flow Type", "Category Name", "Amount (BDT)", "Transactions Count"], rows);
      } else if (params.groupBy === "fund") {
        const rows: (string | number)[][] = (data.data || []).map((item: any) => [
          item.fundName || item.name || "Fund",
          item.fundType || item.type || "GENERAL",
          item.formattedIncome,
          item.formattedExpense,
          item.formattedNet,
        ]);
        rows.push(["Total", "", data.formattedTotalIncome, data.formattedTotalExpense, data.formattedNetSurplus]);
        fileContent = convertToCsv(["Fund Name", "Fund Type", "Income (BDT)", "Expense (BDT)", "Net Allocation (BDT)"], rows);
      } else {
        const rows: (string | number)[][] = (data.data || []).map((item: any) => [
          item.month || "Period",
          item.formattedIncome,
          item.formattedExpense,
          item.formattedNet,
        ]);
        rows.push(["Total", data.formattedTotalIncome, data.formattedTotalExpense, data.formattedNetSurplus]);
        fileContent = convertToCsv(["Accounting Period", "Income (BDT)", "Expense (BDT)", "Net Flow (BDT)"], rows);
      }
      break;
    }
    case ReportType.DONORS: {
      const data = await getDonorsReport(mosqueId, params as any);
      const donorList = data.topDonors || data.donors || data.data || [];
      const rows: (string | number)[][] = donorList.map((d: any, idx: number) => [
        idx + 1,
        d.name || d.donorName || "Congregant",
        d.phone || "",
        d.formattedTotalGiven || d.formattedTotalAmount || "",
        d.donationCount || d.count || 1,
      ]);
      rows.push(["Total", `${donorList.length} Donors`, "", data.formattedTotalGiving || "", data.totalDonationsCount || ""]);
      fileContent = convertToCsv(["Rank", "Donor / Household", "Phone", "Total Contributed (BDT)", "Donation Count"], rows);
      break;
    }
    case ReportType.DASHBOARD:
    default: {
      const data = await getDashboardReport(mosqueId);
      const rows: (string | number)[][] = [
        ["Total Accounts", data.balances.formattedTotalAccounts],
        ["Total Funds", data.balances.formattedTotalFunds],
        ["This Month Income", data.thisMonth.formattedIncome],
        ["This Month Expense", data.thisMonth.formattedExpense],
        ["This Month Surplus", data.thisMonth.formattedNetSurplus],
        ["Pending Approvals", String(data.pendingApprovals.totalPending)],
        ["Dues Collection Rate", `${data.duesCollection.collectionRatePercentage}%`],
      ];
      fileContent = convertToCsv(["Metric", "Value"], rows);
      break;
    }
  }

  const exportRecord = await prisma.reportExport.create({
    data: {
      mosqueId,
      reportType: input.reportType,
      format: input.format,
      status: ExportStatus.COMPLETED,
      fileContent,
      mimeType: input.format === ExportFormat.CSV ? "text/csv" : "application/octet-stream",
      fileName: `${input.reportType.toLowerCase()}_${Date.now()}.${input.format.toLowerCase()}`,
      downloadUrl: `/api/reports/exports/temp-id`,
      requestedById: userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      parameters: input.parameters ? JSON.stringify(input.parameters) : undefined,
    },
  });

  const updated = await prisma.reportExport.update({
    where: { id: exportRecord.id },
    data: { downloadUrl: `/api/reports/exports/${exportRecord.id}` },
  });

  return {
    exportId: updated.id,
    id: updated.id,
    reportType: updated.reportType,
    format: updated.format,
    status: updated.status,
    downloadUrl: updated.downloadUrl,
    expiresAt: updated.expiresAt,
  };
}

export async function getReportExport(
  mosqueId: string,
  exportId: string,
  userId: string,
  userRole: Role,
) {
  const exportRecord = await prisma.reportExport.findFirst({
    where: { id: exportId, mosqueId },
  });

  if (!exportRecord) {
    throw HttpError.notFound("Report export not found.", "EXPORT_NOT_FOUND");
  }

  // Permission check: Requester or ADMIN/TREASURER
  if (
    exportRecord.requestedById !== userId &&
    userRole !== Role.MOSQUE_ADMIN &&
    userRole !== Role.TREASURER
  ) {
    throw HttpError.forbidden(
      "You are not authorized to download this report export.",
      "FORBIDDEN_EXPORT",
    );
  }

  return {
    exportId: exportRecord.id,
    id: exportRecord.id,
    reportType: exportRecord.reportType,
    format: exportRecord.format,
    status: exportRecord.status,
    downloadUrl: exportRecord.downloadUrl,
    fileName: exportRecord.fileName,
    mimeType: exportRecord.mimeType,
    expiresAt: exportRecord.expiresAt,
    createdAt: exportRecord.createdAt,
    content: exportRecord.fileContent,
  };
}

// =============================================================================
// 10 & 11. Accounting Periods: POST /periods/:yyyy_mm/close & reopen
// =============================================================================

export async function closeAccountingPeriod(
  mosqueId: string,
  period: string,
  userId: string,
) {
  const [yearStr, monthStr] = period.split("-");
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);

  // End of month in UTC: last millisecond of the given month
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return prisma.$transaction(async (tx) => {
    const updatedMosque = await tx.mosque.update({
      where: { id: mosqueId },
      data: { closedPeriodUntil: endOfMonth },
      select: { id: true, name: true, closedPeriodUntil: true },
    });

    const audit = await tx.periodAuditLog.create({
      data: {
        mosqueId,
        period,
        action: PeriodAction.CLOSED,
        performedById: userId,
      },
    });

    await recordAuditLog(tx, {
      mosqueId,
      actorId: userId,
      action: AuditAction.CLOSE_PERIOD,
      entity: AuditEntity.PERIOD,
      entityId: period,
      summary: `Locked accounting period ${period}`,
      metadata: { period, closedPeriodUntil: endOfMonth },
    });

    return {
      message: `Accounting period ${period} has been locked. Entries on or before this period cannot be posted, approved, or voided.`,
      period,
      closedPeriodUntil: updatedMosque.closedPeriodUntil,
      auditId: audit.id,
    };
  });
}

export async function reopenAccountingPeriod(
  mosqueId: string,
  period: string,
  userId: string,
  reason: string,
) {
  const [yearStr, monthStr] = period.split("-");
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));

  const mosque = await prisma.mosque.findUnique({
    where: { id: mosqueId },
    select: { id: true, closedPeriodUntil: true },
  });

  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  if (!mosque.closedPeriodUntil || mosque.closedPeriodUntil < startOfMonth) {
    throw HttpError.badRequest(
      `Period ${period} is not currently closed.`,
      "PERIOD_NOT_CLOSED",
    );
  }

  // Rollback closedPeriodUntil to end of previous month
  const previousMonthEnd =
    month === 1
      ? new Date(Date.UTC(year - 1, 12, 0, 23, 59, 59, 999))
      : new Date(Date.UTC(year, month - 1, 0, 23, 59, 59, 999));

  return prisma.$transaction(async (tx) => {
    const updatedMosque = await tx.mosque.update({
      where: { id: mosqueId },
      data: { closedPeriodUntil: previousMonthEnd },
      select: { id: true, name: true, closedPeriodUntil: true },
    });

    const audit = await tx.periodAuditLog.create({
      data: {
        mosqueId,
        period,
        action: PeriodAction.REOPENED,
        reason,
        performedById: userId,
      },
    });

    await recordAuditLog(tx, {
      mosqueId,
      actorId: userId,
      action: AuditAction.REOPEN_PERIOD,
      entity: AuditEntity.PERIOD,
      entityId: period,
      summary: `Reopened accounting period ${period}: ${reason}`,
      metadata: { period, reason, closedPeriodUntil: previousMonthEnd },
    });

    return {
      message: `Accounting period ${period} has been reopened successfully.`,
      period,
      reason,
      closedPeriodUntil: updatedMosque.closedPeriodUntil,
      auditId: audit.id,
    };
  });
}

// =============================================================================
// 12. POST /accounts/:accountId/reconciliations
// =============================================================================

export async function reconcileAccount(
  mosqueId: string,
  accountId: string,
  userId: string,
  input: AccountReconciliationInput,
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, mosqueId, isArchived: false },
  });

  if (!account) {
    throw HttpError.notFound("Account not found or is archived.", "ACCOUNT_NOT_FOUND");
  }

  const asOfDate = input.asOf ?? new Date();

  // Closed period check
  const mosque = await prisma.mosque.findUnique({
    where: { id: mosqueId },
    select: { closedPeriodUntil: true, fiscalYearStart: true },
  });

  if (mosque && isDateInClosedPeriod(asOfDate, mosque)) {
    throw HttpError.badRequest(
      "Cannot record an account reconciliation adjustment in a closed accounting period.",
      "PERIOD_CLOSED",
    );
  }

  // Calculate System Balance as of asOfDate
  const [donations, expenses, transferIn, transferOut] = await Promise.all([
    prisma.donation.aggregate({
      where: {
        accountId,
        date: { lte: asOfDate },
        OR: [
          { status: DonationStatus.POSTED },
          { status: DonationStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        accountId,
        date: { lte: asOfDate },
        OR: [
          { status: ExpenseStatus.POSTED },
          { status: ExpenseStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        accountId,
        leg: TransferLeg.TO,
        date: { lte: asOfDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: {
        accountId,
        leg: TransferLeg.FROM,
        date: { lte: asOfDate },
        OR: [
          { status: TransferStatus.POSTED },
          { status: TransferStatus.VOIDED, reversalEntry: { isNot: null } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  const systemBalance =
    account.openingBalance +
    (donations._sum.amount ?? 0n) -
    (expenses._sum.amount ?? 0n) +
    (transferIn._sum.amount ?? 0n) -
    (transferOut._sum.amount ?? 0n);

  const difference = input.realBalance - systemBalance;

  // Case A: Perfect match (difference is 0)
  if (difference === 0n) {
    const reconciliation = await prisma.accountReconciliation.create({
      data: {
        mosqueId,
        accountId,
        asOf: asOfDate,
        systemBalance,
        realBalance: input.realBalance,
        difference: 0n,
        notes: input.notes,
        reconciledById: userId,
      },
    });

    await recordAuditLog(prisma, {
      mosqueId,
      actorId: userId,
      action: AuditAction.RECONCILE,
      entity: AuditEntity.ACCOUNT,
      entityId: account.id,
      summary: `Reconciled account ${account.name} (Matched system balance of ${formatPoishaToCurrency(systemBalance)})`,
      metadata: {
        systemBalance: systemBalance.toString(),
        realBalance: input.realBalance.toString(),
        difference: "0",
      },
    });

    return {
      reconciliationId: reconciliation.id,
      accountId: account.id,
      accountName: account.name,
      asOf: asOfDate,
      systemBalance: systemBalance.toString(),
      formattedSystemBalance: formatPoishaToCurrency(systemBalance),
      realBalance: input.realBalance.toString(),
      formattedRealBalance: formatPoishaToCurrency(input.realBalance),
      difference: "0",
      formattedDifference: "0.00",
      matched: true,
      adjustment: null,
      message: "Physical balance matches system balance perfectly. No adjustment needed.",
    };
  }

  // Resolve fund for discrepancy adjustment
  let fundId = input.fundId;
  if (fundId) {
    const fundExists = await prisma.fund.findFirst({
      where: { id: fundId, mosqueId, isArchived: false },
    });
    if (!fundExists) {
      throw HttpError.badRequest("Selected fund does not exist or is archived.", "INVALID_FUND");
    }
  } else {
    const defaultFund = await prisma.fund.findFirst({
      where: { mosqueId, isArchived: false, type: FundType.GENERAL },
    }) ?? await prisma.fund.findFirst({
      where: { mosqueId, isArchived: false },
    });

    if (!defaultFund) {
      throw HttpError.badRequest("No active fund available to absorb reconciliation adjustment.", "NO_ACTIVE_FUND");
    }
    fundId = defaultFund.id;
  }

  return prisma.$transaction(async (tx) => {
    // Case B: Surplus (realBalance > systemBalance) -> difference > 0n
    // Creates an explicit adjustment income entry (Donation)
    if (difference > 0n) {
      let incomeCategory = await tx.category.findFirst({
        where: { mosqueId, name: "Reconciliation Adjustment", type: CategoryType.INCOME },
      });

      if (!incomeCategory) {
        incomeCategory = await tx.category.findFirst({
          where: { mosqueId, type: CategoryType.INCOME, isArchived: false },
        });
      }

      if (!incomeCategory) {
        incomeCategory = await tx.category.create({
          data: {
            mosqueId,
            name: "Reconciliation Adjustment",
            type: CategoryType.INCOME,
          },
        });
      }

      const receiptNumber = `REC-ADJ-${Date.now().toString().slice(-6)}`;

      const adjustmentDonation = await tx.donation.create({
        data: {
          mosqueId,
          accountId,
          fundId,
          categoryId: incomeCategory.id,
          amount: difference,
          date: asOfDate,
          source: DonationSource.CASH_BOX,
          status: DonationStatus.POSTED,
          receiptNumber,
          notes: input.notes
            ? `${input.notes} (Reconciliation adjustment: physical surplus)`
            : "Reconciliation adjustment: physical surplus",
          donorName: "Reconciliation Adjustment",
          postedById: userId,
          postedAt: new Date(),
          createdById: userId,
        },
      });

      const reconciliation = await tx.accountReconciliation.create({
        data: {
          mosqueId,
          accountId,
          asOf: asOfDate,
          systemBalance,
          realBalance: input.realBalance,
          difference,
          notes: input.notes,
          reconciledById: userId,
          adjustmentDonationId: adjustmentDonation.id,
        },
      });

      await recordAuditLog(tx, {
        mosqueId,
        actorId: userId,
        action: AuditAction.RECONCILE,
        entity: AuditEntity.ACCOUNT,
        entityId: account.id,
        summary: `Reconciled account ${account.name} (Surplus adjustment: +${formatPoishaToCurrency(difference)} taka)`,
        metadata: {
          systemBalance: systemBalance.toString(),
          realBalance: input.realBalance.toString(),
          difference: difference.toString(),
          adjustmentType: "DONATION",
          receiptNumber: adjustmentDonation.receiptNumber,
        },
      });

      return {
        reconciliationId: reconciliation.id,
        accountId: account.id,
        accountName: account.name,
        asOf: asOfDate,
        systemBalance: systemBalance.toString(),
        formattedSystemBalance: formatPoishaToCurrency(systemBalance),
        realBalance: input.realBalance.toString(),
        formattedRealBalance: formatPoishaToCurrency(input.realBalance),
        difference: difference.toString(),
        formattedDifference: formatPoishaToCurrency(difference),
        matched: false,
        adjustment: {
          type: "DONATION",
          id: adjustmentDonation.id,
          amount: difference.toString(),
          formattedAmount: formatPoishaToCurrency(difference),
          receiptNumber: adjustmentDonation.receiptNumber,
          notes: adjustmentDonation.notes,
        },
        message: `System balance adjusted upward by ${formatPoishaToCurrency(difference)} due to physical surplus.`,
      };
    }

    // Case C: Shortfall (realBalance < systemBalance) -> difference < 0n
    // Creates an explicit adjustment expense entry
    const shortfall = -difference;

    let expenseCategory = await tx.category.findFirst({
      where: { mosqueId, name: "Reconciliation Adjustment", type: CategoryType.EXPENSE },
    });

    if (!expenseCategory) {
      expenseCategory = await tx.category.findFirst({
        where: { mosqueId, type: CategoryType.EXPENSE, isArchived: false },
      });
    }

    if (!expenseCategory) {
      expenseCategory = await tx.category.create({
        data: {
          mosqueId,
          name: "Reconciliation Adjustment",
          type: CategoryType.EXPENSE,
        },
      });
    }

    const voucherNo = `VCH-ADJ-${Date.now().toString().slice(-6)}`;

    const adjustmentExpense = await tx.expense.create({
      data: {
        mosqueId,
        accountId,
        fundId,
        categoryId: expenseCategory.id,
        amount: shortfall,
        date: asOfDate,
        payee: "Reconciliation Adjustment",
        status: ExpenseStatus.POSTED,
        voucherNo,
        notes: input.notes
          ? `${input.notes} (Reconciliation adjustment: physical shortfall)`
          : "Reconciliation adjustment: physical shortfall",
        postedById: userId,
        postedAt: new Date(),
        createdById: userId,
      },
    });

    const reconciliation = await tx.accountReconciliation.create({
      data: {
        mosqueId,
        accountId,
        asOf: asOfDate,
        systemBalance,
        realBalance: input.realBalance,
        difference,
        notes: input.notes,
        reconciledById: userId,
        adjustmentExpenseId: adjustmentExpense.id,
      },
    });

    await recordAuditLog(tx, {
      mosqueId,
      actorId: userId,
      action: AuditAction.RECONCILE,
      entity: AuditEntity.ACCOUNT,
      entityId: account.id,
      summary: `Reconciled account ${account.name} (Shortfall adjustment: -${formatPoishaToCurrency(shortfall)} taka)`,
      metadata: {
        systemBalance: systemBalance.toString(),
        realBalance: input.realBalance.toString(),
        difference: difference.toString(),
        adjustmentType: "EXPENSE",
        voucherNo: adjustmentExpense.voucherNo,
      },
    });

    return {
      reconciliationId: reconciliation.id,
      accountId: account.id,
      accountName: account.name,
      asOf: asOfDate,
      systemBalance: systemBalance.toString(),
      formattedSystemBalance: formatPoishaToCurrency(systemBalance),
      realBalance: input.realBalance.toString(),
      formattedRealBalance: formatPoishaToCurrency(input.realBalance),
      difference: difference.toString(),
      formattedDifference: formatPoishaToCurrency(difference),
      matched: false,
      adjustment: {
        type: "EXPENSE",
        id: adjustmentExpense.id,
        amount: shortfall.toString(),
        formattedAmount: formatPoishaToCurrency(shortfall),
        voucherNo: adjustmentExpense.voucherNo,
        notes: adjustmentExpense.notes,
      },
      message: `System balance adjusted downward by ${formatPoishaToCurrency(shortfall)} due to physical shortfall.`,
    };
  });
}
