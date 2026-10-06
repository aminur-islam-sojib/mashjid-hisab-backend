// ---------------------------------------------------------------------------
// Expense Router — Disbursements & Operational Spending
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  EXPENSE_OPERATOR_ROLES,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createExpenseHandler,
  getMosqueExpensesHandler,
  getExpenseByIdHandler,
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

export default expenseRouter;

