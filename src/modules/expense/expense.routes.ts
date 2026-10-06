// ---------------------------------------------------------------------------
// Expense Router — Disbursements & Operational Spending
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  EXPENSE_OPERATOR_ROLES,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createExpenseHandler,
  getMosqueExpensesHandler,
  getExpenseByIdHandler,
  updateExpenseHandler,
  voidExpenseHandler,
} from "./expense.controller.js";

const expenseRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/expenses AND POST /api/expenses
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (posts); STAFF (PENDING)
 *
 * Records spending with payee, voucherNo, and attachments.
 * Above approval limit -> PENDING_APPROVAL and needs ADMIN.
 */
expenseRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...EXPENSE_OPERATOR_ROLES),
  createExpenseHandler,
);

/**
 * GET /api/mosques/:mosqueId/expenses AND GET /api/expenses
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Paginated list with the same filters as donations, plus payee.
 */
expenseRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueExpensesHandler,
);

/**
 * GET /api/mosques/:mosqueId/expenses/:id AND GET /api/expenses/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Full detail with attachments and approval trail.
 */
expenseRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getExpenseByIdHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/expenses/:id AND PATCH /api/expenses/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Edits only non-financial fields (notes, payee, attachments).
 * Financial fields (amount, fund, account, date, category, voucher) are rejected with TRANSACTION_IMMUTABLE.
 */
expenseRouter.patch(
  "/:id",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  updateExpenseHandler,
);

/**
 * POST /api/mosques/:mosqueId/expenses/:id/void AND POST /api/expenses/:id/void
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Requires reason. Creates the reversal entry and restores the fund and account balance.
 */
expenseRouter.post(
  "/:id/void",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  voidExpenseHandler,
);

export default expenseRouter;

