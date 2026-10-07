// =============================================================================
// Transparency Module — Business Logic & Privacy-Safe Queries
//
// Design notes:
//  • Public-facing transparency services that enforce complete data minimisation.
//  • Existence-hiding posture: Disabled transparency returns generic 404 (not 403).
//  • Summary computes currentBalance strictly via getFundBalance() to prevent drift.
//  • Period sums (totalCollected, totalDisbursed) cover current fiscal year only.
//  • Feed excludes voided originals and reversal corrections (reversalOfId: null).
//  • Anonymous-flagged donors are strictly redacted as "Anonymous".
//  • Never exposes Account rows, account numbers, or donor phone/email.
//  • Expense summary aggregates by Category only (never itemized vendor/staff rows).
//  • Campaign endpoints compute raised and pledged amounts live from the ledger.
//  • Receipt verification confirms authenticity without leaking donor identities.
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  CampaignStatus,
  DonationStatus,
  ExpenseStatus,
  FundType,
  PledgeStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { getFundBalance } from "../fund/fund.service.js";
import {
  validateTransparencyMonthQuery,
  getFiscalYearDateRange,
  type DonationsFeedQuery,
} from "./transparency.validation.js";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface PublicFundSummaryItem {
  name: string;
  type: FundType;
  isRestricted: boolean;
  totalCollected: string;
  totalDisbursed: string;
  currentBalance: string;
}

export interface PublicMosqueSummary {
  mosque: {
    name: string;
    slug: string;
  };
  fiscalYear: {
    startDate: Date;
    endDate: Date;
  };
  funds: PublicFundSummaryItem[];
}

export interface PublicDonationFeedItem {
  amount: string;
  fundName: string;
  categoryName: string;
  date: Date;
  donorName: string;
}

export interface PublicDonationsFeedResult {
  donations: PublicDonationFeedItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface PublicExpenseCategoryItem {
  categoryName: string;
  total: string;
}

export interface PublicExpenseCategorySummary {
  mosque: {
    name: string;
    slug: string;
  };
  fiscalYear: {
    startDate: Date;
    endDate: Date;
  };
  totalExpenses: string;
  categories: PublicExpenseCategoryItem[];
}

export interface PublicCampaignFeedItem {
  id: string;
  title: string;
  description: string | null;
  goalAmount: string | null;
  targetAmount: string | null;
  raisedAmount: string;
  pledgedAmount: string;
  percentage: number | null;
  status: CampaignStatus;
  startDate: Date;
  endDate: Date | null;
}

export interface PublicCampaignDonorItem {
  donorName: string;
  amount: string;
  date: Date;
}

export interface PublicCampaignDetail {
  id: string;
  title: string;
  description: string | null;
  goalAmount: string | null;
  targetAmount: string | null;
  raisedAmount: string;
  percentage: number | null;
  donorCount: number;
  status: CampaignStatus;
  startDate: Date;
  endDate: Date | null;
  donors: PublicCampaignDonorItem[];
}

export interface TransparencyFundSummary {
  fundName: string;
  income: string;
  expense: string;
  net: string;
}

export interface TransparencyCategorySummary {
  categoryName: string;
  total: string;
}

export interface PublicTransparencyReport {
  month: string;
  mosque: {
    name: string;
    slug: string;
  };
  summary: {
    totalIncome: string;
    totalExpense: string;
    netSavings: string;
  };
  byFund: TransparencyFundSummary[];
  byCategory: {
    income: TransparencyCategorySummary[];
    expense: TransparencyCategorySummary[];
  };
}

export interface PublicReceiptVerification {
  verified: boolean;
  receiptNumber: string;
  verificationCode: string;
  date: Date;
  amount: {
    raw: string;
    formatted: string;
    currency: string;
  };
  fund: {
    name: string;
  };
  mosque: {
    name: string;
    slug: string;
    address: string | null;
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves an active mosque by its URL slug and verifies public transparency is enabled.
 *
 * Security & Anti-Enumeration:
 * Returns generic 404 (not 403) if the mosque does not exist, is archived, or
 * has isTransparencyPageEnabled set to false. Turning transparency off is
 * completely indistinguishable from the mosque not existing.
 */
async function resolveTransparencyMosque(slug: string) {
  const mosque = await prisma.mosque.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      fiscalYearStart: true,
      isTransparencyPageEnabled: true,
      publicTransparency: true,
      isArchived: true,
    },
  });

  const isEnabled = Boolean(
    mosque && (mosque.isTransparencyPageEnabled || mosque.publicTransparency),
  );

  if (!mosque || mosque.isArchived || !isEnabled) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  return mosque;
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Returns the mosque's fiscal-year-to-date totals per Fund:
 * name, type, isRestricted, totalCollected, totalDisbursed, currentBalance.
 *
 * Design & Security rules:
 *  - Compute currentBalance strictly via the internal getFundBalance(fund.id)
 *    so numbers never drift from the admin dashboard.
 *  - totalCollected & totalDisbursed are period sums (POSTED only, this fiscal year).
 *  - Gated by isTransparencyPageEnabled (404 generic not found if false).
 *  - Never exposes Account rows, account numbers, or bank details.
 *
 * @param slug - Mosque URL slug
 */
export async function getPublicMosqueSummary(
  slug: string,
): Promise<PublicMosqueSummary> {
  const mosque = await resolveTransparencyMosque(slug);
  const { startDate, endDate } = getFiscalYearDateRange(mosque.fiscalYearStart);

  // 1. Fetch active funds
  const funds = await prisma.fund.findMany({
    where: {
      mosqueId: mosque.id,
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      type: true,
      isRestricted: true,
    },
    orderBy: { name: "asc" },
  });

  if (funds.length === 0) {
    return {
      mosque: { name: mosque.name, slug: mosque.slug },
      fiscalYear: { startDate, endDate },
      funds: [],
    };
  }

  const fundIds = funds.map((f) => f.id);

  // 2. Fetch period sums (POSTED only, this fiscal year) in parallel with fund balances
  const [donationsByFund, expensesByFund, balances] = await Promise.all([
    prisma.donation.groupBy({
      by: ["fundId"],
      where: {
        mosqueId: mosque.id,
        fundId: { in: fundIds },
        status: DonationStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["fundId"],
      where: {
        mosqueId: mosque.id,
        fundId: { in: fundIds },
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    // Strictly reusing getFundBalance() to prevent drift between admin and public dashboard numbers
    Promise.all(funds.map((f) => getFundBalance(f.id))),
  ]);

  const donationMap = new Map<string, bigint>();
  for (const d of donationsByFund) {
    donationMap.set(d.fundId, d._sum.amount ?? 0n);
  }

  const expenseMap = new Map<string, bigint>();
  for (const e of expensesByFund) {
    expenseMap.set(e.fundId, e._sum.amount ?? 0n);
  }

  const fundSummaries: PublicFundSummaryItem[] = funds.map((f, i) => ({
    name: f.name,
    type: f.type,
    isRestricted: f.isRestricted,
    totalCollected: (donationMap.get(f.id) ?? 0n).toString(),
    totalDisbursed: (expenseMap.get(f.id) ?? 0n).toString(),
    currentBalance: (balances[i] ?? 0n).toString(),
  }));

  return {
    mosque: {
      name: mosque.name,
      slug: mosque.slug,
    },
    fiscalYear: {
      startDate,
      endDate,
    },
    funds: fundSummaries,
  };
}

/**
 * Paginated, newest-first feed of individual donations.
 *
 * Privacy & Accounting rules:
 *  - Filter: status: POSTED and reversalOfId: null. This condition cleanly excludes
 *    both voided originals and reversal corrections from the visible feed.
 *  - Fields returned: amount, fundName, categoryName, date, donorName.
 *  - Substitutes "Anonymous" when isAnonymousPublic is true or donorName is null.
 *  - Never includes donorPhone, donorEmail, memberId, accountId, or internal IDs.
 *
 * @param slug - Mosque URL slug
 * @param query - Validated pagination parameters (page, limit)
 */
export async function getPublicMosqueDonationsFeed(
  slug: string,
  query: DonationsFeedQuery,
): Promise<PublicDonationsFeedResult> {
  const mosque = await resolveTransparencyMosque(slug);
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  // Filter: status: POSTED and reversalOfId: null (excludes voided originals and reversal corrections)
  const where: Prisma.DonationWhereInput = {
    mosqueId: mosque.id,
    status: DonationStatus.POSTED,
    reversalOfId: null,
  };

  const [totalCount, rows] = await Promise.all([
    prisma.donation.count({ where }),
    prisma.donation.findMany({
      where,
      select: {
        amount: true,
        date: true,
        donorName: true,
        isAnonymousPublic: true,
        fund: {
          select: { name: true },
        },
        category: {
          select: { name: true },
        },
        member: {
          select: {
            user: {
              select: { name: true },
            },
          },
        },
        family: {
          select: { name: true },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  const donations: PublicDonationFeedItem[] = rows.map((d) => {
    let displayName = "Anonymous";
    if (!d.isAnonymousPublic) {
      if (d.donorName && d.donorName.trim() && d.donorName.trim().toLowerCase() !== "anonymous") {
        displayName = d.donorName.trim();
      } else if (d.member?.user?.name && d.member.user.name.trim()) {
        displayName = d.member.user.name.trim();
      } else if (d.family?.name && d.family.name.trim()) {
        displayName = `${d.family.name.trim()} Household`;
      }
    }

    return {
      amount: d.amount.toString(),
      fundName: d.fund.name,
      categoryName: d.category.name,
      date: d.date,
      donorName: displayName,
    };
  });

  const totalPages = Math.ceil(totalCount / limit) || 1;

  return {
    donations,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Expense totals grouped by Category (not itemized) for the current fiscal year.
 *
 * Privacy rules:
 *  - Deliberately aggregates by Category only: an itemized public feed would expose
 *    vendor payments and staff salary details next to names.
 *  - This is the "where does the money go" macro view, not an internal audit log.
 *
 * @param slug - Mosque URL slug
 */
export async function getPublicMosqueExpenseCategorySummary(
  slug: string,
): Promise<PublicExpenseCategorySummary> {
  const mosque = await resolveTransparencyMosque(slug);
  const { startDate, endDate } = getFiscalYearDateRange(mosque.fiscalYearStart);

  const expenseGroups = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: {
      mosqueId: mosque.id,
      status: ExpenseStatus.POSTED,
      date: { gte: startDate, lt: endDate },
    },
    _sum: { amount: true },
    orderBy: {
      _sum: {
        amount: "desc",
      },
    },
  });

  const categoryIds = expenseGroups.map((g) => g.categoryId);
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  let totalExpenseAmount = 0n;
  const categoryItems: PublicExpenseCategoryItem[] = [];

  for (const group of expenseGroups) {
    const amount = group._sum.amount ?? 0n;
    totalExpenseAmount += amount;
    categoryItems.push({
      categoryName: categoryMap.get(group.categoryId) ?? "General Expense",
      total: amount.toString(),
    });
  }

  return {
    mosque: {
      name: mosque.name,
      slug: mosque.slug,
    },
    fiscalYear: {
      startDate,
      endDate,
    },
    totalExpenses: totalExpenseAmount.toString(),
    categories: categoryItems,
  };
}

/**
 * Lists ACTIVE campaigns (plus recently completed ones within 30 days) with
 * title, description, goalAmount, raisedAmount, pledgedAmount, and endDate.
 *
 * Privacy guarantees:
 *  - No individual pledger or donor identities exposed.
 *  - Raised amount is aggregated live from POSTED donations.
 *  - Pledged amount is aggregated live from open (OPEN / PARTIAL) pledges.
 *
 * @param slug - Mosque URL slug
 */
export async function getPublicCampaigns(
  slug: string,
): Promise<PublicCampaignFeedItem[]> {
  const mosque = await resolveTransparencyMosque(slug);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const campaigns = await prisma.campaign.findMany({
    where: {
      mosqueId: mosque.id,
      isPublic: true,
      OR: [
        { status: CampaignStatus.ACTIVE },
        {
          status: CampaignStatus.CLOSED,
          OR: [
            { closedAt: { gte: thirtyDaysAgo } },
            { endDate: { gte: thirtyDaysAgo } },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      targetAmount: true,
      startDate: true,
      endDate: true,
      status: true,
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });

  if (campaigns.length === 0) {
    return [];
  }

  const campaignIds = campaigns.map((c) => c.id);

  // Aggregate raisedAmount (POSTED donations) and pledgedAmount (OPEN / PARTIAL pledges)
  const [raisedAggregations, pledgeAggregations] = await Promise.all([
    prisma.donation.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { in: campaignIds },
        status: DonationStatus.POSTED,
      },
      _sum: { amount: true },
    }),
    prisma.pledge.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { in: campaignIds },
        status: { in: [PledgeStatus.OPEN, PledgeStatus.PARTIAL] },
      },
      _sum: { amount: true },
    }),
  ]);

  const raisedMap = new Map<string, bigint>();
  for (const agg of raisedAggregations) {
    if (agg.campaignId) {
      raisedMap.set(agg.campaignId, agg._sum.amount ?? 0n);
    }
  }

  const pledgeMap = new Map<string, bigint>();
  for (const agg of pledgeAggregations) {
    if (agg.campaignId) {
      pledgeMap.set(agg.campaignId, agg._sum.amount ?? 0n);
    }
  }

  return campaigns.map((c) => {
    const raised = raisedMap.get(c.id) ?? 0n;
    const pledged = pledgeMap.get(c.id) ?? 0n;
    let percentage: number | null = null;
    if (c.targetAmount && c.targetAmount > 0n) {
      const pct = Number((raised * 10000n) / c.targetAmount) / 100;
      percentage = Math.min(100, Math.round(pct * 100) / 100);
    }

    const goal = c.targetAmount ? c.targetAmount.toString() : null;

    return {
      id: c.id,
      title: c.title,
      description: c.description ?? null,
      goalAmount: goal,
      targetAmount: goal,
      raisedAmount: raised.toString(),
      pledgedAmount: pledged.toString(),
      percentage,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate ?? null,
    };
  });
}

/**
 * Retrieves live progress and public contributor history for a single campaign.
 *
 * Privacy guarantees:
 *  - Anonymous-flagged donors NEVER appear in the contributors list.
 *  - Strips all internal IDs.
 *  - Total raised amount and donor count reflect all posted contributions towards the goal.
 *
 * @param slug - Mosque URL slug
 * @param campaignId - Target campaign ID
 */
export async function getPublicCampaignDetails(
  slug: string,
  campaignId: string,
): Promise<PublicCampaignDetail> {
  const mosque = await resolveTransparencyMosque(slug);

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      mosqueId: mosque.id,
      isPublic: true,
    },
    select: {
      id: true,
      title: true,
      description: true,
      targetAmount: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  if (!campaign) {
    throw HttpError.notFound("Campaign not found.", "CAMPAIGN_NOT_FOUND");
  }

  // 1. Live financial metrics
  const [aggregate, donorCountDistinct] = await Promise.all([
    prisma.donation.aggregate({
      where: { campaignId: campaign.id, status: DonationStatus.POSTED },
      _sum: { amount: true },
    }),
    prisma.donation.findMany({
      where: { campaignId: campaign.id, status: DonationStatus.POSTED },
      select: { memberId: true, familyId: true, donorName: true },
      distinct: ["memberId", "familyId", "donorName"],
    }),
  ]);

  const raised = aggregate._sum.amount ?? 0n;
  let percentage: number | null = null;
  if (campaign.targetAmount && campaign.targetAmount > 0n) {
    const pct = Number((raised * 10000n) / campaign.targetAmount) / 100;
    percentage = Math.min(100, Math.round(pct * 100) / 100);
  }

  // 2. Fetch public donors: Strictly exclude anonymous-flagged donations
  const publicDonationRows = await prisma.donation.findMany({
    where: {
      campaignId: campaign.id,
      status: DonationStatus.POSTED,
      isAnonymousPublic: false,
    },
    select: {
      amount: true,
      date: true,
      donorName: true,
      member: {
        select: {
          user: { select: { name: true } },
        },
      },
      family: {
        select: { name: true },
      },
    },
    orderBy: { date: "desc" },
    take: 50,
  });

  // Filter out any entries marked "Anonymous" as a fallback
  const donors: PublicCampaignDonorItem[] = publicDonationRows
    .filter((d) => {
      const candidate = d.member?.user?.name || d.family?.name || d.donorName || "";
      return candidate.trim().toLowerCase() !== "anonymous";
    })
    .map((d) => {
      const displayName =
        d.member?.user?.name ||
        (d.family?.name ? `${d.family.name} Household` : null) ||
        d.donorName ||
        "Supporter";

      return {
        donorName: displayName,
        amount: d.amount.toString(),
        date: d.date,
      };
    });

  const goal = campaign.targetAmount ? campaign.targetAmount.toString() : null;

  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description ?? null,
    goalAmount: goal,
    targetAmount: goal,
    raisedAmount: raised.toString(),
    percentage,
    donorCount: donorCountDistinct.length,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate ?? null,
    donors,
  };
}

/**
 * Retrieves monthly totals of income and expense broken down by fund and category.
 *
 * Privacy & Security guarantees:
 *  - Only accessible if mosque has enabled public transparency.
 *  - Returns generic 404 (not 403) if disabled or not found to avoid tenant enumeration.
 *  - Totals only; never exposes individual transactions, account numbers, or personal details.
 *
 * @param slug - Mosque URL slug
 * @param monthQuery - Optional string in 'YYYY-MM' format (defaults to current month)
 */
export async function getPublicMosqueTransparency(
  slug: string,
  monthQuery?: string,
): Promise<PublicTransparencyReport> {
  const mosque = await resolveTransparencyMosque(slug);

  const { monthStr, startDate, endDate } = validateTransparencyMonthQuery(monthQuery);

  const [
    incomeByFund,
    expenseByFund,
    incomeByCategory,
    expenseByCategory,
    funds,
    categories,
    totalIncomeAgg,
    totalExpenseAgg,
  ] = await Promise.all([
    prisma.donation.groupBy({
      by: ["fundId"],
      where: {
        mosqueId: mosque.id,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["fundId"],
      where: {
        mosqueId: mosque.id,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.donation.groupBy({
      by: ["categoryId"],
      where: {
        mosqueId: mosque.id,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      where: {
        mosqueId: mosque.id,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.fund.findMany({
      where: { mosqueId: mosque.id },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { mosqueId: mosque.id },
      select: { id: true, name: true, type: true },
    }),
    prisma.donation.aggregate({
      where: {
        mosqueId: mosque.id,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        mosqueId: mosque.id,
        status: ExpenseStatus.POSTED,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = totalIncomeAgg._sum.amount ?? 0n;
  const totalExpense = totalExpenseAgg._sum.amount ?? 0n;
  const netSavings = totalIncome - totalExpense;

  // Build fund breakdown (names only, no internal IDs)
  const fundMap = new Map(funds.map((f) => [f.id, f.name]));
  const fundIncomeMap = new Map(incomeByFund.map((i) => [i.fundId, i._sum.amount ?? 0n]));
  const fundExpenseMap = new Map(expenseByFund.map((e) => [e.fundId, e._sum.amount ?? 0n]));

  const activeFundIds = new Set([
    ...incomeByFund.map((i) => i.fundId),
    ...expenseByFund.map((e) => e.fundId),
  ]);

  const byFund: TransparencyFundSummary[] = Array.from(activeFundIds).map((fundId) => {
    const fundName = fundMap.get(fundId) ?? "General Fund";
    const inc = fundIncomeMap.get(fundId) ?? 0n;
    const exp = fundExpenseMap.get(fundId) ?? 0n;
    return {
      fundName,
      income: inc.toString(),
      expense: exp.toString(),
      net: (inc - exp).toString(),
    };
  });

  // Build category breakdown (names only, no internal IDs)
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = {
    income: incomeByCategory.map((c) => ({
      categoryName: categoryMap.get(c.categoryId) ?? "General Income",
      total: (c._sum.amount ?? 0n).toString(),
    })),
    expense: expenseByCategory.map((c) => ({
      categoryName: categoryMap.get(c.categoryId) ?? "General Expense",
      total: (c._sum.amount ?? 0n).toString(),
    })),
  };

  return {
    month: monthStr,
    mosque: {
      name: mosque.name,
      slug: mosque.slug,
    },
    summary: {
      totalIncome: totalIncome.toString(),
      totalExpense: totalExpense.toString(),
      netSavings: netSavings.toString(),
    },
    byFund,
    byCategory,
  };
}

/**
 * Confirms receipt authenticity by verification code or receipt number.
 *
 * Privacy guarantees:
 *  - Confirms receipt is genuine.
 *  - Returns mosque, date, amount, and fund.
 *  - Absolutely NO donor details (donorName, phone, email, memberId, accountId are strictly omitted).
 *
 * @param verificationCode - Verification code (VC-...) or receipt number (RCP-...)
 */
export async function verifyDonationReceipt(
  verificationCode: string,
): Promise<PublicReceiptVerification> {
  const normalized = verificationCode.trim().toUpperCase();

  const donation = await prisma.donation.findFirst({
    where: {
      OR: [
        { verificationCode: normalized },
        { receiptNumber: normalized },
      ],
      status: DonationStatus.POSTED,
    },
    include: {
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          isArchived: true,
        },
      },
      fund: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!donation || donation.mosque.isArchived) {
    throw HttpError.notFound(
      "Receipt verification failed. The provided receipt or verification code could not be verified as genuine.",
      "RECEIPT_NOT_FOUND",
    );
  }

  return {
    verified: true,
    receiptNumber: donation.receiptNumber ?? "N/A",
    verificationCode: donation.verificationCode ?? normalized,
    date: donation.date,
    amount: {
      raw: donation.amount.toString(),
      formatted: (Number(donation.amount) / 100).toFixed(2),
      currency: "BDT",
    },
    fund: {
      name: donation.fund.name,
    },
    mosque: {
      name: donation.mosque.name,
      slug: donation.mosque.slug,
      address: donation.mosque.address,
    },
  };
}
