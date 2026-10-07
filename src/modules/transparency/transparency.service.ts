// =============================================================================
// Transparency Module — Business Logic & Privacy-Safe Queries
//
// Design notes:
//  • Public-facing transparency services that enforce complete data minimisation.
//  • Existence-hiding posture: Disabled transparency returns generic 404 (not 403).
//  • Campaign endpoints compute raised amounts live from POSTED donations.
//  • Anonymous-flagged donors are strictly omitted from donor listings.
//  • Transparency reports provide totals only; individual transaction records
//    are never exposed.
//  • Receipt verification confirms authenticity without leaking donor identities.
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  CampaignStatus,
  DonationStatus,
  ExpenseStatus,
} from "../../../generated/prisma/client.js";
import { validateTransparencyMonthQuery } from "./transparency.validation.js";

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface PublicCampaignSummary {
  id: string;
  title: string;
  description: string | null;
  targetAmount: string | null;
  raisedAmount: string;
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
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Lists public fundraising campaigns for a mosque by slug.
 *
 * Privacy guarantees:
 *  - Strips all internal IDs (no internal member, user, fund, or account IDs).
 *  - Excludes all donor identities.
 *  - Raised amount is aggregated live from POSTED donations.
 *
 * @param slug - Mosque URL slug
 */
export async function getPublicCampaigns(slug: string): Promise<PublicCampaignSummary[]> {
  const mosque = await prisma.mosque.findUnique({
    where: { slug },
    select: { id: true, isArchived: true },
  });

  if (!mosque || mosque.isArchived) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  const campaigns = await prisma.campaign.findMany({
    where: {
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
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });

  if (campaigns.length === 0) {
    return [];
  }

  const campaignIds = campaigns.map((c) => c.id);

  // Efficient batch aggregation across all public campaigns
  const aggregations = await prisma.donation.groupBy({
    by: ["campaignId"],
    where: {
      campaignId: { in: campaignIds },
      status: DonationStatus.POSTED,
    },
    _sum: { amount: true },
  });

  const raisedMap = new Map<string, bigint>();
  for (const agg of aggregations) {
    if (agg.campaignId) {
      raisedMap.set(agg.campaignId, agg._sum.amount ?? 0n);
    }
  }

  return campaigns.map((c) => {
    const raised = raisedMap.get(c.id) ?? 0n;
    let percentage: number | null = null;
    if (c.targetAmount && c.targetAmount > 0n) {
      const pct = Number((raised * 10000n) / c.targetAmount) / 100;
      percentage = Math.min(100, Math.round(pct * 100) / 100);
    }

    return {
      id: c.id,
      title: c.title,
      description: c.description ?? null,
      targetAmount: c.targetAmount ? c.targetAmount.toString() : null,
      raisedAmount: raised.toString(),
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
  const mosque = await prisma.mosque.findUnique({
    where: { slug },
    select: { id: true, isArchived: true },
  });

  if (!mosque || mosque.isArchived) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

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

  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description ?? null,
    targetAmount: campaign.targetAmount ? campaign.targetAmount.toString() : null,
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
 *  - Only accessible if mosque has enabled `publicTransparency`.
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
  const mosque = await prisma.mosque.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      publicTransparency: true,
      isArchived: true,
    },
  });

  // Existence-hiding security posture: generic 404 if not found, archived, or transparency disabled
  if (!mosque || mosque.isArchived || !mosque.publicTransparency) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

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

