// =============================================================================
// chanda.service.ts — Domain 7: Monthly Chanda (Recurring plans & dues) Logic
// =============================================================================

import { prisma, isPrismaP2002 } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  ChandaFrequency,
  ChandaPlanStatus,
  DueStatus,
  DonationStatus,
  MembershipStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import {
  validateDonationFinanceEntities,
  generateNextReceiptNumber,
} from "../donation/donation.service.js";
import type {
  CreateChandaPlanInput,
  GetChandaPlansQueryInput,
  UpdateChandaPlanInput,
  GenerateDuesInput,
  GetDuesQueryInput,
  RecordDuePaymentInput,
  WaiveDueInput,
  GetDuesSummaryQueryInput,
} from "./chanda.validation.js";

export interface ChandaActor {
  userId: string;
  role: Role;
  membershipId?: string;
}

const CHANDA_PLAN_DEFAULT_INCLUDE = {
  fund: { select: { id: true, name: true, type: true, isRestricted: true } },
  family: { select: { id: true, name: true } },
  member: {
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
} as const;

const DUE_DEFAULT_INCLUDE = {
  fund: { select: { id: true, name: true, type: true } },
  family: { select: { id: true, name: true } },
  member: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  plan: { select: { id: true, frequency: true, startMonth: true, status: true } },
  waivedBy: { select: { id: true, name: true } },
} as const;

function mapChandaPlanResponse(plan: any) {
  return {
    id: plan.id,
    mosqueId: plan.mosqueId,
    amount: plan.amount.toString(),
    frequency: plan.frequency,
    startMonth: plan.startMonth,
    status: plan.status,
    fundId: plan.fundId,
    fund: {
      id: plan.fund.id,
      name: plan.fund.name,
      type: plan.fund.type,
      isRestricted: plan.fund.isRestricted,
    },
    familyId: plan.familyId ?? null,
    family: plan.family ? { id: plan.family.id, name: plan.family.name } : null,
    memberId: plan.memberId ?? null,
    member: plan.member
      ? {
          id: plan.member.id,
          user: {
            id: plan.member.user?.id,
            name: plan.member.user?.name,
            email: plan.member.user?.email ?? null,
            phone: plan.member.user?.phone ?? null,
          },
        }
      : null,
    pausedAt: plan.pausedAt ?? null,
    resumedAt: plan.resumedAt ?? null,
    endedAt: plan.endedAt ?? null,
    createdById: plan.createdById ?? null,
    createdBy: plan.createdBy ? { id: plan.createdBy.id, name: plan.createdBy.name } : null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function mapDueResponse(due: any) {
  const remaining =
    due.status === DueStatus.WAIVED
      ? 0n
      : due.amount > due.paidAmount
      ? due.amount - due.paidAmount
      : 0n;

  return {
    id: due.id,
    mosqueId: due.mosqueId,
    planId: due.planId,
    period: due.period,
    amount: due.amount.toString(),
    paidAmount: due.paidAmount.toString(),
    remainingAmount: remaining.toString(),
    status: due.status,
    fundId: due.fundId,
    fund: {
      id: due.fund.id,
      name: due.fund.name,
      type: due.fund.type,
    },
    familyId: due.familyId ?? null,
    family: due.family ? { id: due.family.id, name: due.family.name } : null,
    memberId: due.memberId ?? null,
    member: due.member
      ? {
          id: due.member.id,
          user: {
            id: due.member.user?.id,
            name: due.member.user?.name,
            email: due.member.user?.email ?? null,
            phone: due.member.user?.phone ?? null,
          },
        }
      : null,
    waivedAt: due.waivedAt ?? null,
    waivedBy: due.waivedBy ? { id: due.waivedBy.id, name: due.waivedBy.name } : null,
    waiveReason: due.waiveReason ?? null,
    createdAt: due.createdAt,
    updatedAt: due.updatedAt,
  };
}

/**
 * Resyncs due status and paidAmount by aggregating all POSTED donations linked to it.
 */
export async function syncDueStatus(
  tx: Prisma.TransactionClient,
  dueId: string,
): Promise<DueStatus> {
  const due = await tx.due.findUnique({
    where: { id: dueId },
    select: { id: true, amount: true, status: true },
  });

  if (!due || due.status === DueStatus.WAIVED) {
    return due ? due.status : DueStatus.UNPAID;
  }

  const aggregate = await tx.donation.aggregate({
    where: { dueId, status: DonationStatus.POSTED },
    _sum: { amount: true },
  });

  const paidAmount = aggregate._sum.amount ?? 0n;
  let newStatus: DueStatus = DueStatus.UNPAID;
  if (paidAmount >= due.amount) {
    newStatus = DueStatus.PAID;
  } else if (paidAmount > 0n) {
    newStatus = DueStatus.PARTIAL;
  } else {
    newStatus = DueStatus.UNPAID;
  }

  await tx.due.update({
    where: { id: dueId },
    data: {
      paidAmount,
      status: newStatus,
    },
  });

  return newStatus;
}

// ---------------------------------------------------------------------------
// 1. Chanda Plans
// ---------------------------------------------------------------------------

/**
 * POST /chanda-plans
 * Creates a recurring chanda plan for a family or membership.
 * Access: ADMIN, TREASURER
 */
export async function createChandaPlan(
  mosqueId: string,
  input: CreateChandaPlanInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can create chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  // 1. Validate Fund
  const fund = await prisma.fund.findFirst({
    where: { id: input.fundId, mosqueId: resolvedMosqueId },
  });
  if (!fund) {
    throw HttpError.notFound("Fund not found in this mosque.", "FUND_NOT_FOUND");
  }
  if (fund.isArchived) {
    throw HttpError.badRequest("Cannot create a plan for an archived fund.", "FUND_ARCHIVED");
  }

  // 2. Validate Payer & check invariant: Only one active plan per payer per fund
  if (input.familyId) {
    const family = await prisma.family.findFirst({
      where: { id: input.familyId, mosqueId: resolvedMosqueId },
    });
    if (!family) {
      throw HttpError.notFound("Family household not found in this mosque.", "FAMILY_NOT_FOUND");
    }

    const existingActive = await prisma.chandaPlan.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        fundId: input.fundId,
        familyId: input.familyId,
        status: ChandaPlanStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw HttpError.conflict(
        "Only one active plan per payer per fund is allowed. An active plan already exists for this family in this fund.",
        "ACTIVE_PLAN_EXISTS",
      );
    }
  }

  if (input.memberId) {
    const member = await prisma.membership.findFirst({
      where: { id: input.memberId, mosqueId: resolvedMosqueId },
    });
    if (!member) {
      throw HttpError.notFound("Member not found in this mosque.", "MEMBER_NOT_FOUND");
    }
    if (member.status !== MembershipStatus.ACTIVE) {
      throw HttpError.badRequest("Cannot create a chanda plan for an inactive member.", "INACTIVE_MEMBER");
    }

    const existingActive = await prisma.chandaPlan.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        fundId: input.fundId,
        memberId: input.memberId,
        status: ChandaPlanStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw HttpError.conflict(
        "Only one active plan per payer per fund is allowed. An active plan already exists for this member in this fund.",
        "ACTIVE_PLAN_EXISTS",
      );
    }
  }

  const plan = await prisma.chandaPlan.create({
    data: {
      mosqueId: resolvedMosqueId,
      fundId: input.fundId,
      amount: input.amount,
      frequency: input.frequency,
      startMonth: input.startMonth,
      familyId: input.familyId ?? null,
      memberId: input.memberId ?? null,
      status: ChandaPlanStatus.ACTIVE,
      createdById: actor.userId,
    },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  return mapChandaPlanResponse(plan);
}

/**
 * GET /chanda-plans
 * Lists chanda plans. Filter by family, member, status, or fund.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getChandaPlans(
  mosqueId: string,
  query: GetChandaPlansQueryInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.ChandaPlanWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    ...(query.familyId ? { familyId: query.familyId } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...(query.frequency ? { frequency: query.frequency } : {}),
  };

  const [plans, total] = await Promise.all([
    prisma.chandaPlan.findMany({
      where,
      include: CHANDA_PLAN_DEFAULT_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.chandaPlan.count({ where }),
  ]);

  return {
    data: plans.map(mapChandaPlanResponse),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * GET /chanda-plans/:id
 * Fetches a single chanda plan by ID.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getChandaPlanById(
  mosqueId: string,
  planId: string,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const plan = await prisma.chandaPlan.findFirst({
    where: { id: planId, mosqueId: resolvedMosqueId },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  if (!plan) {
    throw HttpError.notFound("Chanda plan not found.", "PLAN_NOT_FOUND");
  }

  return mapChandaPlanResponse(plan);
}

/**
 * PATCH /chanda-plans/:id
 * Changes the plan amount. Applies to future periods; already generated dues are untouched.
 * Access: ADMIN, TREASURER
 */
export async function updateChandaPlan(
  mosqueId: string,
  planId: string,
  input: UpdateChandaPlanInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can update chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const plan = await prisma.chandaPlan.findFirst({
    where: { id: planId, mosqueId: resolvedMosqueId },
  });
  if (!plan) {
    throw HttpError.notFound("Chanda plan not found.", "PLAN_NOT_FOUND");
  }

  if (plan.status === ChandaPlanStatus.ENDED) {
    throw HttpError.badRequest("Cannot update an ended chanda plan.", "PLAN_ENDED");
  }

  const updated = await prisma.chandaPlan.update({
    where: { id: planId },
    data: { amount: input.amount },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  return mapChandaPlanResponse(updated);
}

/**
 * POST /chanda-plans/:id/pause
 * Skips dues generation until resumed.
 * Access: ADMIN, TREASURER
 */
export async function pauseChandaPlan(
  mosqueId: string,
  planId: string,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can pause chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const plan = await prisma.chandaPlan.findFirst({
    where: { id: planId, mosqueId: resolvedMosqueId },
  });
  if (!plan) {
    throw HttpError.notFound("Chanda plan not found.", "PLAN_NOT_FOUND");
  }

  if (plan.status === ChandaPlanStatus.ENDED) {
    throw HttpError.badRequest("Cannot pause an ended chanda plan.", "PLAN_ENDED");
  }

  if (plan.status === ChandaPlanStatus.PAUSED) {
    throw HttpError.badRequest("Chanda plan is already paused.", "PLAN_ALREADY_PAUSED");
  }

  const updated = await prisma.chandaPlan.update({
    where: { id: planId },
    data: {
      status: ChandaPlanStatus.PAUSED,
      pausedAt: new Date(),
    },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  return mapChandaPlanResponse(updated);
}

/**
 * POST /chanda-plans/:id/resume
 * Resumes dues generation.
 * Access: ADMIN, TREASURER
 */
export async function resumeChandaPlan(
  mosqueId: string,
  planId: string,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can resume chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const plan = await prisma.chandaPlan.findFirst({
    where: { id: planId, mosqueId: resolvedMosqueId },
  });
  if (!plan) {
    throw HttpError.notFound("Chanda plan not found.", "PLAN_NOT_FOUND");
  }

  if (plan.status === ChandaPlanStatus.ENDED) {
    throw HttpError.badRequest("Cannot resume an ended chanda plan.", "PLAN_ENDED");
  }

  if (plan.status === ChandaPlanStatus.ACTIVE) {
    throw HttpError.badRequest("Chanda plan is already active.", "PLAN_ALREADY_ACTIVE");
  }

  // Ensure no conflicting active plan exists
  if (plan.familyId) {
    const existingActive = await prisma.chandaPlan.findFirst({
      where: {
        id: { not: plan.id },
        mosqueId: resolvedMosqueId,
        fundId: plan.fundId,
        familyId: plan.familyId,
        status: ChandaPlanStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw HttpError.conflict(
        "Another active plan already exists for this family in this fund. End or pause it before resuming this plan.",
        "ACTIVE_PLAN_EXISTS",
      );
    }
  }

  if (plan.memberId) {
    const existingActive = await prisma.chandaPlan.findFirst({
      where: {
        id: { not: plan.id },
        mosqueId: resolvedMosqueId,
        fundId: plan.fundId,
        memberId: plan.memberId,
        status: ChandaPlanStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw HttpError.conflict(
        "Another active plan already exists for this member in this fund. End or pause it before resuming this plan.",
        "ACTIVE_PLAN_EXISTS",
      );
    }
  }

  const updated = await prisma.chandaPlan.update({
    where: { id: planId },
    data: {
      status: ChandaPlanStatus.ACTIVE,
      resumedAt: new Date(),
    },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  return mapChandaPlanResponse(updated);
}

/**
 * POST /chanda-plans/:id/end
 * Ends the plan. Unpaid dues stay collectable.
 * Access: ADMIN, TREASURER
 */
export async function endChandaPlan(
  mosqueId: string,
  planId: string,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can end chanda plans.",
      "FORBIDDEN_ROLE",
    );
  }

  const plan = await prisma.chandaPlan.findFirst({
    where: { id: planId, mosqueId: resolvedMosqueId },
  });
  if (!plan) {
    throw HttpError.notFound("Chanda plan not found.", "PLAN_NOT_FOUND");
  }

  if (plan.status === ChandaPlanStatus.ENDED) {
    throw HttpError.badRequest("Chanda plan is already ended.", "PLAN_ALREADY_ENDED");
  }

  const updated = await prisma.chandaPlan.update({
    where: { id: planId },
    data: {
      status: ChandaPlanStatus.ENDED,
      endedAt: new Date(),
    },
    include: CHANDA_PLAN_DEFAULT_INCLUDE,
  });

  return mapChandaPlanResponse(updated);
}

// ---------------------------------------------------------------------------
// 2. Dues Generation & Operations
// ---------------------------------------------------------------------------

/**
 * POST /dues/generate
 * Creates dues for a given month from all active plans. Idempotent per (plan, period).
 * Access: ADMIN, TREASURER (or system cron)
 */
export async function generateDues(
  mosqueId: string,
  input: GenerateDuesInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isFinanceAdmin =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  if (!isFinanceAdmin) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN and TREASURER can generate dues.",
      "FORBIDDEN_ROLE",
    );
  }

  const period = input.period;
  const targetMonthNum = period.split("-")[1]; // e.g. "07"

  // Fetch all ACTIVE plans for this mosque
  const activePlans = await prisma.chandaPlan.findMany({
    where: {
      mosqueId: resolvedMosqueId,
      status: ChandaPlanStatus.ACTIVE,
    },
    include: { fund: true },
  });

  let generatedCount = 0;
  let skippedCount = 0;
  const generatedDues: any[] = [];

  for (const plan of activePlans) {
    // 1. Period boundary check: cannot generate dues before plan startMonth
    if (plan.startMonth > period) {
      skippedCount++;
      continue;
    }

    // 2. Yearly frequency anniversary check
    if (plan.frequency === ChandaFrequency.YEARLY) {
      const planStartMonthNum = plan.startMonth.split("-")[1];
      if (planStartMonthNum !== targetMonthNum) {
        skippedCount++;
        continue;
      }
    }

    // 3. Idempotency check: does a due already exist for (planId, period)?
    const existingDue = await prisma.due.findUnique({
      where: {
        planId_period: {
          planId: plan.id,
          period,
        },
      },
    });

    if (existingDue) {
      skippedCount++;
      continue;
    }

    // 4. Create new due
    const createdDue = await prisma.due.create({
      data: {
        mosqueId: resolvedMosqueId,
        planId: plan.id,
        fundId: plan.fundId,
        familyId: plan.familyId,
        memberId: plan.memberId,
        period,
        amount: plan.amount,
        paidAmount: 0n,
        status: DueStatus.UNPAID,
      },
      include: DUE_DEFAULT_INCLUDE,
    });

    generatedCount++;
    generatedDues.push(mapDueResponse(createdDue));
  }

  return {
    period,
    generatedCount,
    skippedCount,
    totalActivePlans: activePlans.length,
    dues: generatedDues,
  };
}

/**
 * GET /dues
 * Filters: period, status, familyId, memberId, fundId, planId.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getDues(
  mosqueId: string,
  query: GetDuesQueryInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view dues.",
      "FORBIDDEN_ROLE",
    );
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.DueWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(query.period ? { period: query.period } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.familyId ? { familyId: query.familyId } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    ...(query.planId ? { planId: query.planId } : {}),
  };

  const [dues, total] = await Promise.all([
    prisma.due.findMany({
      where,
      include: DUE_DEFAULT_INCLUDE,
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.due.count({ where }),
  ]);

  return {
    data: dues.map(mapDueResponse),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * GET /dues/:id
 * Fetches a single due record by ID along with its payment donation history.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getDueById(
  mosqueId: string,
  dueId: string,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view dues.",
      "FORBIDDEN_ROLE",
    );
  }

  const due = await prisma.due.findFirst({
    where: { id: dueId, mosqueId: resolvedMosqueId },
    include: {
      ...DUE_DEFAULT_INCLUDE,
      donations: {
        select: {
          id: true,
          amount: true,
          status: true,
          receiptNumber: true,
          date: true,
        },
        orderBy: { date: "desc" },
      },
    },
  });

  if (!due) {
    throw HttpError.notFound("Due not found.", "DUE_NOT_FOUND");
  }

  const res = mapDueResponse(due);
  return {
    ...res,
    donations: due.donations.map((d: any) => ({
      ...d,
      amount: d.amount.toString(),
    })),
  };
}

/**
 * POST /dues/:id/payments
 * Records a payment against a due. Creates a donation entry linked to it.
 * Overpayment is strictly rejected. Partial payment is allowed.
 * Access: ADMIN, TREASURER (posts immediately); STAFF (saved as PENDING).
 */
export async function recordDuePayment(
  mosqueId: string,
  dueId: string,
  input: RecordDuePaymentInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isPoster =
    actor.role === Role.MOSQUE_ADMIN || actor.role === Role.TREASURER;
  const isStaff = actor.role === Role.STAFF;

  if (!isPoster && !isStaff) {
    throw HttpError.forbidden(
      `Access denied. Role '${actor.role}' cannot record due payments.`,
      "FORBIDDEN_ROLE",
    );
  }

  const due = await prisma.due.findFirst({
    where: { id: dueId, mosqueId: resolvedMosqueId },
    include: DUE_DEFAULT_INCLUDE,
  });

  if (!due) {
    throw HttpError.notFound("Due not found in this mosque.", "DUE_NOT_FOUND");
  }

  if (due.status === DueStatus.WAIVED) {
    throw HttpError.badRequest("Cannot accept payment on a waived due.", "DUE_WAIVED");
  }

  if (due.status === DueStatus.PAID) {
    throw HttpError.badRequest("Due is already fully paid.", "DUE_ALREADY_PAID");
  }

  const remaining = due.amount - due.paidAmount;
  if (input.amount > remaining) {
    throw HttpError.badRequest(
      `Payment amount (${input.amount}) exceeds remaining due balance of ${remaining}. Overpayment is not allowed.`,
      "OVERPAYMENT_NOT_ALLOWED",
    );
  }

  const paymentDate = input.date ?? new Date();

  // Validate Account and Category against due.fundId
  const result = await prisma.$transaction(async (tx) => {
    await validateDonationFinanceEntities(
      tx,
      resolvedMosqueId,
      input.accountId,
      due.fundId,
      input.categoryId,
    );

    let status: DonationStatus = DonationStatus.PENDING;
    let receiptNumber: string | null = null;
    let postedById: string | null = null;
    let postedAt: Date | null = null;

    if (isPoster) {
      status = DonationStatus.POSTED;
      receiptNumber = await generateNextReceiptNumber(
        tx,
        resolvedMosqueId,
        paymentDate.getFullYear(),
      );
      postedById = actor.userId;
      postedAt = new Date();
    }

    const donorName =
      due.member?.user?.name ??
      (due.family ? `${due.family.name} Household` : "Walk-in Member");

    // 1. Create Donation entry
    const donation = await tx.donation.create({
      data: {
        mosqueId: resolvedMosqueId,
        amount: input.amount,
        accountId: input.accountId,
        fundId: due.fundId,
        categoryId: input.categoryId,
        date: paymentDate,
        memberId: due.memberId ?? null,
        familyId: due.familyId ?? null,
        donorName,
        donorPhone: due.member?.user?.phone ?? null,
        donorEmail: due.member?.user?.email ?? null,
        dueId: due.id,
        source: input.source ?? "MEMBER",
        status,
        receiptNumber,
        notes: input.notes ?? `Payment for chanda due ${due.period}`,
        attachments: input.attachments ?? [],
        createdById: actor.userId,
        postedById,
        postedAt,
      },
    });

    // 2. If posted immediately, update due's paidAmount and status
    let updatedDue = due;
    if (isPoster) {
      const newPaidAmount = due.paidAmount + input.amount;
      const newDueStatus =
        newPaidAmount >= due.amount ? DueStatus.PAID : DueStatus.PARTIAL;

      updatedDue = await tx.due.update({
        where: { id: due.id },
        data: {
          paidAmount: newPaidAmount,
          status: newDueStatus,
        },
        include: DUE_DEFAULT_INCLUDE,
      });
    }

    return {
      due: mapDueResponse(updatedDue),
      donation: {
        id: donation.id,
        amount: donation.amount.toString(),
        receiptNumber: donation.receiptNumber,
        status: donation.status,
        date: donation.date,
      },
    };
  });

  return result;
}

/**
 * POST /dues/:id/waive
 * Requires reason. Marks the due WAIVED. Recorded in audit log.
 * Access: ADMIN only (MOSQUE_ADMIN)
 */
export async function waiveDue(
  mosqueId: string,
  dueId: string,
  input: WaiveDueInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  if (actor.role !== Role.MOSQUE_ADMIN) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN can waive chanda dues.",
      "FORBIDDEN_ROLE",
    );
  }

  const due = await prisma.due.findFirst({
    where: { id: dueId, mosqueId: resolvedMosqueId },
  });

  if (!due) {
    throw HttpError.notFound("Due not found in this mosque.", "DUE_NOT_FOUND");
  }

  if (due.status === DueStatus.WAIVED) {
    throw HttpError.badRequest("Due is already waived.", "DUE_ALREADY_WAIVED");
  }

  if (due.status === DueStatus.PAID) {
    throw HttpError.badRequest("Cannot waive an already paid due.", "DUE_ALREADY_PAID");
  }

  const updated = await prisma.due.update({
    where: { id: dueId },
    data: {
      status: DueStatus.WAIVED,
      waivedAt: new Date(),
      waivedById: actor.userId,
      waiveReason: input.reason,
    },
    include: DUE_DEFAULT_INCLUDE,
  });

  return mapDueResponse(updated);
}

/**
 * GET /dues/summary
 * Collection rate, total outstanding, and defaulter list for a period.
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export async function getDuesSummary(
  mosqueId: string,
  query: GetDuesSummaryQueryInput,
  actor: ChandaActor,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight =
    actor.role === Role.MOSQUE_ADMIN ||
    actor.role === Role.TREASURER ||
    actor.role === Role.COMMITTEE_MEMBER;
  if (!isOversight) {
    throw HttpError.forbidden(
      "Only MOSQUE_ADMIN, TREASURER, and COMMITTEE_MEMBER can view dues summaries.",
      "FORBIDDEN_ROLE",
    );
  }

  const period = query.period;
  const where: Prisma.DueWhereInput = {
    mosqueId: resolvedMosqueId,
    period,
    ...(query.fundId ? { fundId: query.fundId } : {}),
  };

  const dues = await prisma.due.findMany({
    where,
    include: DUE_DEFAULT_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  let totalExpected = 0n;
  let totalCollected = 0n;
  let totalOutstanding = 0n;
  let totalWaived = 0n;

  const defaulters: any[] = [];

  for (const d of dues) {
    totalExpected += d.amount;
    totalCollected += d.paidAmount;

    if (d.status === DueStatus.WAIVED) {
      totalWaived += d.amount;
    } else if (d.status === DueStatus.UNPAID || d.status === DueStatus.PARTIAL) {
      const remaining = d.amount - d.paidAmount;
      totalOutstanding += remaining;

      const payerName =
        d.member?.user?.name ??
        (d.family?.name ? `${d.family.name} Household` : "Unknown Payer");

      defaulters.push({
        dueId: d.id,
        period: d.period,
        status: d.status,
        payerType: d.familyId ? "FAMILY" : "MEMBER",
        payerName,
        family: d.family ? { id: d.family.id, name: d.family.name } : null,
        member: d.member
          ? {
              id: d.member.id,
              user: {
                name: d.member.user?.name,
                phone: d.member.user?.phone ?? null,
                email: d.member.user?.email ?? null,
              },
            }
          : null,
        fund: {
          id: d.fund.id,
          name: d.fund.name,
        },
        amount: d.amount.toString(),
        paidAmount: d.paidAmount.toString(),
        remainingAmount: remaining.toString(),
      });
    }
  }

  // Calculate collection rate percentage
  // Collection rate = (totalCollected / totalExpected) * 100
  let collectionRate = 0;
  if (totalExpected > 0n) {
    const rateNumber = Number((totalCollected * 10000n) / totalExpected) / 100;
    collectionRate = Math.round(rateNumber * 10) / 10;
  }

  return {
    period,
    fundId: query.fundId ?? null,
    totalDuesCount: dues.length,
    collectionRate: `${collectionRate}%`,
    totalExpected: totalExpected.toString(),
    totalCollected: totalCollected.toString(),
    totalOutstanding: totalOutstanding.toString(),
    totalWaived: totalWaived.toString(),
    defaulterCount: defaulters.length,
    defaulters,
  };
}
