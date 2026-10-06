// ---------------------------------------------------------------------------
// Invite Link Router — Tenant-Scoped Mosque Invite Links
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createInviteLinkHandler,
  getMosqueInviteLinksHandler,
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

export default inviteLinkRouter;


