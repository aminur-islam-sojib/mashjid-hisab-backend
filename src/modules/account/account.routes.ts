// ---------------------------------------------------------------------------
// Account Router — Tenant-Scoped Account Management
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  FINANCIAL_OPERATOR_ROLES,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createAccountHandler,
  getAccountByIdHandler,
  getMosqueAccountsHandler,
} from "./account.controller.js";

const accountRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/accounts
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Creates an Account (name, type, accountNumber, openingBalance).
 * openingBalance is write-once in practice.
 */
accountRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  createAccountHandler,
);

/**
 * GET /api/mosques/:mosqueId/accounts
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists active Accounts. Pass ?includeArchived=true for the settings screen.
 * Sensitive information (accountNumber) is included here.
 */
accountRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueAccountsHandler,
);

/**
 * GET /api/mosques/:mosqueId/accounts/:accountId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Retrieves a single Account by its ID.
 */
accountRouter.get(
  "/:accountId",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getAccountByIdHandler,
);

export default accountRouter;
