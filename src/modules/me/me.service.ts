// =============================================================================
// me.service.ts — Business Logic for Domain 9: Member Self-Service
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  DonationStatus,
  DueStatus,
  PledgeStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  GetMyDonationsQueryInput,
  GetMyDuesQueryInput,
  GetMyPledgesQueryInput,
  GetMyStatementQueryInput,
} from "./me.validation.js";
import { computePledgeFinancials } from "../pledge/pledge.service.js";

export interface MeActor {
  userId: string;
  role: Role;
  membershipId: string;
}

/**
 * GET /me/donations
 * The caller's own donations. A family head also sees family donations (?scope=family).
 */
export async function getMyDonations(
  mosqueId: string,
  query: GetMyDonationsQueryInput,
  actor: MeActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  let whereDonor: Prisma.DonationWhereInput;

  if (query.scope === "family") {
    const headFamily = await prisma.family.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        headMembershipId: actor.membershipId,
      },
    });

    if (!headFamily) {
      throw HttpError.forbidden(
        "Only the head of a family can query family-scoped donations.",
        "NOT_A_FAMILY_HEAD",
      );
    }

    whereDonor = {
      OR: [
        { memberId: actor.membershipId },
        { familyId: headFamily.id },
      ],
    };
  } else {
    whereDonor = {
      memberId: actor.membershipId,
    };
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  let dateFilter: Prisma.DateTimeFilter | undefined;
  if (query.year) {
    const startDate = new Date(Date.UTC(query.year, 0, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999));
    dateFilter = { gte: startDate, lte: endDate };
  }

  const where: Prisma.DonationWhereInput = {
    mosqueId: resolvedMosqueId,
    status: DonationStatus.POSTED,
    ...whereDonor,
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
  };

  const [donations, total] = await Promise.all([
    prisma.donation.findMany({
      where,
      include: {
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true } },
        family: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.donation.count({ where }),
  ]);

  return {
    data: donations.map((d) => ({
      id: d.id,
      amount: d.amount.toString(),
      date: d.date,
      receiptNumber: d.receiptNumber,
      status: d.status,
      source: d.source,
      fund: {
        id: d.fund.id,
        name: d.fund.name,
        type: d.fund.type,
      },
      category: {
        id: d.category.id,
        name: d.category.name,
      },
      donorName: d.donorName,
      family: d.family ? { id: d.family.id, name: d.family.name } : null,
      campaignId: d.campaignId ?? null,
      pledgeId: d.pledgeId ?? null,
      dueId: d.dueId ?? null,
      notes: d.notes ?? null,
    })),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      scope: query.scope,
    },
  };
}

/**
 * GET /me/dues
 * Own or family dues with status and what is owed.
 */
export async function getMyDues(
  mosqueId: string,
  query: GetMyDuesQueryInput,
  actor: MeActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Look up caller's family associations in this mosque
  const [headFamily, linkedMember] = await Promise.all([
    prisma.family.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        headMembershipId: actor.membershipId,
      },
      select: { id: true, name: true },
    }),
    prisma.familyMember.findFirst({
      where: {
        linkedMembershipId: actor.membershipId,
        family: { mosqueId: resolvedMosqueId },
      },
      select: { familyId: true, family: { select: { id: true, name: true } } },
    }),
  ]);

  const familyId = headFamily?.id || linkedMember?.familyId;
  const familyName = headFamily?.name || linkedMember?.family?.name;

  let wherePayer: Prisma.DueWhereInput;

  if (query.scope === "self") {
    wherePayer = { memberId: actor.membershipId };
  } else if (query.scope === "family") {
    if (!familyId) {
      throw HttpError.badRequest(
        "Caller is not associated with any family in this mosque.",
        "NO_FAMILY_ASSOCIATION",
      );
    }
    wherePayer = { familyId };
  } else {
    // Default / "all": returns own dues AND family dues if associated with a family
    if (familyId) {
      wherePayer = {
        OR: [
          { memberId: actor.membershipId },
          { familyId },
        ],
      };
    } else {
      wherePayer = { memberId: actor.membershipId };
    }
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.DueWhereInput = {
    mosqueId: resolvedMosqueId,
    ...wherePayer,
    ...(query.status ? { status: query.status } : {}),
    ...(query.period ? { period: query.period } : {}),
  };

  const [dues, total] = await Promise.all([
    prisma.due.findMany({
      where,
      include: {
        fund: { select: { id: true, name: true, type: true } },
        family: { select: { id: true, name: true } },
        plan: { select: { id: true, frequency: true, status: true, startMonth: true } },
      },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.due.count({ where }),
  ]);

  return {
    data: dues.map((due) => {
      const remainingAmount =
        due.status === DueStatus.WAIVED
          ? 0n
          : due.amount > due.paidAmount
          ? due.amount - due.paidAmount
          : 0n;

      return {
        id: due.id,
        period: due.period,
        amount: due.amount.toString(),
        paidAmount: due.paidAmount.toString(),
        remainingAmount: remainingAmount.toString(),
        status: due.status,
        fund: {
          id: due.fund.id,
          name: due.fund.name,
          type: due.fund.type,
        },
        plan: due.plan
          ? {
              id: due.plan.id,
              frequency: due.plan.frequency,
              status: due.plan.status,
              startMonth: due.plan.startMonth,
            }
          : null,
        family: due.family ? { id: due.family.id, name: due.family.name } : null,
        isOwnDue: due.memberId === actor.membershipId,
        isFamilyDue: due.familyId !== null,
        waivedAt: due.waivedAt ?? null,
        waiveReason: due.waiveReason ?? null,
        createdAt: due.createdAt,
      };
    }),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      familyAssociation: familyId ? { id: familyId, name: familyName } : null,
    },
  };
}

/**
 * GET /me/pledges
 * Own pledges and progress.
 */
export async function getMyPledges(
  mosqueId: string,
  query: GetMyPledgesQueryInput,
  actor: MeActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  let wherePledger: Prisma.PledgeWhereInput;

  if (query.scope === "family") {
    const headFamily = await prisma.family.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        headMembershipId: actor.membershipId,
      },
    });

    if (!headFamily) {
      throw HttpError.forbidden(
        "Only the head of a family can query family-scoped pledges.",
        "NOT_A_FAMILY_HEAD",
      );
    }

    wherePledger = {
      familyId: headFamily.id,
    };
  } else {
    wherePledger = {
      memberId: actor.membershipId,
    };
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PledgeWhereInput = {
    mosqueId: resolvedMosqueId,
    ...wherePledger,
    ...(query.status ? { status: query.status } : {}),
  };

  const [pledges, total] = await Promise.all([
    prisma.pledge.findMany({
      where,
      include: {
        fund: { select: { id: true, name: true, type: true } },
        campaign: { select: { id: true, title: true } },
        family: { select: { id: true, name: true } },
        donations: {
          where: { status: DonationStatus.POSTED },
          select: {
            id: true,
            amount: true,
            receiptNumber: true,
            date: true,
          },
          orderBy: { date: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.pledge.count({ where }),
  ]);

  return {
    data: pledges.map((p) => {
      const financials = computePledgeFinancials(p.amount, p.status, p.donations);
      let installmentAmount: string | null = null;
      if (p.installments && p.installments > 0) {
        installmentAmount = (p.amount / BigInt(p.installments)).toString();
      }

      return {
        id: p.id,
        amount: p.amount.toString(),
        paidAmount: financials.paidAmount,
        remainingAmount: financials.remainingAmount,
        progressPercent: financials.progressPercent,
        status: financials.status,
        dueDate: p.dueDate ?? null,
        installments: p.installments,
        installmentAmount,
        fund: p.fund ? { id: p.fund.id, name: p.fund.name, type: p.fund.type } : null,
        campaign: p.campaign ? { id: p.campaign.id, title: p.campaign.title } : null,
        family: p.family ? { id: p.family.id, name: p.family.name } : null,
        donationsCount: p.donations.length,
        donations: p.donations.map((d) => ({
          id: d.id,
          amount: d.amount.toString(),
          receiptNumber: d.receiptNumber,
          date: d.date,
        })),
        createdAt: p.createdAt,
      };
    }),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      scope: query.scope ?? "self",
    },
  };
}

/**
 * GET /me/statement?year=
 * Annual giving statement (totals per fund) for personal records.
 */
export async function getMyStatement(
  mosqueId: string,
  query: GetMyStatementQueryInput,
  actor: MeActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Year date boundaries (UTC)
  const startDate = new Date(Date.UTC(query.year, 0, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999));

  let whereCriteria: Prisma.DonationWhereInput;
  let familyInfo: { id: string; name: string } | null = null;

  if (query.scope === "family") {
    const headFamily = await prisma.family.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        headMembershipId: actor.membershipId,
      },
      select: { id: true, name: true },
    });

    if (!headFamily) {
      throw HttpError.forbidden(
        "Only the head of a family can generate family-scoped annual giving statements.",
        "NOT_A_FAMILY_HEAD",
      );
    }

    familyInfo = headFamily;
    whereCriteria = {
      OR: [
        { memberId: actor.membershipId },
        { familyId: headFamily.id },
      ],
    };
  } else {
    whereCriteria = {
      memberId: actor.membershipId,
    };
  }

  // Fetch mosque details and caller user profile
  const [mosque, user, donations] = await Promise.all([
    prisma.mosque.findUnique({
      where: { id: resolvedMosqueId },
      select: { id: true, name: true, address: true, timezone: true },
    }),
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, name: true, email: true, phone: true },
    }),
    prisma.donation.findMany({
      where: {
        mosqueId: resolvedMosqueId,
        status: DonationStatus.POSTED,
        date: { gte: startDate, lte: endDate },
        ...whereCriteria,
      },
      include: {
        fund: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  // Aggregate totals per fund
  const fundTotalsMap = new Map<
    string,
    {
      fundId: string;
      fundName: string;
      fundType: string;
      totalAmount: bigint;
      count: number;
    }
  >();
  let totalDonated = 0n;

  for (const d of donations) {
    totalDonated += d.amount;
    const existing = fundTotalsMap.get(d.fundId);
    if (existing) {
      existing.totalAmount += d.amount;
      existing.count += 1;
    } else {
      fundTotalsMap.set(d.fundId, {
        fundId: d.fund.id,
        fundName: d.fund.name,
        fundType: d.fund.type,
        totalAmount: d.amount,
        count: 1,
      });
    }
  }

  const funds = Array.from(fundTotalsMap.values()).map((f) => ({
    fundId: f.fundId,
    fundName: f.fundName,
    fundType: f.fundType,
    totalAmount: f.totalAmount.toString(),
    totalFormatted: (Number(f.totalAmount) / 100).toFixed(2),
    donationCount: f.count,
  }));

  return {
    statement: {
      year: query.year,
      generatedAt: new Date(),
      mosque: {
        id: mosque.id,
        name: mosque.name,
        address: mosque.address ?? null,
      },
      member: {
        membershipId: actor.membershipId,
        userId: user?.id,
        name: user?.name,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
      },
      scope: query.scope,
      family: familyInfo,
      summary: {
        totalDonated: totalDonated.toString(),
        totalFormatted: (Number(totalDonated) / 100).toFixed(2),
        totalDonationsCount: donations.length,
        funds,
      },
      donations: donations.map((d) => ({
        id: d.id,
        receiptNumber: d.receiptNumber,
        date: d.date,
        amount: d.amount.toString(),
        fund: {
          id: d.fund.id,
          name: d.fund.name,
          type: d.fund.type,
        },
        category: {
          id: d.category.id,
          name: d.category.name,
        },
      })),
    },
  };
}
