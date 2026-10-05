// ---------------------------------------------------------------------------
// Membership Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import { Role } from "../../../generated/prisma/client.js";
import {
  getMosqueMembersHandler,
  updateMembershipHandler,
  leaveMosqueHandler,
  removeMemberHandler,
  createMembershipInviteHandler,
  acceptMembershipInviteHandler,
} from "./membership.controller.js";

const membershipRouter: Router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Invitation Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/memberships/invite
 * Access: Authenticated (caller must be MOSQUE_ADMIN or TREASURER in target mosque)
 *
 * Creates a MembershipInvite for the target mosque by email/phone.
 */
membershipRouter.post(
  "/invite",
  authenticate,
  createMembershipInviteHandler,
);

/**
 * POST /api/memberships/invites/:id/accept
 * Access: Authenticated, matching invite contact
 *
 * Converts the invite into an ACTIVE Membership.
 */
membershipRouter.post(
  "/invites/:id/accept",
  authenticate,
  acceptMembershipInviteHandler,
);

/**
 * GET /api/mosques/:mosqueId/members
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists all Memberships for the mosque with user name/role/status — the admin's people-management screen.
 */
membershipRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueMembersHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/members/:membershipId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Changes a member's role or status (e.g. promote to TREASURER, SUSPENDED).
 * Rejects with LAST_ADMIN_PROTECTED if this would demote the mosque's only MOSQUE_ADMIN.
 */
membershipRouter.patch(
  "/:membershipId",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  updateMembershipHandler,
);

/**
 * DELETE /api/mosques/:mosqueId/members/me
 * Access: Authenticated (self)
 *
 * Lets a member leave voluntarily.
 * Rejects with LAST_ADMIN_PROTECTED if a lone MOSQUE_ADMIN attempts to leave.
 * NOTE: Defined BEFORE /:membershipId to avoid route shadowing.
 */
membershipRouter.delete(
  "/me",
  authenticate,
  requireMosqueMembership(),
  leaveMosqueHandler,
);

/**
 * DELETE /api/mosques/:mosqueId/members/:membershipId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Removes a member from the mosque (deletes the Membership row).
 * Rejects with LAST_ADMIN_PROTECTED if this would remove the mosque's only MOSQUE_ADMIN.
 */
membershipRouter.delete(
  "/:membershipId",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  removeMemberHandler,
);

export default membershipRouter;
