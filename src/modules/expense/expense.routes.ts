// ---------------------------------------------------------------------------
// Expense Router — Disbursements & Operational Spending
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  EXPENSE_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import { createExpenseHandler } from "./expense.controller.js";

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

export default expenseRouter;

