// =============================================================================
// me.routes.ts — Express Routing for Domain 9: Member Self-Service
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireMosqueMembership } from "../../middlewares/mosque.middleware.js";
import {
  getMyDonationsHandler,
  getMyDuesHandler,
  getMyPledgesHandler,
  getMyStatementHandler,
} from "./me.controller.js";

const meRouter: Router = Router({ mergeParams: true });

/**
 * GET /api/me/donations and GET /api/mosques/:mosqueId/me/donations
 * Access: Any ACTIVE member
 * The caller's own donations. A family head also sees family donations (?scope=family).
 */
meRouter.get(
  "/donations",
  authenticate,
  requireMosqueMembership(),
  getMyDonationsHandler,
);

/**
 * GET /api/me/dues and GET /api/mosques/:mosqueId/me/dues
 * Access: Any ACTIVE member
 * Own or family dues with status and what is owed.
 */
meRouter.get(
  "/dues",
  authenticate,
  requireMosqueMembership(),
  getMyDuesHandler,
);

/**
 * GET /api/me/pledges and GET /api/mosques/:mosqueId/me/pledges
 * Access: Any ACTIVE member
 * Own pledges and progress.
 */
meRouter.get(
  "/pledges",
  authenticate,
  requireMosqueMembership(),
  getMyPledgesHandler,
);

/**
 * GET /api/me/statement and GET /api/mosques/:mosqueId/me/statement
 * Access: Any ACTIVE member
 * Annual giving statement (totals per fund) for personal records (?year=YYYY).
 */
meRouter.get(
  "/statement",
  authenticate,
  requireMosqueMembership(),
  getMyStatementHandler,
);

export default meRouter;

