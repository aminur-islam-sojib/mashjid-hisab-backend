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

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import { generateOpaqueToken, hashToken } from "../../utils/token.js";
import { Role, Prisma } from "../../../generated/prisma/client.js";
import type {
  CreateInviteLinkInput,
  GetMosqueInviteLinksQuery,
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
      role: input.role ?? Role.MEMBER,
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
