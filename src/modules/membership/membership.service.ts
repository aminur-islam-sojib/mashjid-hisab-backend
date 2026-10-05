// ---------------------------------------------------------------------------
// Membership Service — Tenant-Scoped Membership Management & Invitations
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  Role,
  MembershipStatus,
  InviteStatus,
  UserStatus,
  type Membership,
} from "../../../generated/prisma/client.js";
import {
  generateOpaqueToken,
  hashToken,
  tokenExpiresAt,
} from "../../utils/token.js";
import type {
  CreateMembershipInviteInput,
  AcceptMembershipInviteInput,
} from "./membership.validation.js";

// Re-export existing member management functions for backward compatibility
export {
  getMosqueMembers,
  updateMembership,
  removeMember,
  leaveMosque,
  type MosqueMemberItem,
  type UpdatedMembershipResult,
  type DeleteMembershipResult,
} from "../mosque/mosque.service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MembershipInviteResponse {
  invite: {
    id: string;
    mosqueId: string;
    email: string | null;
    phone: string | null;
    role: Role;
    status: InviteStatus;
    expiresAt: Date;
    createdAt: Date;
    mosque: {
      id: string;
      name: string;
      slug: string;
    };
    invitedBy: {
      id: string;
      name: string;
      email: string;
    };
  };
  token: string;
}

export interface AcceptMembershipInviteResult {
  membership: {
    id: string;
    userId: string;
    mosqueId: string;
    role: Role;
    status: MembershipStatus;
    createdAt: Date;
    mosque: {
      id: string;
      name: string;
      slug: string;
    };
  };
  message: string;
}

// ---------------------------------------------------------------------------
// Invitation Service Functions
// ---------------------------------------------------------------------------

/**
 * Creates a MembershipInvite for a mosque by email or phone.
 *
 * Security & Governance Rails:
 * - Caller must be an active MOSQUE_ADMIN or TREASURER in the target mosque.
 * - Caller user account must be ACTIVE.
 * - Target mosque must exist and not be archived.
 * - Privilege ceiling: TREASURER cannot invite a MOSQUE_ADMIN.
 * - Cannot invite someone who is already an ACTIVE member in the mosque.
 * - Prevents duplicate spam invites for the same contact in the same mosque.
 * - Persists SHA-256 hash only; returns raw token for delivery.
 *
 * @param callerUserId - Authenticated caller's user ID
 * @param input - Validated invite input
 */
export async function createMembershipInvite(
  callerUserId: string,
  input: CreateMembershipInviteInput,
): Promise<MembershipInviteResponse> {
  // 1. Resolve target mosque (accepts CUID or slug)
  const targetMosque = await prisma.mosque.findFirst({
    where: {
      OR: [{ id: input.mosqueId }, { slug: input.mosqueId }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      isArchived: true,
    },
  });

  if (!targetMosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  if (targetMosque.isArchived) {
    throw HttpError.badRequest(
      "Cannot invite members to an archived mosque.",
      "MOSQUE_ARCHIVED",
    );
  }

  const resolvedMosqueId = targetMosque.id;

  // 2. Verify caller's membership & authorization in target mosque
  const callerMembership = await prisma.membership.findUnique({
    where: {
      userId_mosqueId: {
        userId: callerUserId,
        mosqueId: resolvedMosqueId,
      },
    },
    include: {
      user: {
        select: { status: true },
      },
    },
  });

  if (!callerMembership || callerMembership.status !== MembershipStatus.ACTIVE) {
    throw HttpError.forbidden(
      "You do not have an active membership in this mosque.",
      "MEMBERSHIP_FORBIDDEN",
    );
  }

  if (callerMembership.user.status !== UserStatus.ACTIVE) {
    throw HttpError.forbidden(
      "Your account is inactive or blocked.",
      "ACCOUNT_INACTIVE",
    );
  }

  if (
    callerMembership.role !== Role.MOSQUE_ADMIN &&
    callerMembership.role !== Role.TREASURER
  ) {
    throw HttpError.forbidden(
      "Only mosque administrators and treasurers can invite new members.",
      "FORBIDDEN_ROLE",
    );
  }

  // 3. Privilege escalation guard: TREASURER cannot invite a MOSQUE_ADMIN
  if (
    callerMembership.role === Role.TREASURER &&
    input.role === Role.MOSQUE_ADMIN
  ) {
    throw HttpError.forbidden(
      "Treasurers are not permitted to invite mosque administrators.",
      "PRIVILEGE_ESCALATION",
    );
  }

  // 4. Contact uniqueness & existing active member collision check
  const contactConditions: Array<{ email?: string; phone?: string }> = [];
  if (input.email) contactConditions.push({ email: input.email });
  if (input.phone) contactConditions.push({ phone: input.phone });

  const existingActiveMember = await prisma.membership.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      status: MembershipStatus.ACTIVE,
      user: {
        OR: contactConditions,
      },
    },
    select: { id: true, role: true },
  });

  if (existingActiveMember) {
    throw HttpError.conflict(
      "A user with this contact information is already an active member of this mosque.",
      "ALREADY_MEMBER",
    );
  }

  // 5. Anti-spam / duplicate active pending invite check
  const now = new Date();
  const existingPendingInvite = await prisma.membershipInvite.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      status: InviteStatus.PENDING,
      expiresAt: { gt: now },
      OR: contactConditions,
    },
    select: { id: true, expiresAt: true },
  });

  if (existingPendingInvite) {
    throw HttpError.conflict(
      "An active pending invitation already exists for this contact in this mosque.",
      "INVITE_ALREADY_EXISTS",
    );
  }

  // 6. Generate secure opaque token (raw token distributed, SHA-256 hash persisted)
  const { raw: rawToken, hash: tokenHash } = generateOpaqueToken();
  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const expiresAt = tokenExpiresAt(INVITE_TTL_MS);

  const invite = await prisma.membershipInvite.create({
    data: {
      mosqueId: resolvedMosqueId,
      email: input.email || null,
      phone: input.phone || null,
      role: input.role,
      tokenHash,
      status: InviteStatus.PENDING,
      invitedById: callerUserId,
      expiresAt,
    },
    select: {
      id: true,
      mosqueId: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      invitedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    invite,
    token: rawToken,
  };
}

/**
 * Accepts a MembershipInvite and converts it into an ACTIVE Membership.
 *
 * Security & Governance Rails:
 * - Caller must be an authenticated user with an ACTIVE account.
 * - Caller's verified contact (email or phone) MUST match the invitation's contact.
 * - Rejects already accepted (409), revoked (410), or expired (410) invitations.
 * - Optional token verification when a raw token is provided.
 * - Atomic database transaction:
 *   1. Upserts/activates Membership with assigned role and status ACTIVE.
 *   2. Transitions MembershipInvite to ACCEPTED with acceptedAt timestamp.
 *   3. Increments user's sessionVersion to invalidate outdated tokens and refresh permissions.
 *
 * @param callerUserId - Authenticated caller's user ID
 * @param inviteId - Invitation identifier
 * @param input - Optional accept payload (e.g. token)
 */
export async function acceptMembershipInvite(
  callerUserId: string,
  inviteId: string,
  input?: AcceptMembershipInviteInput,
): Promise<AcceptMembershipInviteResult> {
  // 1. Fetch caller's live identity
  const caller = await prisma.user.findUnique({
    where: { id: callerUserId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
    },
  });

  if (!caller) {
    throw HttpError.unauthorized("Caller user record not found.", "AUTH_UNAUTHORIZED");
  }

  if (caller.status !== UserStatus.ACTIVE) {
    throw HttpError.forbidden(
      "Your user account is inactive or blocked.",
      "ACCOUNT_INACTIVE",
    );
  }

  // 2. Fetch the invitation
  const invite = await prisma.membershipInvite.findUnique({
    where: { id: inviteId },
    include: {
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
          isArchived: true,
        },
      },
    },
  });

  if (!invite) {
    throw HttpError.notFound("Invitation not found.", "INVITE_NOT_FOUND");
  }

  if (invite.mosque.isArchived) {
    throw HttpError.badRequest(
      "This invitation belongs to a mosque that has been archived.",
      "MOSQUE_ARCHIVED",
    );
  }

  // 3. Lifecycle checks
  if (invite.status === InviteStatus.ACCEPTED) {
    throw HttpError.conflict(
      "This invitation has already been accepted.",
      "INVITE_ALREADY_ACCEPTED",
    );
  }

  if (invite.status === InviteStatus.REVOKED) {
    throw HttpError.gone(
      "This invitation has been revoked by mosque administration.",
      "INVITE_REVOKED",
    );
  }

  const now = new Date();
  if (invite.status === InviteStatus.EXPIRED || invite.expiresAt <= now) {
    if (invite.status === InviteStatus.PENDING) {
      await prisma.membershipInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.EXPIRED },
      });
    }
    throw HttpError.gone(
      "This invitation has expired.",
      "INVITE_EXPIRED",
    );
  }

  // 4. Contact match enforcement: caller's email or phone MUST match the invite
  const emailMatch = Boolean(
    invite.email &&
      caller.email &&
      invite.email.toLowerCase() === caller.email.toLowerCase(),
  );
  const phoneMatch = Boolean(
    invite.phone && caller.phone && invite.phone === caller.phone,
  );

  if (!emailMatch && !phoneMatch) {
    throw HttpError.forbidden(
      "Your account contact information does not match this invitation.",
      "INVITE_CONTACT_MISMATCH",
    );
  }

  // 5. Optional token hash check if token was supplied in request
  if (input?.token) {
    const hashed = hashToken(input.token);
    if (hashed !== invite.tokenHash) {
      throw HttpError.badRequest(
        "Invalid invitation token.",
        "INVALID_INVITE_TOKEN",
      );
    }
  }

  // 6. Atomic conversion in database transaction
  const updatedMembership = await prisma.$transaction(async (tx) => {
    // Check existing membership
    const existingMembership = await tx.membership.findUnique({
      where: {
        userId_mosqueId: {
          userId: callerUserId,
          mosqueId: invite.mosqueId,
        },
      },
    });

    if (existingMembership?.status === MembershipStatus.ACTIVE) {
      await tx.membershipInvite.update({
        where: { id: invite.id },
        data: {
          status: InviteStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });
      throw HttpError.conflict(
        "You are already an active member of this mosque.",
        "ALREADY_MEMBER",
      );
    }

    let membership: Membership & {
      mosque: { id: string; name: string; slug: string };
    };

    if (existingMembership) {
      // Reactivate or upgrade existing inactive/pending membership
      membership = await tx.membership.update({
        where: { id: existingMembership.id },
        data: {
          role: invite.role,
          status: MembershipStatus.ACTIVE,
          invitedById: invite.invitedById,
        },
        include: {
          mosque: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
    } else {
      // Create new active membership
      membership = await tx.membership.create({
        data: {
          userId: callerUserId,
          mosqueId: invite.mosqueId,
          role: invite.role,
          status: MembershipStatus.ACTIVE,
          invitedById: invite.invitedById,
        },
        include: {
          mosque: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
    }

    // Mark invite as ACCEPTED
    await tx.membershipInvite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    // Invalidate stale refresh tokens / JWT claims by incrementing sessionVersion
    await tx.user.update({
      where: { id: callerUserId },
      data: {
        sessionVersion: { increment: 1 },
      },
    });

    return membership;
  });

  return {
    membership: {
      id: updatedMembership.id,
      userId: updatedMembership.userId,
      mosqueId: updatedMembership.mosqueId,
      role: updatedMembership.role,
      status: updatedMembership.status,
      createdAt: updatedMembership.createdAt,
      mosque: updatedMembership.mosque,
    },
    message: "Invitation accepted successfully. You are now an active member.",
  };
}
