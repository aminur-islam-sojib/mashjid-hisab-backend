// =============================================================================
// report.routes.ts — Express Routers for Reports and Period Control
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  getDashboardReportHandler,
  getBalancesReportHandler,
  getIncomeExpenseReportHandler,
  getFundStatementHandler,
  getAccountStatementHandler,
  getDonorsReportHandler,
  getFiscalYearReportHandler,
  createReportExportHandler,
  getReportExportHandler,
  closeAccountingPeriodHandler,
  reopenAccountingPeriodHandler,
} from "./report.controller.js";

const reportRouter: Router = Router({ mergeParams: true });

/**
 * GET /reports/dashboard
 * Access: ADMIN, TREAS, COMM
 */
reportRouter.get(
  "/dashboard",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getDashboardReportHandler,
);

/**
 * GET /reports/balances?asOf=
 * Access: ADMIN, TREAS, COMM
 */
reportRouter.get(
  "/balances",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getBalancesReportHandler,
);

/**
 * GET /reports/income-expense
 * Access: ADMIN, TREAS, COMM
 */
reportRouter.get(
  "/income-expense",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getIncomeExpenseReportHandler,
);

/**
 * GET /reports/funds/:fundId/statement
 * Access: ADMIN, TREAS, COMM
 */
reportRouter.get(
  "/funds/:fundId/statement",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getFundStatementHandler,
);

/**
 * GET /reports/accounts/:accountId/statement
 * Access: ADMIN, TREAS
 */
reportRouter.get(
  "/accounts/:accountId/statement",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  getAccountStatementHandler,
);

/**
 * GET /reports/donors
 * Access: ADMIN, TREAS
 */
reportRouter.get(
  "/donors",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  getDonorsReportHandler,
);

/**
 * GET /reports/fiscal-year/:year
 * Access: ADMIN, TREAS, COMM
 */
reportRouter.get(
  "/fiscal-year/:year",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getFiscalYearReportHandler,
);

/**
 * POST /reports/exports
 * Access: ADMIN, TREAS
 */
reportRouter.post(
  "/exports",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  createReportExportHandler,
);

/**
 * GET /reports/exports/:exportId
 * Access: Requester (or ADMIN, TREAS)
 */
reportRouter.get(
  "/exports/:exportId",
  authenticate,
  requireMosqueMembership(),
  getReportExportHandler,
);

// -----------------------------------------------------------------------------
// Period Router — Accounting Month Locking & Reopening
// -----------------------------------------------------------------------------
const periodRouter: Router = Router({ mergeParams: true });

/**
 * POST /periods/:period/close
 * Access: ADMIN
 */
periodRouter.post(
  "/:period/close",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  closeAccountingPeriodHandler,
);

/**
 * POST /periods/:period/reopen
 * Access: ADMIN
 */
periodRouter.post(
  "/:period/reopen",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  reopenAccountingPeriodHandler,
);

export { reportRouter, periodRouter };
export default reportRouter;

