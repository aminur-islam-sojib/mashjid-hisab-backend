// =============================================================================
// Campaign Service — Fundraising Campaign Business Logic
//
// Design notes:
//  • raisedAmount is always computed live from the POSTED donations linked
//    to a campaign — never stored as a mutable field — so it stays in sync
//    with the double-entry ledger automatically.
//  • Progress percentage is capped at 100 % for display; the raw raisedAmount
//    is also returned so the client can show the overflow if desired.
//  • Anonymous donors: the donor list endpoint redacts identifiers unless the
//    caller holds MOSQUE_ADMIN or TREASURER.
//  • Fund locking: once a donation is linked (campaignId set) the fundId on
//    the campaign becomes immutable. The guard is at update time.
//  • Campaign close is idempotent-safe: closing an already-closed campaign
//    returns 409 CAMPAIGN_ALREADY_CLOSED.
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  CampaignStatus,
  DonationStatus,
  MembershipStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
  CloseCampaignInput,
  GetCampaignsQueryInput,
} from "./campaign.validation.js";

// ---------------------------------------------------------------------------
// Public-facing response types
// ---------------------------------------------------------------------------

export interface CampaignActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

export interface CampaignFundInfo {
  id: string;
  name: string;
  type: string;
  isRestricted: boolean;
}

export interface CampaignProgress {
  raisedAmount: string;     // in poisha — always live from the ledger
  targetAmount: string | null;
  progressPercent: number | null; // null when targetAmount is null
  donorCount: number;
}

export interface CampaignResponseItem {
  id: string;
  mosqueId: string;
  fundId: string;
  fund: CampaignFundInfo;
  title: string;
  description: string | null;
  targetAmount: string | null;
  startDate: Date;
  endDate: Date | null;
  isPublic: boolean;
  status: CampaignStatus;
  closedAt: Date | null;
  closedBy: { id: string; name: string } | null;
  progress: CampaignProgress;
  createdById: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignDonorEntry {
  donorLabel: string;          // "Anonymous" when hidden
  donorType: "MEMBER" | "FAMILY" | "WALK_IN" | "ANONYMOUS";
  memberId: string | null;     // null when redacted
  familyId: string | null;     // null when redacted
  totalAmount: string;         // sum of POSTED donations for this donor
  donationCount: number;
  lastDonationDate: Date | null;
}

export interface CampaignDonorListResult {
  data: CampaignDonorEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CampaignListResult {
  data: CampaignResponseItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Standard Prisma include for campaign queries */
const CAMPAIGN_DEFAULT_INCLUDE = {
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  createdBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
} as const;

/**
 * Aggregates POSTED donations for a campaign and returns progress metrics.
 * Uses a single Prisma aggregate call for efficiency.
 */
async function computeCampaignProgress(
  campaignId: string,
  targetAmount: bigint | null,
): Promise<CampaignProgress> {
  const [aggregate, donorCount] = await Promise.all([
    prisma.donation.aggregate({
      where: { campaignId, status: DonationStatus.POSTED },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.donation.findMany({
      where: { campaignId, status: DonationStatus.POSTED },
      select: { memberId: true, familyId: true, donorName: true },
      distinct: ["memberId", "familyId", "donorName"],
    }),
  ]);

  const raised = aggregate._sum.amount ?? 0n;
  const raisedStr = raised.toString();
  const targetStr = targetAmount ? targetAmount.toString() : null;

  let progressPercent: number | null = null;
  if (targetAmount && targetAmount > 0n) {
    const pct = Number((raised * 10000n) / targetAmount) / 100;
    progressPercent = Math.min(100, Math.round(pct * 100) / 100);
  }

  return {
    raisedAmount: raisedStr,
    targetAmount: targetStr,
    progressPercent,
    donorCount: donorCount.length,
  };
}

/**
 * Maps a raw Prisma campaign record to the public response shape.
 * Progress must be pre-computed and passed in.
 */
function mapCampaignResponse(
  campaign: any,
  progress: CampaignProgress,
): CampaignResponseItem {
  return {
    id: campaign.id,
    mosqueId: campaign.mosqueId,
    fundId: campaign.fundId,
    fund: {
      id: campaign.fund.id,
      name: campaign.fund.name,
      type: campaign.fund.type,
      isRestricted: campaign.fund.isRestricted,
    },
    title: campaign.title,
    description: campaign.description ?? null,
    targetAmount: campaign.targetAmount ? campaign.targetAmount.toString() : null,
    startDate: campaign.startDate,
    endDate: campaign.endDate ?? null,
    isPublic: campaign.isPublic,
    status: campaign.status,
    closedAt: campaign.closedAt ?? null,
    closedBy: campaign.closedBy
      ? { id: campaign.closedBy.id, name: campaign.closedBy.name }
      : null,
    progress,
    createdById: campaign.createdById ?? null,
    createdBy: campaign.createdBy
      ? { id: campaign.createdBy.id, name: campaign.createdBy.name }
      : null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

/**
 * Validates that the Fund exists, belongs to this mosque, and is not archived.
 */
async function validateCampaignFund(
  tx: Prisma.TransactionClient,
  mosqueId: string,
  fundId: string,
): Promise<void> {
  const fund = await tx.fund.findFirst({
    where: { id: fundId, mosqueId },
    select: { id: true, isArchived: true },
  });

  if (!fund) {
    throw HttpError.notFound("Fund not found in this mosque.", "FUND_NOT_FOUND");
  }

  if (fund.isArchived) {
    throw HttpError.badRequest(
      "Cannot create a campaign for an archived fund.",
      "FUND_ARCHIVED",
    );
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Creates a new fundraising campaign.
 *
 * Authorization: MOSQUE_ADMIN only.
 * Validates: fund exists, not archived, belongs to this mosque.
 */
export async function createCampaign(
  mosqueId: string,
  input: CreateCampaignInput,
  actor: CampaignActor,
): Promise<CampaignResponseItem> {
  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN can create campaigns.",
      "FORBIDDEN_ROLE",
    );
  }

  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const campaign = await prisma.$transaction(async (tx) => {
    await validateCampaignFund(tx, resolvedMosqueId, input.fundId);

    return tx.campaign.create({
      data: {
        mosqueId: resolvedMosqueId,
        fundId: input.fundId,
        title: input.title,
        description: input.description ?? null,
        targetAmount: input.targetAmount ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        isPublic: input.isPublic,
        status: CampaignStatus.ACTIVE,
        createdById: actor.userId,
      },
      include: CAMPAIGN_DEFAULT_INCLUDE,
    });
  }).catch((err) => {
    if (
      err?.code === "P2002" ||
      (err?.message && err.message.includes("campaigns_mosqueId_title"))
    ) {
      throw HttpError.conflict(
        `A campaign with the title '${input.title}' already exists in this mosque.`,
        "CAMPAIGN_TITLE_CONFLICT",
      );
    }
    throw err;
  });

  const progress = await computeCampaignProgress(campaign.id, campaign.targetAmount);
  return mapCampaignResponse(campaign, progress);
}

/**
 * Retrieves a paginated list of campaigns for a mosque.
 *
 * Authorization: Any ACTIVE member. Non-oversight roles see only public campaigns.
 */
export async function getCampaigns(
  mosqueId: string,
  query: GetCampaignsQueryInput,
  actor: CampaignActor,
): Promise<CampaignListResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  // Build the where clause
  const where: Prisma.CampaignWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    // Non-oversight roles can only see public campaigns
    ...(!isOversight ? { isPublic: true } : {}),
    // If caller explicitly filters isPublic, honour it (but oversight only)
    ...(isOversight && query.isPublic !== undefined ? { isPublic: query.isPublic } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" as Prisma.QueryMode } },
            { description: { contains: query.search, mode: "insensitive" as Prisma.QueryMode } },
          ],
        }
      : {}),
  };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: CAMPAIGN_DEFAULT_INCLUDE,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.campaign.count({ where }),
  ]);

  // Batch-compute progress for all campaigns concurrently
  const progressList = await Promise.all(
    campaigns.map((c) => computeCampaignProgress(c.id, c.targetAmount)),
  );

  const data = campaigns.map((c, i) => mapCampaignResponse(c, progressList[i]!));

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
 * Returns full details and live progress for a single campaign.
 *
 * Authorization: Any ACTIVE member. Non-oversight roles are blocked from
 * non-public campaigns (returns 404 to avoid leaking existence).
 */
export async function getCampaignById(
  mosqueId: string,
  campaignId: string,
  actor: CampaignActor,
): Promise<CampaignResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      mosqueId: resolvedMosqueId,
      // Non-oversight members can only see public campaigns
      ...(!isOversight ? { isPublic: true } : {}),
    },
    include: CAMPAIGN_DEFAULT_INCLUDE,
  });

  if (!campaign) {
    throw HttpError.notFound("Campaign not found.", "CAMPAIGN_NOT_FOUND");
  }

  const progress = await computeCampaignProgress(campaign.id, campaign.targetAmount);
  return mapCampaignResponse(campaign, progress);
}

/**
 * Returns the donor list for a campaign with aggregated totals.
 *
 * Authorization: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER.
 * Anonymous donors: the donorLabel is "Anonymous" and memberId/familyId are
 * null UNLESS the caller is MOSQUE_ADMIN or TREASURER.
 */
export async function getCampaignDonors(
  mosqueId: string,
  campaignId: string,
  actor: CampaignActor,
  query: { page?: number; limit?: number } = {},
): Promise<CampaignDonorListResult> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;

  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view the campaign donor list.",
      "FORBIDDEN_ROLE",
    );
  }

  // Verify the campaign exists in this mosque
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, mosqueId: resolvedMosqueId },
    select: { id: true, title: true },
  });

  if (!campaign) {
    throw HttpError.notFound("Campaign not found.", "CAMPAIGN_NOT_FOUND");
  }

  const canSeeIdentity =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;

  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 100);

  // Fetch all POSTED donations for this campaign
  const donations = await prisma.donation.findMany({
    where: { campaignId, mosqueId: resolvedMosqueId, status: DonationStatus.POSTED },
    select: {
      id: true,
      amount: true,
      date: true,
      memberId: true,
      familyId: true,
      donorName: true,
      isAnonymousPublic: true,
      member: { select: { id: true, user: { select: { name: true } } } },
      family: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  });

  // Group donations by donor identity bucket
  type DonorKey = string;
  interface DonorBucket {
    donorLabel: string;
    donorType: CampaignDonorEntry["donorType"];
    memberId: string | null;
    familyId: string | null;
    totalAmount: bigint;
    donationCount: number;
    lastDonationDate: Date | null;
  }

  const buckets = new Map<DonorKey, DonorBucket>();

  for (const d of donations) {
    let key: DonorKey;
    let donorLabel: string;
    let donorType: CampaignDonorEntry["donorType"];
    let memberId: string | null = null;
    let familyId: string | null = null;

    if (d.isAnonymousPublic) {
      key = "ANON";
      donorLabel = "Anonymous";
      donorType = "ANONYMOUS";
    } else if (d.memberId) {
      key = `MEMBER:${d.memberId}`;
      donorLabel = canSeeIdentity
        ? (d.member?.user?.name ?? d.donorName ?? "Member")
        : "Member";
      donorType = "MEMBER";
      memberId = canSeeIdentity ? d.memberId : null;
    } else if (d.familyId) {
      key = `FAMILY:${d.familyId}`;
      donorLabel = canSeeIdentity
        ? (d.family?.name ? `${d.family.name} Household` : d.donorName ?? "Family")
        : "Family";
      donorType = "FAMILY";
      familyId = canSeeIdentity ? d.familyId : null;
    } else {
      // Walk-in — bucket by normalised donor name
      const nameKey = d.donorName?.toLowerCase().trim() ?? "walk-in";
      key = `WALKIN:${nameKey}`;
      donorLabel = canSeeIdentity ? (d.donorName ?? "Walk-in Donor") : "Walk-in Donor";
      donorType = "WALK_IN";
    }

    const existing = buckets.get(key);
    if (existing) {
      existing.totalAmount += d.amount;
      existing.donationCount += 1;
      if (d.date && (!existing.lastDonationDate || d.date > existing.lastDonationDate)) {
        existing.lastDonationDate = d.date;
      }
    } else {
      buckets.set(key, {
        donorLabel,
        donorType,
        memberId,
        familyId,
        totalAmount: d.amount,
        donationCount: 1,
        lastDonationDate: d.date ?? null,
      });
    }
  }

  // Convert to array sorted by totalAmount descending (top contributors first)
  const allEntries: CampaignDonorEntry[] = Array.from(buckets.values())
    .sort((a, b) => {
      if (b.totalAmount > a.totalAmount) return 1;
      if (b.totalAmount < a.totalAmount) return -1;
      return 0;
    })
    .map((b) => ({
      donorLabel: b.donorLabel,
      donorType: b.donorType,
      memberId: b.memberId,
      familyId: b.familyId,
      totalAmount: b.totalAmount.toString(),
      donationCount: b.donationCount,
      lastDonationDate: b.lastDonationDate,
    }));

  const total = allEntries.length;
  const skip = (page - 1) * limit;
  const data = allEntries.slice(skip, skip + limit);

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
 * Updates non-financial campaign metadata.
 *
 * Authorization: MOSQUE_ADMIN only.
 *
 * Constraints:
 *  - Closed campaigns cannot be edited (CAMPAIGN_ALREADY_CLOSED).
 *  - fundId can be changed ONLY when no POSTED donations are linked
 *    (CAMPAIGN_FUND_LOCKED).
 *  - Title uniqueness is enforced by the DB @@unique constraint; P2002 is
 *    caught and re-thrown as CAMPAIGN_TITLE_CONFLICT.
 */
export async function updateCampaign(
  mosqueId: string,
  campaignId: string,
  input: UpdateCampaignInput,
  actor: CampaignActor,
): Promise<CampaignResponseItem> {
  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN can update campaigns.",
      "FORBIDDEN_ROLE",
    );
  }

  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const updated = await prisma.$transaction(async (tx) => {
    // Fetch current state
    const existing = await tx.campaign.findFirst({
      where: { id: campaignId, mosqueId: resolvedMosqueId },
      include: CAMPAIGN_DEFAULT_INCLUDE,
    });

    if (!existing) {
      throw HttpError.notFound("Campaign not found.", "CAMPAIGN_NOT_FOUND");
    }

    if (existing.status === CampaignStatus.CLOSED) {
      throw HttpError.badRequest(
        "Campaign is already closed and cannot be edited. Closed campaigns are read-only.",
        "CAMPAIGN_ALREADY_CLOSED",
      );
    }

    // Fund locking guard
    if (input.fundId && input.fundId !== existing.fundId) {
      const linkedDonationCount = await tx.donation.count({
        where: { campaignId, mosqueId: resolvedMosqueId },
      });

      if (linkedDonationCount > 0) {
        throw HttpError.badRequest(
          `Campaign fund cannot be changed after donations have been recorded. This campaign has ${linkedDonationCount} linked donation(s). Void them first if a correction is truly needed.`,
          "CAMPAIGN_FUND_LOCKED",
        );
      }

      // Validate the new fund
      await validateCampaignFund(tx, resolvedMosqueId, input.fundId);
    }

    // Validate endDate cross-field consistency with existing startDate
    const effectiveStartDate = input.startDate ?? existing.startDate;
    const effectiveEndDate = input.endDate !== undefined ? input.endDate : existing.endDate;
    if (effectiveEndDate && effectiveEndDate < effectiveStartDate) {
      throw HttpError.badRequest("endDate must be on or after startDate.", "INVALID_DATE_RANGE");
    }

    return tx.campaign.update({
      where: { id: campaignId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.targetAmount !== undefined ? { targetAmount: input.targetAmount } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.fundId !== undefined ? { fundId: input.fundId } : {}),
      },
      include: CAMPAIGN_DEFAULT_INCLUDE,
    });
  }).catch((err) => {
    if (
      err?.code === "P2002" ||
      (err?.message && err.message.includes("campaigns_mosqueId_title"))
    ) {
      throw HttpError.conflict(
        `A campaign with the title '${input.title}' already exists in this mosque.`,
        "CAMPAIGN_TITLE_CONFLICT",
      );
    }
    throw err;
  });

  const progress = await computeCampaignProgress(updated.id, updated.targetAmount);
  return mapCampaignResponse(updated, progress);
}

/**
 * Closes a campaign, freezing it from accepting new donations.
 *
 * Authorization: MOSQUE_ADMIN only.
 * Idempotency: calling close on an already-closed campaign returns 409.
 * The final raisedAmount snapshot is captured in the progress field of the
 * response; it will remain accurate as long as no historical donations are
 * later voided (which is intentional — void and re-close if needed).
 */
export async function closeCampaign(
  mosqueId: string,
  campaignId: string,
  input: CloseCampaignInput,
  actor: CampaignActor,
): Promise<CampaignResponseItem> {
  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN can close campaigns.",
      "FORBIDDEN_ROLE",
    );
  }

  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const campaign = await prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { id: campaignId, mosqueId: resolvedMosqueId },
      include: CAMPAIGN_DEFAULT_INCLUDE,
    });

    if (!existing) {
      throw HttpError.notFound("Campaign not found.", "CAMPAIGN_NOT_FOUND");
    }

    if (existing.status === CampaignStatus.CLOSED) {
      throw HttpError.conflict(
        "Campaign is already closed.",
        "CAMPAIGN_ALREADY_CLOSED",
      );
    }

    return tx.campaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.CLOSED,
        closedAt: new Date(),
        closedById: actor.userId,
        // Store optional close reason in the description suffix only if provided
        // (we don't want to overwrite a careful description; use notes pattern instead)
      },
      include: CAMPAIGN_DEFAULT_INCLUDE,
    });
  });

  const progress = await computeCampaignProgress(campaign.id, campaign.targetAmount);
  return mapCampaignResponse(campaign, progress);
}

