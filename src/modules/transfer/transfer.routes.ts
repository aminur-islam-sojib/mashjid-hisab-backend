// ---------------------------------------------------------------------------
// Transfer Router — Account & Fund Transfers
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  FINANCIAL_OPERATOR_ROLES,
  OVERSIGHT_ROLES,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createTransferHandler,
  getMosqueTransfersHandler,
  getTransferByIdHandler,
  voidTransferHandler,
} from "./transfer.controller.js";

const transferRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/transfers AND POST /api/transfers
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 * Note: Fund-to-fund transfers require MOSQUE_ADMIN and a mandatory reason.
 *
 * Moves money between accounts within one fund (e.g. cash to bank deposit)
 * or between funds. Creates two linked entries atomically.
 */
transferRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  createTransferHandler,
);

/**
 * GET /api/mosques/:mosqueId/transfers AND GET /api/transfers
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists transfers as linked pairs with pagination and filters.
 */
transferRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueTransfersHandler,
);

/**
 * GET /api/mosques/:mosqueId/transfers/:id AND GET /api/transfers/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Full detail of a transfer linked pair.
 */
transferRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getTransferByIdHandler,
);

/**
 * POST /api/mosques/:mosqueId/transfers/:id/void AND POST /api/transfers/:id/void
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Requires reason. Reverses both legs together atomically and restores balances.
 */
transferRouter.post(
  "/:id/void",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  voidTransferHandler,
);

export default transferRouter;

