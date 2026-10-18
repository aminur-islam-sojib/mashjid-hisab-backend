// ---------------------------------------------------------------------------
// Family Service — Household Grouping Logic
//
// Design notes:
//  • The head is whoever created the Family — never computed from DOB.
//  • Routes mount with requireMosqueMembership() (any ACTIVE member, no role
//    restriction) for family-detail/mutation endpoints. Authorization below
//    that is "caller is this family's head OR MOSQUE_ADMIN" — an ownership
//    check that a blanket role-list middleware can't express, so it lives
//    here, same as assertNotLastAdmin lives in mosque.service.ts call sites.
//  • A MEMBER with no oversight role can only ever reach their OWN family —
//    unknown/foreign familyId returns 404, never 403, so household
//    existence isn't leaked to other members.
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import {
  Role,
  MembershipStatus,
  Prisma,
  type Family,
  type FamilyMember,
  type Membership,
} from "../../../generated/prisma/client.js";
import type {
  CreateFamilyInput,
  UpdateFamilyInput,
  TransferFamilyHeadInput,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from "./family.validation.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Loads a Family scoped to mosqueId, including members and head details, or throws 404.
 * Never distinguishes "doesn't exist" from "belongs to another mosque" —
 * same existence-hiding principle used across every other module.
 */
async function loadFamilyOrThrow(mosqueId: string, familyId: string) {
  const family = await prisma.family.findFirst({
    where: { id: familyId, mosqueId },
    include: {
      headMembership: {
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      },
      members: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!family) {
    throw HttpError.notFound("Family not found.", "FAMILY_NOT_FOUND");
  }

  return family;
}

/**
 * Authorization gate shared by every family-mutation endpoint:
 * the caller must be this family's head, or hold MOSQUE_ADMIN in the mosque.
 *
 * Returns 404 (not 403) when the caller is a plain member of a DIFFERENT
 * family — consistent with the rest of the app's "don't leak existence"
 * stance, since confirming "this family exists but isn't yours" is itself
 * information a non-admin member shouldn't get from this endpoint.
 */
function assertFamilyHeadOrAdmin(
  family: { headMembershipId: string },
  callerMembership: Membership,
): void {
  const isHead = family.headMembershipId === callerMembership.id;
  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);

  if (!isHead && !isOversight) {
    throw HttpError.notFound("Family not found.", "FAMILY_NOT_FOUND");
  }
}

// ---------------------------------------------------------------------------
// Family CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a Family. Plain MEMBER sets caller as head; MOSQUE_ADMIN / oversight roles
 * can optionally assign any active mosque member as the head via headMembershipId.
 * One Membership can head at most one Family.
 */
export async function createFamily(
  mosqueId: string,
  callerMembership: Membership,
  input: CreateFamilyInput,
): Promise<Family> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);

  let targetHeadId = callerMembership.id;
  if (input.headMembershipId && input.headMembershipId !== callerMembership.id) {
    if (!isOversight) {
      throw HttpError.forbidden(
        "Only mosque administrators and oversight officers can create a family for another member.",
        "FORBIDDEN_HEAD_ASSIGNMENT",
      );
    }

    const targetMembership = await prisma.membership.findFirst({
      where: {
        id: input.headMembershipId,
        mosqueId: resolvedMosqueId,
        status: MembershipStatus.ACTIVE,
      },
      include: { user: { select: { name: true } } },
    });

    if (!targetMembership) {
      throw HttpError.notFound(
        "Target member not found or is not an active member of this mosque.",
        "MEMBER_NOT_FOUND",
      );
    }

    targetHeadId = targetMembership.id;
  }

  // Friendly check for existing family headed by this membership
  const existing = await prisma.family.findUnique({
    where: { headMembershipId: targetHeadId },
    select: { id: true },
  });

  if (existing) {
    throw HttpError.conflict(
      targetHeadId === callerMembership.id
        ? "You already head a family in this mosque. Transfer headship first if you need to start a new one."
        : "This member already heads a family in this mosque.",
      "FAMILY_ALREADY_EXISTS",
    );
  }

  try {
    return await prisma.family.create({
      data: {
        mosqueId: resolvedMosqueId,
        name: input.name,
        address: input.address,
        headMembershipId: targetHeadId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        "This member already heads a family in this mosque.",
        "FAMILY_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}

/**
 * Gets a family by a member's ID. Accessible by that member or OVERSIGHT roles.
 */
export async function getFamilyByMembership(
  mosqueId: string,
  targetMembershipId: string,
  callerMembership: Membership,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);
  const isSelf = targetMembershipId === callerMembership.id;

  if (!isSelf && !isOversight) {
    throw HttpError.notFound("Family not found.", "FAMILY_NOT_FOUND");
  }

  const family = await prisma.family.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      OR: [
        { headMembershipId: targetMembershipId },
        { members: { some: { linkedMembershipId: targetMembershipId } } },
      ],
    },
    include: {
      headMembership: {
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      },
      members: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });

  return family;
}

/**
 * Directly adds a family member for any mosque member.
 * If the member does not yet have a family household, one is automatically created for them.
 */
export async function addFamilyMemberByMembership(
  mosqueId: string,
  targetMembershipId: string,
  callerMembership: Membership,
  input: CreateFamilyMemberInput,
): Promise<FamilyMember> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);
  const isSelf = targetMembershipId === callerMembership.id;

  if (!isSelf && !isOversight) {
    throw HttpError.notFound("Member not found.", "MEMBER_NOT_FOUND");
  }

  const targetMembership = await prisma.membership.findFirst({
    where: {
      id: targetMembershipId,
      mosqueId: resolvedMosqueId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      user: { select: { name: true } },
      headOfFamily: true,
    },
  });

  if (!targetMembership) {
    throw HttpError.notFound("Member not found in this mosque.", "MEMBER_NOT_FOUND");
  }

  let family = targetMembership.headOfFamily;
  if (!family) {
    const familyName = `${targetMembership.user.name}'s Family`;
    family = await prisma.family.create({
      data: {
        mosqueId: resolvedMosqueId,
        name: familyName,
        headMembershipId: targetMembership.id,
      },
    });
  }

  return prisma.familyMember.create({
    data: {
      familyId: family.id,
      name: input.name,
      relation: input.relation,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      phone: input.phone,
      occupation: input.occupation,
      bloodGroup: input.bloodGroup,
    },
  });
}

export interface GetMosqueFamiliesOptions {
  search?: string;
}

/**
 * Lists Families in the mosque:
 * - OVERSIGHT_ROLES see every family in the mosque.
 * - Regular members see their own family (as head or linked member).
 */
export async function getMosqueFamilies(
  mosqueId: string,
  callerMembership: Membership,
  options: GetMosqueFamiliesOptions = {},
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const search = options.search?.trim();

  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);

  const whereClause: Prisma.FamilyWhereInput = {
    mosqueId: resolvedMosqueId,
    ...(!isOversight
      ? {
          OR: [
            { headMembershipId: callerMembership.id },
            { members: { some: { linkedMembershipId: callerMembership.id } } },
          ],
        }
      : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { headMembership: { user: { name: { contains: search, mode: "insensitive" as const } } } },
                { headMembership: { user: { phone: { contains: search, mode: "insensitive" as const } } } },
              ],
            },
          ],
        }
      : {}),
  };

  return prisma.family.findMany({
    where: whereClause,
    include: {
      headMembership: {
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      },
      members: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Gets one Family. A plain MEMBER may fetch their own family (as head or linked member);
 * OVERSIGHT_ROLES may fetch any family in the mosque.
 */
export async function getFamilyById(
  mosqueId: string,
  familyId: string,
  callerMembership: Membership,
) {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);

  const isOversight = (
    [Role.MOSQUE_ADMIN, Role.TREASURER, Role.COMMITTEE_MEMBER] as Role[]
  ).includes(callerMembership.role);
  const isHead = family.headMembershipId === callerMembership.id;
  const isLinkedMember = family.members.some(
    (member) => member.linkedMembershipId === callerMembership.id,
  );

  if (!isOversight && !isHead && !isLinkedMember) {
    throw HttpError.notFound("Family not found.", "FAMILY_NOT_FOUND");
  }

  return family;
}

export async function updateFamily(
  mosqueId: string,
  familyId: string,
  callerMembership: Membership,
  input: UpdateFamilyInput,
): Promise<Family> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);
  assertFamilyHeadOrAdmin(family, callerMembership);

  return prisma.family.update({
    where: { id: family.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Headship transfer
// ---------------------------------------------------------------------------

export async function transferFamilyHead(
  mosqueId: string,
  familyId: string,
  callerMembership: Membership,
  input: TransferFamilyHeadInput,
): Promise<Family> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);
  assertFamilyHeadOrAdmin(family, callerMembership);

  if (input.newHeadMembershipId === family.headMembershipId) {
    throw HttpError.badRequest(
      "This member already heads the family.",
      "ALREADY_FAMILY_HEAD",
    );
  }

  const newHead = await prisma.membership.findFirst({
    where: {
      id: input.newHeadMembershipId,
      mosqueId: resolvedMosqueId,
      status: MembershipStatus.ACTIVE,
    },
  });

  if (!newHead) {
    throw HttpError.notFound(
      "The proposed new head must be an active member of this mosque.",
      "MEMBERSHIP_NOT_FOUND",
    );
  }

  const newHeadAlreadyHeadsFamily = await prisma.family.findUnique({
    where: { headMembershipId: newHead.id },
    select: { id: true },
  });

  if (newHeadAlreadyHeadsFamily) {
    throw HttpError.conflict(
      "This member already heads a different family.",
      "FAMILY_ALREADY_EXISTS",
    );
  }

  return prisma.$transaction(async (tx) => {
    // If proposed new head was already recorded as a FamilyMember in this family,
    // delete that row so household size is never double-counted (per schema invariant)
    await tx.familyMember.deleteMany({
      where: {
        familyId: family.id,
        linkedMembershipId: newHead.id,
      },
    });

    return tx.family.update({
      where: { id: family.id },
      data: { headMembershipId: newHead.id },
    });
  });
}

// ---------------------------------------------------------------------------
// FamilyMember CRUD
// ---------------------------------------------------------------------------

export async function addFamilyMember(
  mosqueId: string,
  familyId: string,
  callerMembership: Membership,
  input: CreateFamilyMemberInput,
): Promise<FamilyMember> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);
  assertFamilyHeadOrAdmin(family, callerMembership);

  return prisma.familyMember.create({
    data: {
      familyId: family.id,
      name: input.name,
      relation: input.relation,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      phone: input.phone,
      occupation: input.occupation,
      bloodGroup: input.bloodGroup,
    },
  });
}

async function loadFamilyMemberOrThrow(familyId: string, memberId: string) {
  const member = await prisma.familyMember.findFirst({
    where: { id: memberId, familyId },
  });

  if (!member) {
    throw HttpError.notFound("Family member not found.", "FAMILY_MEMBER_NOT_FOUND");
  }

  return member;
}

export async function updateFamilyMember(
  mosqueId: string,
  familyId: string,
  memberId: string,
  callerMembership: Membership,
  input: UpdateFamilyMemberInput,
): Promise<FamilyMember> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);
  assertFamilyHeadOrAdmin(family, callerMembership);
  const member = await loadFamilyMemberOrThrow(family.id, memberId);

  return prisma.familyMember.update({
    where: { id: member.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.relation !== undefined ? { relation: input.relation } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
      ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
    },
  });
}

export async function removeFamilyMember(
  mosqueId: string,
  familyId: string,
  memberId: string,
  callerMembership: Membership,
): Promise<void> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);
  const family = await loadFamilyOrThrow(resolvedMosqueId, familyId);
  assertFamilyHeadOrAdmin(family, callerMembership);
  const member = await loadFamilyMemberOrThrow(family.id, memberId);

  if (member.linkedMembershipId) {
    throw HttpError.conflict(
      "This family member has their own account and can't be removed from the record this way. Remove their mosque membership instead if that's the intent.",
      "FAMILY_MEMBER_LINKED",
    );
  }

  await prisma.familyMember.delete({ where: { id: member.id } });
}

