// ---------------------------------------------------------------------------
// Fund Router — Tenant-Scoped Fund Management
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import { Role } from "../../../generated/prisma/client.js";
import {
  createFundHandler,
  getMosqueFundsHandler,
  getFundByIdHandler,
  updateFundHandler,
  archiveFundHandler,
} from "./fund.controller.js";

const fundRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/funds
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Creates a Fund (name, type, isRestricted).
 * isRestricted: true is what later locks its Categories at transaction time.
 */
fundRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  createFundHandler,
);

/**
 * GET /api/mosques/:mosqueId/funds
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists active Funds. Pass ?includeArchived=true for the settings screen.
 */
fundRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueFundsHandler,
);

/**
 * GET /api/mosques/:mosqueId/funds/:fundId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Retrieves a single Fund by its ID.
 */
fundRouter.get(
  "/:fundId",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getFundByIdHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/funds/:fundId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Updates name/description/isRestricted.
 * Flipping isRestricted on a Fund that already has transactions is a real policy change
 * requiring explicit confirmation ('confirmPolicyChange: true').
 */
fundRouter.patch(
  "/:fundId",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  updateFundHandler,
);

/**
 * POST /api/mosques/:mosqueId/funds/:fundId/archive
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Soft-deletes the fund (sets isArchived: true).
 * Blocks if the fund has a non-zero balance.
 */
fundRouter.post(
  "/:fundId/archive",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  archiveFundHandler,
);

export default fundRouter;

