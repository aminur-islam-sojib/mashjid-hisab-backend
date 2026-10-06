// ---------------------------------------------------------------------------
// Invite Link Service — Admin-Managed Shareable Mosque Invite Links
//
// Design notes:
//  • Invite links enable self-service onboarding (via URL or QR code) into a mosque.
//  • Role defaults to MEMBER, but can be configured by MOSQUE_ADMIN to any
//    mosque-scoped role (TREASURER, STAFF, COMMITTEE_MEMBER, MEMBER).
//  • Security: Only the SHA-256 hash of the 256-bit cryptographically random token
//    is stored in the database. The raw token is returned exactly once in the creation
//    response so the caller can build share URLs/QRs client-side.
//  • Reusability: Supports optional maxUses (null = unlimited) and optional expiresAt (null = never).
// ---------------------------------------------------------------------------

import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma, isPrismaP2002, isP2002Target } from "../../lib/prisma.js";
import config from "../../config/index.js";
import { HttpError } from "../../errors/HttpError.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import {
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  tokenExpiresAt,
} from "../../utils/token.js";
import { generateSecureTemporaryPassword } from "../membership/membership.service.js";
import {
  Role,
  Prisma,
  UserStatus,
  MembershipStatus,
} from "../../../generated/prisma/client.js";
import type {
  CreateInviteLinkInput,
  GetMosqueInviteLinksQuery,
  JoinInviteLinkInput,
} from "./invite-link.validation.js";

export interface InviteLinkCreatedResponse {
  id: string;
  mosqueId: string;
  role: Role;
  token: string; // The raw token returned once
  maxUses: number | null;
  useCount: number;
  expiresAt: Date | null;
  isArchived: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MosqueInviteLinkItem {
  id: string;
  mosqueId: string;
  role: Role;
  maxUses: number | null;
  useCount: number;
  expiresAt: Date | null;
  isActive: boolean;
  isArchived: boolean;
  isExpired: boolean;
  isExhausted: boolean;
  createdById: string | null;
  createdBy: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generates an admin-managed MosqueInviteLink.
 *
 * Guarantees:
 * 1. Multi-Tenant Boundary: Resolves active mosque by CUID or slug; throws 404 if not found or archived.
 * 2. Cryptographic Security: Generates 256-bit random opaque token; stores only SHA-256 hash.
 * 3. Raw Token Returned Once: Caller must capture `token` for QR/link generation.
 * 4. Audit Trail: Persists creator's userId (`createdById`) when available.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param createdById - ID of the admin creating the invite link
 * @param input - Validated role, maxUses, and expiresAt
 */
export async function createInviteLink(
  mosqueId: string,
  createdById: string | undefined,
  input: CreateInviteLinkInput,
): Promise<InviteLinkCreatedResponse> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Generate cryptographically secure token & SHA-256 hash
  const { raw, hash } = generateOpaqueToken();

  const inviteLink = await prisma.mosqueInviteLink.create({
    data: {
      mosqueId: resolvedMosqueId,
      role: Role.MEMBER,
      tokenHash: hash,
      maxUses: input.maxUses ?? null,
      useCount: 0,
      expiresAt: input.expiresAt ?? null,
      createdById: createdById ?? null,
      isArchived: false,
    },
  });

  return {
    id: inviteLink.id,
    mosqueId: inviteLink.mosqueId,
    role: inviteLink.role,
    token: raw,
    maxUses: inviteLink.maxUses,
    useCount: inviteLink.useCount,
    expiresAt: inviteLink.expiresAt,
    isArchived: inviteLink.isArchived,
    createdById: inviteLink.createdById,
    createdAt: inviteLink.createdAt,
    updatedAt: inviteLink.updatedAt,
  };
}

/**
 * Lists MosqueInviteLinks for a mosque with useCount and live isActive calculation.
 *
 * Business logic:
 * A link is considered `isActive: true` if:
 * 1. It is not archived (`!isArchived`)
 * 2. It has not passed its expiration date (`expiresAt === null || expiresAt > now`)
 * 3. It has not exhausted its allowed usage (`maxUses === null || useCount < maxUses`)
 *
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param query - Optional filters (role, includeArchived)
 */
export async function getMosqueInviteLinks(
  mosqueId: string,
  query?: GetMosqueInviteLinksQuery,
): Promise<MosqueInviteLinkItem[]> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const where: Prisma.MosqueInviteLinkWhereInput = {
    mosqueId: resolvedMosqueId,
  };

  if (!query?.includeArchived) {
    where.isArchived = false;
  }

  if (query?.role) {
    where.role = query.role;
  }

  const links = await prisma.mosqueInviteLink.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const now = new Date();

  return links.map((link) => {
    const isExpired = link.expiresAt ? link.expiresAt.getTime() <= now.getTime() : false;
    const isExhausted = link.maxUses !== null ? link.useCount >= link.maxUses : false;
    const isActive = !link.isArchived && !isExpired && !isExhausted;

    return {
      id: link.id,
      mosqueId: link.mosqueId,
      role: link.role,
      maxUses: link.maxUses,
      useCount: link.useCount,
      expiresAt: link.expiresAt,
      isActive,
      isArchived: link.isArchived,
      isExpired,
      isExhausted,
      createdById: link.createdById,
      createdBy: link.createdBy ?? null,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  });
}

/**
 * Revokes an existing MosqueInviteLink.
 * Sets isArchived: true (causing live isActive to become false) without deleting the row.
 * Preserves the audit trail of who joined through it, consistent with Fund/Account archival.
 *
 * Security & Business Rules:
 * 1. Multi-Tenant Scoping: Ensures link belongs to resolvedMosqueId.
 *    Throws 404 INVITE_LINK_NOT_FOUND if not found or belongs to another tenant.
 * 2. Idempotency / Already Revoked Guard:
 *    Throws 400 INVITE_LINK_ALREADY_REVOKED if already revoked/archived.
 * 3. Audit Preservation: The row remains intact for historical lookup and reporting.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param linkId - CUID of the invite link to revoke
 */
export async function revokeInviteLink(
  mosqueId: string,
  linkId: string,
): Promise<MosqueInviteLinkItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const existingLink = await prisma.mosqueInviteLink.findFirst({
    where: {
      id: linkId,
      mosqueId: resolvedMosqueId,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!existingLink) {
    throw HttpError.notFound("Invite link not found.", "INVITE_LINK_NOT_FOUND");
  }

  if (existingLink.isArchived) {
    throw HttpError.badRequest(
      "Invite link is already revoked.",
      "INVITE_LINK_ALREADY_REVOKED",
    );
  }

  const updated = await prisma.mosqueInviteLink.update({
    where: { id: existingLink.id },
    data: { isArchived: true },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const now = new Date();
  const isExpired = updated.expiresAt ? updated.expiresAt.getTime() <= now.getTime() : false;
  const isExhausted = updated.maxUses !== null ? updated.useCount >= updated.maxUses : false;
  const isActive = false; // Explicitly false since isArchived is true

  return {
    id: updated.id,
    mosqueId: updated.mosqueId,
    role: updated.role,
    maxUses: updated.maxUses,
    useCount: updated.useCount,
    expiresAt: updated.expiresAt,
    isActive,
    isArchived: updated.isArchived,
    isExpired,
    isExhausted,
    createdById: updated.createdById,
    createdBy: updated.createdBy ?? null,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

export const revokeMosqueInviteLink = revokeInviteLink;

export interface PublicInviteLinkInfo {
  mosqueName: string;
}

/**
 * Reusable helper: Evaluates whether an invite link is active, unexpired, and not exhausted.
 */
export function isInviteLinkUsable(link: {
  isArchived: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}): boolean {
  if (link.isArchived) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false;
  if (link.maxUses !== null && link.useCount >= link.maxUses) return false;
  return true;
}

/**
 * Validates an invite token for the public join page.
 *
 * Security & existence-hiding posture:
 * - Publicly accessible without authentication.
 * - Computes SHA-256 hash to look up link.
 * - Validates: exists, active, unexpired, usage under max limit, and associated mosque active.
 * - If invalid, expired, revoked, or exhausted: throws a uniform generic 404 error
 *   to avoid leaking whether a link ever existed or why it cannot be used.
 * - Data exposure: returns ONLY the mosque's name.
 *
 * @param rawToken - 64-character raw hex token from URL
 */
export async function getPublicInviteLinkInfo(
  rawToken: string,
): Promise<PublicInviteLinkInfo> {
  const tokenHash = hashToken(rawToken);

  const inviteLink = await prisma.mosqueInviteLink.findUnique({
    where: { tokenHash },
    select: {
      isArchived: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      mosque: {
        select: {
          name: true,
          isArchived: true,
        },
      },
    },
  });

  // Existence-hiding: Return the same generic 404 for all invalidity states
  if (!inviteLink || inviteLink.mosque.isArchived || !isInviteLinkUsable(inviteLink)) {
    throw HttpError.notFound(
      "Invite link not found or has expired.",
      "INVITE_LINK_NOT_FOUND",
    );
  }

  return {
    mosqueName: inviteLink.mosque.name,
  };
}

export interface JoinMosqueInviteLinkResult {
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
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    mustChangePassword: boolean;
  };
  isNewUser: boolean;
  temporaryPassword?: string | null;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Public Join Flow: POST /api/public/invite-links/:token/join
 *
 * Requirements & Guarantees:
 * 1. Token Re-Validation:
 *    - Re-validates the token against the database: isActive, unarchived, unexpired, usage under max limit.
 *    - Re-verifies target mosque is active.
 *    - Existence-hiding: Throws uniform generic 404 if invalid, expired, revoked, or exhausted.
 * 2. Self-Service User Resolution:
 *    - If email/phone matches an existing User: creates/reactivates Membership(ACTIVE) directly.
 *    - If no existing User matches: creates User + Profile + Membership(ACTIVE) in one atomic transaction.
 * 3. Usage Counting:
 *    - Atomically increments `useCount` by 1.
 * 4. Multi-Tenant Guard:
 *    - Throws 409 conflict if user is already an ACTIVE member of the mosque.
 * 5. Session Establishment:
 *    - Generates session tokens (access token & refresh token) for new registrations or verified existing sessions.
 *
 * @param rawToken - 64-character raw hex token from URL
 * @param input - Validated join input (name, email, phone, password, locale)
 * @param callerUserId - Optional userId if caller is already authenticated
 * @param meta - Request metadata (userAgent, ipAddress)
 */
export async function joinMosqueByInviteLink(
  rawToken: string,
  input: JoinInviteLinkInput,
  callerUserId?: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<JoinMosqueInviteLinkResult> {
  const tokenHash = hashToken(rawToken);

  const trimmedEmail = input.email ? input.email.trim().toLowerCase() : undefined;
  const trimmedPhone = input.phone ? input.phone.trim() : undefined;

  // 1. Pre-flight check to see if user exists before opening transaction
  let preExistingUser = null;
  if (callerUserId) {
    preExistingUser = await prisma.user.findUnique({
      where: { id: callerUserId },
    });
  }

  if (!preExistingUser) {
    if (trimmedEmail && trimmedPhone) {
      const [uEmail, uPhone] = await Promise.all([
        prisma.user.findUnique({ where: { email: trimmedEmail } }),
        prisma.user.findUnique({ where: { phone: trimmedPhone } }),
      ]);
      if (uEmail && uPhone && uEmail.id !== uPhone.id) {
        throw HttpError.conflict(
          "Email and phone number belong to different existing accounts.",
          "CONTACT_ACCOUNT_MISMATCH",
        );
      }
      preExistingUser = uEmail || uPhone;
    } else if (trimmedEmail) {
      preExistingUser = await prisma.user.findUnique({
        where: { email: trimmedEmail },
      });
    } else if (trimmedPhone) {
      preExistingUser = await prisma.user.findUnique({
        where: { phone: trimmedPhone },
      });
    }
  }

  // 2. Prepare password hash for new user registration (CPU-intensive, keep outside tx)
  let preparedPasswordHash: string | null = null;
  let generatedTemporaryPassword: string | null = null;
  let mustChangePassword = false;

  if (!preExistingUser) {
    if (input.password?.trim()) {
      preparedPasswordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
      mustChangePassword = false;
    } else {
      generatedTemporaryPassword = generateSecureTemporaryPassword(12);
      preparedPasswordHash = await bcrypt.hash(generatedTemporaryPassword, config.BCRYPT_ROUNDS);
      mustChangePassword = true;
    }
  }

  // 3. Atomic Database Transaction
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // 3a. Re-validate token inside transaction
      const inviteLink = await tx.mosqueInviteLink.findUnique({
        where: { tokenHash },
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

      if (!inviteLink || inviteLink.mosque.isArchived || !isInviteLinkUsable(inviteLink)) {
        throw HttpError.notFound(
          "Invite link not found or has expired.",
          "INVITE_LINK_NOT_FOUND",
        );
      }

      // 3b. Atomic concurrency guard on maxUses:
      // Uses updateMany to atomically increment useCount only while useCount < maxUses.
      // If updateMany returns count === 0, another concurrent transaction reached maxUses first.
      const updateResult = await tx.mosqueInviteLink.updateMany({
        where: {
          id: inviteLink.id,
          isArchived: false,
          ...(inviteLink.maxUses !== null ? { useCount: { lt: inviteLink.maxUses } } : {}),
        },
        data: {
          useCount: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw HttpError.notFound(
          "Invite link not found or has reached its maximum uses.",
          "INVITE_LINK_NOT_FOUND",
        );
      }

      // 3c. Resolve user (re-check inside tx)
    let targetUser: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      sessionVersion: number;
      passwordHash: string;
      mustChangePassword: boolean;
    };
    let isNewUser = false;

    let existingUser = preExistingUser
      ? await tx.user.findUnique({ where: { id: preExistingUser.id } })
      : null;

    if (!existingUser) {
      if (trimmedEmail && trimmedPhone) {
        const [uEmail, uPhone] = await Promise.all([
          tx.user.findUnique({ where: { email: trimmedEmail } }),
          tx.user.findUnique({ where: { phone: trimmedPhone } }),
        ]);
        if (uEmail && uPhone && uEmail.id !== uPhone.id) {
          throw HttpError.conflict(
            "Email and phone number belong to different existing accounts.",
            "CONTACT_ACCOUNT_MISMATCH",
          );
        }
        existingUser = uEmail || uPhone;
      } else if (trimmedEmail) {
        existingUser = await tx.user.findUnique({
          where: { email: trimmedEmail },
        });
      } else if (trimmedPhone) {
        existingUser = await tx.user.findUnique({
          where: { phone: trimmedPhone },
        });
      }
    }

    if (existingUser) {
      targetUser = existingUser;
    } else {
      isNewUser = true;
      const finalName =
        input.name?.trim() ||
        (trimmedEmail ? trimmedEmail.split("@")[0]! : `Member-${(trimmedPhone || "").slice(-4)}`);

      const createdUser = await tx.user.create({
        data: {
          name: finalName,
          email: trimmedEmail ?? null,
          phone: trimmedPhone ?? null,
          passwordHash: preparedPasswordHash!,
          status: UserStatus.ACTIVE,
          emailVerified: false,
          mustChangePassword,
          sessionVersion: 1,
          locale: input.locale ?? "bn",
          profile: {
            create: {},
          },
        },
      });

      targetUser = createdUser;
    }

    // 3d. Check existing membership
    const existingMembership = await tx.membership.findUnique({
      where: {
        userId_mosqueId: {
          userId: targetUser.id,
          mosqueId: inviteLink.mosqueId,
        },
      },
    });

    if (existingMembership?.status === MembershipStatus.ACTIVE) {
      throw HttpError.conflict(
        "You are already an active member of this mosque.",
        "ALREADY_MEMBER",
      );
    }

    if (existingMembership?.status === MembershipStatus.PENDING) {
      throw HttpError.conflict(
        "You already have a pending join request for this mosque.",
        "ALREADY_PENDING",
      );
    }

    if (existingMembership?.status === MembershipStatus.SUSPENDED) {
      throw HttpError.forbidden(
        "Your membership in this mosque has been suspended. Please contact the administrator.",
        "MEMBERSHIP_SUSPENDED",
      );
    }

    let membership;
    if (existingMembership) {
      membership = await tx.membership.update({
        where: { id: existingMembership.id },
        data: {
          role: Role.MEMBER,
          status: MembershipStatus.PENDING,
          invitedById: inviteLink.createdById ?? existingMembership.invitedById,
        },
        include: {
          mosque: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
    } else {
      membership = await tx.membership.create({
        data: {
          userId: targetUser.id,
          mosqueId: inviteLink.mosqueId,
          role: Role.MEMBER,
          status: MembershipStatus.PENDING,
          invitedById: inviteLink.createdById ?? null,
        },
        include: {
          mosque: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
    }

    // 3e. Session token creation
    // Note: Since membership is PENDING approval, tokens carry null mosqueId/role.
    let accessToken: string | undefined;
    let refreshToken: string | undefined;

    const shouldIssueSession =
      isNewUser ||
      callerUserId === targetUser.id ||
      (Boolean(input.password) && (await bcrypt.compare(input.password!, targetUser.passwordHash)));

    if (shouldIssueSession) {
      const jti = crypto.randomUUID();
      accessToken = signAccessToken({
        sub: targetUser.id,
        mosqueId: null,
        role: null,
        sessionVersion: targetUser.sessionVersion,
        mustChangePassword: targetUser.mustChangePassword,
      });

      const rawRefreshJwt = signRefreshToken({
        sub: targetUser.id,
        jti,
        mosqueId: null,
        role: null,
        sessionVersion: targetUser.sessionVersion,
      });

      const refreshHash = hashToken(rawRefreshJwt);

      await tx.refreshToken.create({
        data: {
          userId: targetUser.id,
          tokenHash: refreshHash,
          mosqueId: null,
          role: null,
          expiresAt: tokenExpiresAt(config.JWT_REFRESH_EXPIRES_IN_MS),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
      });

      refreshToken = rawRefreshJwt;
    }

    return {
      membership: {
        id: membership.id,
        userId: membership.userId,
        mosqueId: membership.mosqueId,
        role: membership.role,
        status: membership.status,
        createdAt: membership.createdAt,
        mosque: membership.mosque,
      },
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        phone: targetUser.phone,
        mustChangePassword: targetUser.mustChangePassword,
      },
      isNewUser,
      temporaryPassword: isNewUser && mustChangePassword ? generatedTemporaryPassword : null,
      accessToken,
      refreshToken,
    };
  });

  return result;
  } catch (error) {
    if (isPrismaP2002(error)) {
      if (isP2002Target(error, "email")) {
        throw HttpError.conflict(
          "An account with this email address already exists.",
          "AUTH_EMAIL_TAKEN",
        );
      }
      if (isP2002Target(error, "phone")) {
        throw HttpError.conflict(
          "An account with this phone number already exists.",
          "AUTH_PHONE_TAKEN",
        );
      }
      if (isP2002Target(error, "userId_mosqueId") || isP2002Target(error, "mosqueId") || isP2002Target(error, "userId")) {
        throw HttpError.conflict(
          "You are already a member or have a pending request for this mosque.",
          "ALREADY_MEMBER",
        );
      }
      throw HttpError.conflict(
        "A conflict occurred while processing the join request.",
        "DUPLICATE_RESOURCE",
      );
    }
    throw error;
  }
}

