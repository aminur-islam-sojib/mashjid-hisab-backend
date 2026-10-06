// ---------------------------------------------------------------------------
// Transaction Router — Unified Ledger & Approvals
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  getTransactionsHandler,
  getPendingTransactionsHandler,
  getTransactionByIdHandler,
  approveTransactionHandler,
  rejectTransactionHandler,
} from "./transaction.controller.js";

const transactionRouter: Router = Router({ mergeParams: true });

/**
 * GET /api/mosques/:mosqueId/transactions AND GET /api/transactions
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Master ledger query across donations, expenses, and transfers with cursor pagination.
 */
transactionRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getTransactionsHandler,
);

/**
 * GET /api/mosques/:mosqueId/transactions/pending AND GET /api/transactions/pending
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * The approval queue: STAFF entries and over-limit expenses.
 * NOTE: Defined before /:id to avoid param conflict.
 */
transactionRouter.get(
  "/pending",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  getPendingTransactionsHandler,
);

/**
 * GET /api/mosques/:mosqueId/transactions/:id AND GET /api/transactions/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Single entry with its full history (created, approved, voided, rejected).
 */
transactionRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getTransactionByIdHandler,
);

/**
 * POST /api/mosques/:mosqueId/transactions/:id/approve AND POST /api/transactions/:id/approve
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (over-limit expenses: ADMIN only)
 *
 * Moves PENDING to POSTED and assigns receipt/voucher number.
 * Rejects with SELF_APPROVAL_NOT_ALLOWED if approver === creator.
 */
transactionRouter.post(
  "/:id/approve",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  approveTransactionHandler,
);

/**
 * POST /api/mosques/:mosqueId/transactions/:id/reject AND POST /api/transactions/:id/reject
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Requires reason. Marks it REJECTED with no balance effect. Notifies creator.
 */
transactionRouter.post(
  "/:id/reject",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  rejectTransactionHandler,
);

export default transactionRouter;

