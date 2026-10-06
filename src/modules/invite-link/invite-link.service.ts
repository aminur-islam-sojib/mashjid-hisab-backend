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
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import { generateOpaqueToken } from "../../utils/token.js";
import { Role } from "../../../generated/prisma/client.js";
import type { CreateInviteLinkInput } from "./invite-link.validation.js";

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

