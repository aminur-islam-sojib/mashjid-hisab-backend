// =============================================================================
// pledge.service.ts — Domain 6: Pledges Business Logic
//
// Design notes:
//  • A Pledge represents a member's commitment to donate towards a Fund or Campaign.
//  • Core financial principle: Recording a pledge creates NO general ledger entry.
//  • Paid amount is computed dynamically by summing all POSTED donations linked
//    to the pledge (taking into account any voided/reversal entries).
//  • Status transitions:
//      OPEN      — paidAmount == 0
//      PARTIAL   — 0 < paidAmount < amount
//      FULFILLED — paidAmount >= amount
//      CANCELLED — Cancelled by pledger or admin; cancels open balance,
//                  prior payments remain intact.
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  PledgeStatus,
  DonationStatus,
  MembershipStatus,
  CampaignStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreatePledgeInput,
  GetPledgesQueryInput,
  CancelPledgeInput,
} from "./pledge.validation.js";

export interface PledgeActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export interface PledgeProgress {
  amount: string;
  paidAmount: string;
  remainingAmount: string;
  progressPercent: number;
  donationsCount: number;
}

export interface LinkedPledgeDonation {
  id: string;
  receiptNumber: string | null;
  amount: string;
  date: Date;
  status: DonationStatus;
  source: string;
  donorName: string | null;
}

export interface PledgeResponseItem {
  id: string;
  mosqueId: string;
  amount: string;
  paidAmount: string;
  remainingAmount: string;
  progressPercent: number;
  status: PledgeStatus;
  dueDate: Date;
  installments: number | null;
  installmentAmount: string | null;
  fundId: string;
  fund: {
    id: string;
    name: string;
    type: string;
    isRestricted?: boolean;
  };
  campaignId: string | null;
  campaign?: {
    id: string;
    title: string;
    status: CampaignStatus;
  } | null;
  memberId: string | null;
  member?: {
    id: string;
    user: {
      id?: string;
      name: string;
      email: string | null;
      phone: string | null;
    };
  } | null;
  familyId: string | null;
  family?: {
    id: string;
    name: string;
  } | null;
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  notes: string | null;
  cancelledAt: Date | null;
  cancelledBy?: {
    id: string;
    name: string;
  } | null;
  cancelReason: string | null;
  createdById: string | null;
  createdBy?: {
    id: string;
    name: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  donations?: LinkedPledgeDonation[];
}

export interface PledgeListResult {
  data: PledgeResponseItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Standard Prisma relation include for Pledge queries
 */
const PLEDGE_DEFAULT_INCLUDE = {
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  campaign: { select: { id: true, title: true, status: true } },
  member: {
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  family: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
} as const;

/**
 * Computes live paid amount and remaining balance for a pledge based on POSTED donations.
 */
export function computePledgeFinancials(
  pledgeAmount: bigint,
  pledgeStatus: PledgeStatus,
  postedDonations: { amount: bigint }[],
) {
  let paid = 0n;
  for (const d of postedDonations) {
    paid += d.amount;
  }
  if (paid < 0n) paid = 0n;

  let remaining = 0n;
  if (pledgeStatus === PledgeStatus.CANCELLED) {
    // Open balance is cancelled
    remaining = 0n;
  } else if (pledgeAmount > paid) {
    remaining = pledgeAmount - paid;
  } else {
    remaining = 0n;
  }

  let progressPercent = 0;
  if (pledgeAmount > 0n) {
    const pct = Number((paid * 10000n) / pledgeAmount) / 100;
    progressPercent = Math.min(100, Math.round(pct * 100) / 100);
  }

  // Determine dynamic status if not explicitly cancelled
  let dynamicStatus = pledgeStatus;
  if (pledgeStatus !== PledgeStatus.CANCELLED) {
    if (paid >= pledgeAmount) {
      dynamicStatus = PledgeStatus.FULFILLED;
    } else if (paid > 0n) {
      dynamicStatus = PledgeStatus.PARTIAL;
    } else {
      dynamicStatus = PledgeStatus.OPEN;
    }
  }

  return {
    paidAmount: paid.toString(),
    remainingAmount: remaining.toString(),
    progressPercent,
    status: dynamicStatus,
  };
}

/**
 * Synchronizes the stored `status` field in the database with the live ledger.
 */
export async function syncPledgeStatus(
  tx: Prisma.TransactionClient,
  pledgeId: string,
): Promise<PledgeStatus> {
  const pledge = await tx.pledge.findUnique({
    where: { id: pledgeId },
    select: { id: true, amount: true, status: true },
  });

  if (!pledge || pledge.status === PledgeStatus.CANCELLED) {
    return pledge ? pledge.status : PledgeStatus.OPEN;
  }

  const aggregate = await tx.donation.aggregate({
    where: { pledgeId, status: DonationStatus.POSTED },
    _sum: { amount: true },
  });

  const paid = aggregate._sum.amount ?? 0n;
  let newStatus: PledgeStatus = PledgeStatus.OPEN;
  if (paid >= pledge.amount) {
    newStatus = PledgeStatus.FULFILLED;
  } else if (paid > 0n) {
    newStatus = PledgeStatus.PARTIAL;
  } else {
    newStatus = PledgeStatus.OPEN;
  }

  if (newStatus !== pledge.status) {
    await tx.pledge.update({
      where: { id: pledgeId },
      data: { status: newStatus },
    });
  }

  return newStatus;
}

/**
 * Maps a Prisma pledge with relations to the public API response.
 */
function mapPledgeResponse(
  pledge: any,
  financials: {
    paidAmount: string;
    remainingAmount: string;
    progressPercent: number;
    status: PledgeStatus;
  },
  donations?: any[],
): PledgeResponseItem {
  let installmentAmount: string | null = null;
  if (pledge.installments && pledge.installments > 0) {
    const perInst = pledge.amount / BigInt(pledge.installments);
    installmentAmount = perInst.toString();
  }

  return {
    id: pledge.id,
    mosqueId: pledge.mosqueId,
    amount: pledge.amount.toString(),
    paidAmount: financials.paidAmount,
    remainingAmount: financials.remainingAmount,
    progressPercent: financials.progressPercent,
    status: financials.status,
    dueDate: pledge.dueDate,
    installments: pledge.installments ?? null,
    installmentAmount,
    fundId: pledge.fundId,
    fund: {
      id: pledge.fund.id,
      name: pledge.fund.name,
      type: pledge.fund.type,
      isRestricted: pledge.fund.isRestricted,
    },
    campaignId: pledge.campaignId ?? null,
    campaign: pledge.campaign
      ? {
          id: pledge.campaign.id,
          title: pledge.campaign.title,
          status: pledge.campaign.status,
        }
      : null,
    memberId: pledge.memberId ?? null,
    member: pledge.member
      ? {
          id: pledge.member.id,
          user: {
            id: pledge.member.user?.id,
            name: pledge.member.user?.name,
            email: pledge.member.user?.email ?? null,
            phone: pledge.member.user?.phone ?? null,
          },
        }
      : null,
    familyId: pledge.familyId ?? null,
    family: pledge.family
      ? {
          id: pledge.family.id,
          name: pledge.family.name,
        }
      : null,
    donorName: pledge.donorName ?? null,
    donorPhone: pledge.donorPhone ?? null,
    donorEmail: pledge.donorEmail ?? null,
    notes: pledge.notes ?? null,
    cancelledAt: pledge.cancelledAt ?? null,
    cancelledBy: pledge.cancelledBy
      ? {
          id: pledge.cancelledBy.id,
          name: pledge.cancelledBy.name,
        }
      : null,
    cancelReason: pledge.cancelReason ?? null,
    createdById: pledge.createdById ?? null,
    createdBy: pledge.createdBy
      ? {
          id: pledge.createdBy.id,
          name: pledge.createdBy.name,
        }
      : null,
    createdAt: pledge.createdAt,
    updatedAt: pledge.updatedAt,
    donations: donations?.map((d) => ({
      id: d.id,
      receiptNumber: d.receiptNumber ?? null,
      amount: d.amount.toString(),
      date: d.date,
      status: d.status,
      source: d.source,
      donorName: d.donorName ?? null,
    })),
  };
}

/**
 * POST /pledges
 * Records a pledge commitment. Creates NO general ledger entry.
 *
 * Rules & Access:
 *  - MEMBER, STAFF, COMMITTEE: Can record pledge for self or own family.
 *  - MOSQUE_ADMIN, TREASURER: Can record pledge for anyone.
 */
export async function createPledge(
  mosqueId: string,
  input: CreatePledgeInput,
  actor: PledgeActor,
): Promise<PledgeResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  // 1. Resolve and validate pledger identity
  let resolvedMemberId = input.memberId ?? null;
  let resolvedFamilyId = input.familyId ?? null;
  let donorName = input.donorName ?? null;
  let donorPhone = input.donorPhone ?? null;
  let donorEmail = input.donorEmail ?? null;

  if (!isFinanceAdmin) {
    // Non-admin can only pledge for self or own family
    const callerMembership = await prisma.membership.findFirst({
      where: {
        userId: actor.userId,
        mosqueId: resolvedMosqueId,
        status: MembershipStatus.ACTIVE,
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        headOfFamily: { select: { id: true, name: true } },
        linkedFamilyMember: { select: { familyId: true } },
      },
    });

    if (!callerMembership) {
      throw HttpError.notFound("Active mosque membership required.", "MEMBERSHIP_NOT_FOUND");
    }

    const callerFamilyId =
      callerMembership.headOfFamily?.id ??
      callerMembership.linkedFamilyMember?.familyId ??
      null;

    if (input.memberId && input.memberId !== callerMembership.id) {
      throw HttpError.forbidden(
        "Members can only create pledges for themselves or their own family.",
        "FORBIDDEN_PLEDGER",
      );
    }

    if (input.familyId && input.familyId !== callerFamilyId) {
      throw HttpError.forbidden(
        "Members can only create pledges for themselves or their own family.",
        "FORBIDDEN_PLEDGER",
      );
    }

    // Default to caller's own memberId if neither was explicitly specified
    if (!resolvedMemberId && !resolvedFamilyId) {
      resolvedMemberId = callerMembership.id;
    }

    if (!donorName) donorName = callerMembership.user.name;
    if (!donorPhone) donorPhone = callerMembership.user.phone;
    if (!donorEmail) donorEmail = callerMembership.user.email;
  } else {
    // Admin or Treasurer can pledge for anyone
    if (resolvedMemberId) {
      const targetMember = await prisma.membership.findFirst({
        where: { id: resolvedMemberId, mosqueId: resolvedMosqueId },
        include: { user: { select: { name: true, phone: true, email: true } } },
      });
      if (!targetMember) {
        throw HttpError.notFound("Target member not found in this mosque.", "MEMBER_NOT_FOUND");
      }
      if (!donorName) donorName = targetMember.user.name;
      if (!donorPhone) donorPhone = targetMember.user.phone;
      if (!donorEmail) donorEmail = targetMember.user.email;
    }

    if (resolvedFamilyId) {
      const targetFamily = await prisma.family.findFirst({
        where: { id: resolvedFamilyId, mosqueId: resolvedMosqueId },
      });
      if (!targetFamily) {
        throw HttpError.notFound("Target family not found in this mosque.", "FAMILY_NOT_FOUND");
      }
      if (!donorName) donorName = `${targetFamily.name} Household`;
    }
  }

  // 2. Resolve and validate Fund & Campaign
  let resolvedFundId = input.fundId ?? null;
  let resolvedCampaignId = input.campaignId ?? null;

  if (resolvedCampaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: resolvedCampaignId, mosqueId: resolvedMosqueId },
    });
    if (!campaign) {
      throw HttpError.notFound("Campaign not found in this mosque.", "CAMPAIGN_NOT_FOUND");
    }
    if (campaign.status === CampaignStatus.CLOSED) {
      throw HttpError.badRequest(
        "Cannot pledge towards a closed campaign.",
        "CAMPAIGN_CLOSED",
      );
    }

    if (resolvedFundId && resolvedFundId !== campaign.fundId) {
      throw HttpError.badRequest(
        "Pledge fund does not match the fund designated for this campaign.",
        "CAMPAIGN_FUND_MISMATCH",
      );
    }

    // Inherit campaign fundId
    resolvedFundId = campaign.fundId;
  }

  if (!resolvedFundId) {
    throw HttpError.badRequest("Fund ID is required.", "FUND_REQUIRED");
  }

  const fund = await prisma.fund.findFirst({
    where: { id: resolvedFundId, mosqueId: resolvedMosqueId },
  });
  if (!fund) {
    throw HttpError.notFound("Fund not found in this mosque.", "FUND_NOT_FOUND");
  }
  if (fund.isArchived) {
    throw HttpError.badRequest("Cannot pledge towards an archived fund.", "FUND_ARCHIVED");
  }

  // 3. Create the Pledge record (no ledger impact)
  const pledge = await prisma.pledge.create({
    data: {
      mosqueId: resolvedMosqueId,
      fundId: resolvedFundId,
      campaignId: resolvedCampaignId,
      amount: input.amount,
      dueDate: input.dueDate,
      installments: input.installments ?? null,
      memberId: resolvedMemberId,
      familyId: resolvedFamilyId,
      donorName,
      donorPhone,
      donorEmail,
      notes: input.notes ?? null,
      status: PledgeStatus.OPEN,
      createdById: actor.userId,
    },
    include: PLEDGE_DEFAULT_INCLUDE,
  });

  const financials = computePledgeFinancials(pledge.amount, pledge.status, []);
  return mapPledgeResponse(pledge, financials, []);
}

/**
 * GET /pledges
 * Lists pledges for a mosque with paid and remaining amounts.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getPledges(
  mosqueId: string,
  query: GetPledgesQueryInput,
  actor: PledgeActor,
): Promise<PledgeListResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view the mosque pledges list.",
      "FORBIDDEN_ROLE",
    );
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PledgeWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    ...(query.campaignId ? { campaignId: query.campaignId } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...(query.familyId ? { familyId: query.familyId } : {}),
    ...(query.dueDateFrom || query.dueDateTo
      ? {
          dueDate: {
            ...(query.dueDateFrom ? { gte: query.dueDateFrom } : {}),
            ...(query.dueDateTo ? { lte: query.dueDateTo } : {}),
          },
        }
      : {}),
    ...(query.donor
      ? {
          OR: [
            { donorName: { contains: query.donor, mode: "insensitive" } },
            { donorPhone: { contains: query.donor, mode: "insensitive" } },
            { donorEmail: { contains: query.donor, mode: "insensitive" } },
            { memberId: query.donor },
          ],
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { donorName: { contains: query.search, mode: "insensitive" } },
            { notes: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [pledges, total] = await Promise.all([
    prisma.pledge.findMany({
      where,
      include: {
        ...PLEDGE_DEFAULT_INCLUDE,
        donations: {
          where: { status: DonationStatus.POSTED },
          select: { amount: true },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.pledge.count({ where }),
  ]);

  const data = pledges.map((p) => {
    const financials = computePledgeFinancials(p.amount, p.status, p.donations);
    return mapPledgeResponse(p, financials);
  });

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * GET /pledges/:id
 * Shows a pledge with all donations that paid it.
 * Access: ADMIN, TREAS, COMM; MEMBER (own or own family only)
 */
export async function getPledgeById(
  mosqueId: string,
  pledgeId: string,
  actor: PledgeActor,
): Promise<PledgeResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const pledge = await prisma.pledge.findFirst({
    where: {
      id: pledgeId,
      mosqueId: resolvedMosqueId,
    },
    include: {
      ...PLEDGE_DEFAULT_INCLUDE,
      donations: {
        where: { status: DonationStatus.POSTED },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          date: true,
          status: true,
          source: true,
          donorName: true,
        },
        orderBy: { date: "desc" },
      },
    },
  });

  if (!pledge) {
    throw HttpError.notFound("Pledge not found.", "PLEDGE_NOT_FOUND");
  }

  // Check authorization
  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    // Non-oversight members can only see their own pledge
    const isOwnPledge =
      (actor.membershipId && pledge.memberId === actor.membershipId) ||
      pledge.member?.userId === actor.userId ||
      pledge.createdById === actor.userId;

    if (!isOwnPledge) {
      // Check family ownership
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

      if (callerFamilyId && pledge.familyId && pledge.familyId === callerFamilyId) {
        isOwnFamily = true;
      }

      if (!isOwnFamily) {
        throw HttpError.forbidden(
          "Access denied. Members can only view their own pledges.",
          "FORBIDDEN",
        );
      }
    }
  }

  const financials = computePledgeFinancials(pledge.amount, pledge.status, pledge.donations);
  return mapPledgeResponse(pledge, financials, pledge.donations);
}

/**
 * POST /pledges/:id/cancel
 * Cancels the open balance of a pledge. Payments already made stay.
 * Access: Pledger or MOSQUE_ADMIN
 */
export async function cancelPledge(
  mosqueId: string,
  pledgeId: string,
  input: CancelPledgeInput,
  actor: PledgeActor,
): Promise<PledgeResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const pledge = await prisma.pledge.findFirst({
    where: {
      id: pledgeId,
      mosqueId: resolvedMosqueId,
    },
    include: {
      ...PLEDGE_DEFAULT_INCLUDE,
      donations: {
        where: { status: DonationStatus.POSTED },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          date: true,
          status: true,
          source: true,
          donorName: true,
        },
      },
    },
  });

  if (!pledge) {
    throw HttpError.notFound("Pledge not found.", "PLEDGE_NOT_FOUND");
  }

  if (pledge.status === PledgeStatus.CANCELLED) {
    throw HttpError.badRequest("Pledge is already cancelled.", "PLEDGE_ALREADY_CANCELLED");
  }

  // Authorization check: Must be MOSQUE_ADMIN or Pledger
  const isAdmin = actor.role === Role.MOSQUE_ADMIN;
  let isPledger =
    (actor.membershipId && pledge.memberId === actor.membershipId) ||
    pledge.member?.userId === actor.userId ||
    pledge.createdById === actor.userId;

  if (!isAdmin && !isPledger) {
    // Check family
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

    if (callerFamilyId && pledge.familyId && pledge.familyId === callerFamilyId) {
      isPledger = true;
    }
  }

  if (!isAdmin && !isPledger) {
    throw HttpError.forbidden(
      "Only the pledger or a mosque admin can cancel this pledge.",
      "FORBIDDEN_CANCELLER",
    );
  }

  // Check if already fulfilled
  let paidSum = 0n;
  for (const d of pledge.donations) {
    paidSum += d.amount;
  }
  if (paidSum >= pledge.amount) {
    throw HttpError.badRequest(
      "Cannot cancel a pledge that has already been fulfilled.",
      "PLEDGE_ALREADY_FULFILLED",
    );
  }

  // Cancel the open balance
  const updated = await prisma.pledge.update({
    where: { id: pledgeId },
    data: {
      status: PledgeStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledById: actor.userId,
      cancelReason: input.reason ?? null,
    },
    include: {
      ...PLEDGE_DEFAULT_INCLUDE,
      donations: {
        where: { status: DonationStatus.POSTED },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          date: true,
          status: true,
          source: true,
          donorName: true,
        },
      },
    },
  });

  const financials = computePledgeFinancials(updated.amount, updated.status, updated.donations);
  return mapPledgeResponse(updated, financials, updated.donations);
}

