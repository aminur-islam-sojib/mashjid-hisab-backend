// ---------------------------------------------------------------------------
// Family Router — Tenant-Scoped Household Management
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createFamilyHandler,
  getMosqueFamiliesHandler,
  getFamilyByIdHandler,
  updateFamilyHandler,
  transferFamilyHeadHandler,
  addFamilyMemberHandler,
  updateFamilyMemberHandler,
  removeFamilyMemberHandler,
  getFamilyByMembershipHandler,
  addFamilyMemberByMembershipHandler,
} from "./family.controller.js";

const familyRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/families
 * Access: Authenticated, any ACTIVE member (admin can assign headMembershipId)
 *
 * Creates a Family. One Membership may head at most one Family.
 */
familyRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(),
  createFamilyHandler,
);

/**
 * GET /api/mosques/:mosqueId/families
 * Access: Authenticated, any ACTIVE member (oversight roles see all; plain members see own family)
 *
 * Lists families in the mosque.
 */
familyRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(),
  getMosqueFamiliesHandler,
);

/**
 * GET /api/mosques/:mosqueId/families/member/:membershipId
 * Access: Authenticated, target member or OVERSIGHT
 *
 * Gets family household for a specific member.
 */
familyRouter.get(
  "/member/:membershipId",
  authenticate,
  requireMosqueMembership(),
  getFamilyByMembershipHandler,
);

/**
 * POST /api/mosques/:mosqueId/families/member/:membershipId/members
 * Access: Authenticated, target member or MOSQUE_ADMIN/oversight
 *
 * Adds a family member directly for a member (auto-provisioning household if needed).
 */
familyRouter.post(
  "/member/:membershipId/members",
  authenticate,
  requireMosqueMembership(),
  addFamilyMemberByMembershipHandler,
);

/**
 * GET /api/mosques/:mosqueId/families/:familyId
 * Access: Authenticated, any ACTIVE member — own family only unless the
 * caller holds an oversight role (checked in the service layer).
 */
familyRouter.get(
  "/:familyId",
  authenticate,
  requireMosqueMembership(),
  getFamilyByIdHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/families/:familyId
 * Access: Authenticated, family head or MOSQUE_ADMIN (checked in service layer)
 */
familyRouter.patch(
  "/:familyId",
  authenticate,
  requireMosqueMembership(),
  updateFamilyHandler,
);

/**
 * POST /api/mosques/:mosqueId/families/:familyId/transfer-head
 * Access: Authenticated, current family head or MOSQUE_ADMIN
 *
 * Requires confirm: true in the body — this changes who manages the
 * household's account.
 */
familyRouter.post(
  "/:familyId/transfer-head",
  authenticate,
  requireMosqueMembership(),
  transferFamilyHeadHandler,
);

/**
 * POST /api/mosques/:mosqueId/families/:familyId/members
 * Access: Authenticated, family head or MOSQUE_ADMIN
 *
 * Adds a light FamilyMember record — name + relation required, everything
 * else optional. No login created.
 */
familyRouter.post(
  "/:familyId/members",
  authenticate,
  requireMosqueMembership(),
  addFamilyMemberHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/families/:familyId/members/:memberId
 * Access: Authenticated, family head or MOSQUE_ADMIN
 */
familyRouter.patch(
  "/:familyId/members/:memberId",
  authenticate,
  requireMosqueMembership(),
  updateFamilyMemberHandler,
);

/**
 * DELETE /api/mosques/:mosqueId/families/:familyId/members/:memberId
 * Access: Authenticated, family head or MOSQUE_ADMIN
 *
 * Blocked with FAMILY_MEMBER_LINKED if this member already has their own
 * Membership (via admin-direct-create, Stage 3).
 */
familyRouter.delete(
  "/:familyId/members/:memberId",
  authenticate,
  requireMosqueMembership(),
  removeFamilyMemberHandler,
);

export default familyRouter;

