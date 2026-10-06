// =============================================================================
// pledge.routes.ts — Express Routing for Domain 6: Pledges
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createPledgeHandler,
  getPledgesHandler,
  getPledgeByIdHandler,
  cancelPledgeHandler,
} from "./pledge.controller.js";

const pledgeRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/pledges and POST /api/pledges
 * Access: MEMBER (for self or own family); ADMIN, TREAS (for anyone)
 * Records a promise: amount, fundId or campaignId, dueDate, optional installments.
 * Creates no ledger entry.
 */
pledgeRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(),
  createPledgeHandler,
);

/**
 * GET /api/mosques/:mosqueId/pledges and GET /api/pledges
 * Access: ADMIN, TREAS, COMM
 * Lists pledges with paid and remaining amounts. Filter by status (OPEN, PARTIAL, FULFILLED, CANCELLED).
 */
pledgeRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getPledgesHandler,
);

/**
 * POST /api/mosques/:mosqueId/pledges/:id/cancel and POST /api/pledges/:id/cancel
 * Access: Pledger or ADMIN
 * Cancels the open balance. Payments already made stay.
 */
pledgeRouter.post(
  "/:id/cancel",
  authenticate,
  requireMosqueMembership(),
  cancelPledgeHandler,
);

/**
 * GET /api/mosques/:mosqueId/pledges/:id and GET /api/pledges/:id
 * Access: ADMIN, TREAS, COMM; MEMBER (own or own family only)
 * Shows the pledge with the donations that paid it.
 */
pledgeRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(),
  getPledgeByIdHandler,
);

export default pledgeRouter;

