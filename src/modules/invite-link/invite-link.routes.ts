// ---------------------------------------------------------------------------
// Invite Link Router — Tenant-Scoped Mosque Invite Links
// ---------------------------------------------------------------------------

import { Router } from "express";
import {
  authenticate,
  optionalAuthenticate,
} from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createInviteLinkHandler,
  getMosqueInviteLinksHandler,
  revokeInviteLinkHandler,
  getPublicInviteLinkInfoHandler,
  joinMosqueByInviteLinkHandler,
} from "./invite-link.controller.js";

const inviteLinkRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/invite-links
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Generates a MosqueInviteLink (role default MEMBER, optional maxUses, optional expiresAt).
 * Returns the raw token once — build the share URL/QR from it client-side; only the hash is stored.
 */
inviteLinkRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  createInviteLinkHandler,
);

/**
 * GET /api/mosques/:mosqueId/invite-links
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Lists MosqueInviteLinks with useCount and isActive status.
 */
inviteLinkRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  getMosqueInviteLinksHandler,
);

/**
 * POST /api/mosques/:mosqueId/invite-links/:id/revoke
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Sets isActive: false without deleting the row — preserves the audit trail
 * of who joined through it, consistent with Fund/Account archival.
 */
inviteLinkRouter.post(
  "/:id/revoke",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  revokeInviteLinkHandler,
);

// ---------------------------------------------------------------------------
// Public Invite Link Router — Unauthenticated Public Join Flow
// ---------------------------------------------------------------------------

export const publicInviteLinkRouter: Router = Router();

/**
 * GET /api/public/invite-links/:token
 * Access: Public (unauthenticated)
 *
 * Validates the token (isActive, not expired, under maxUses) and returns just the mosque's name —
 * what the join page shows before the person commits.
 * Existence-hiding: Returns a generic 404 for invalid/expired/exhausted/revoked tokens.
 */
publicInviteLinkRouter.get("/:token", getPublicInviteLinkInfoHandler);

/**
 * POST /api/public/invite-links/:token/join
 * Access: Public (unauthenticated, or optionally authenticated)
 *
 * Self-service registration & joining flow:
 * - If email/phone matches an existing User: creates/reactivates Membership(ACTIVE) directly
 * - Otherwise: creates User + Profile + Membership(ACTIVE) in one step
 * - Increments useCount
 */
publicInviteLinkRouter.post(
  "/:token/join",
  optionalAuthenticate,
  joinMosqueByInviteLinkHandler,
);

export default inviteLinkRouter;
