// =============================================================================
// chanda.routes.ts — Express Routing for Domain 7: Monthly Chanda Plans & Dues
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
  ADMIN_ONLY_ROLES,
  COLLECTION_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createChandaPlanHandler,
  getChandaPlansHandler,
  getChandaPlanByIdHandler,
  updateChandaPlanHandler,
  pauseChandaPlanHandler,
  resumeChandaPlanHandler,
  endChandaPlanHandler,
  generateDuesHandler,
  getDuesSummaryHandler,
  getDuesHandler,
  getDueByIdHandler,
  recordDuePaymentHandler,
  waiveDueHandler,
} from "./chanda.controller.js";

// =============================================================================
// 1. Chanda Plans Router
// =============================================================================
export const chandaPlanRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/chanda-plans and POST /api/chanda-plans
 * Access: ADMIN, TREAS
 * Creates a recurring plan for a family or a membership.
 * Needs amount, fundId, frequency (MONTHLY, YEARLY), startMonth.
 * Only one active plan per payer per fund.
 */
chandaPlanRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  createChandaPlanHandler,
);

/**
 * GET /api/mosques/:mosqueId/chanda-plans and GET /api/chanda-plans
 * Access: ADMIN, TREAS, COMM
 * Lists plans. Filter by family, member, status, or fund.
 */
chandaPlanRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getChandaPlansHandler,
);

/**
 * GET /api/mosques/:mosqueId/chanda-plans/:id and GET /api/chanda-plans/:id
 * Access: ADMIN, TREAS, COMM
 * Full detail of a chanda plan.
 */
chandaPlanRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getChandaPlanByIdHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/chanda-plans/:id and PATCH /api/chanda-plans/:id
 * Access: ADMIN, TREAS
 * Changes the amount. It applies from the next period, and already generated dues are untouched.
 */
chandaPlanRouter.patch(
  "/:id",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  updateChandaPlanHandler,
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/pause and POST /api/chanda-plans/:id/pause
 * Access: ADMIN, TREAS
 * Skips dues generation until resumed.
 */
chandaPlanRouter.post(
  "/:id/pause",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  pauseChandaPlanHandler,
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/resume and POST /api/chanda-plans/:id/resume
 * Access: ADMIN, TREAS
 * Resumes generation from the current period.
 */
chandaPlanRouter.post(
  "/:id/resume",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  resumeChandaPlanHandler,
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/end and POST /api/chanda-plans/:id/end
 * Access: ADMIN, TREAS
 * Ends the plan. Unpaid dues stay collectable.
 */
chandaPlanRouter.post(
  "/:id/end",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  endChandaPlanHandler,
);

// =============================================================================
// 2. Dues Router
// =============================================================================
export const dueRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/dues/generate and POST /api/dues/generate
 * Access: ADMIN, TREAS (also run by a scheduled job)
 * Creates dues for a given month from all active plans. Idempotent per (plan, period).
 */
dueRouter.post(
  "/generate",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  generateDuesHandler,
);

/**
 * GET /api/mosques/:mosqueId/dues/summary and GET /api/dues/summary
 * Access: ADMIN, TREAS, COMM
 * Collection rate, total outstanding, and the defaulter list for a period.
 * Must be mounted BEFORE /:id.
 */
dueRouter.get(
  "/summary",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getDuesSummaryHandler,
);

/**
 * GET /api/mosques/:mosqueId/dues and GET /api/dues
 * Access: ADMIN, TREAS, COMM
 * Filters: period, status (UNPAID, PARTIAL, PAID, WAIVED), familyId, memberId, fundId.
 */
dueRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getDuesHandler,
);

/**
 * GET /api/mosques/:mosqueId/dues/:id and GET /api/dues/:id
 * Access: ADMIN, TREAS, COMM
 * Single due detail with linked payments.
 */
dueRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getDueByIdHandler,
);

/**
 * POST /api/mosques/:mosqueId/dues/:id/payments and POST /api/dues/:id/payments
 * Access: ADMIN, TREAS; STAFF (PENDING)
 * Records a payment against a due. Creates a donation entry linked to it.
 * Partial payment is allowed, and overpayment is rejected.
 */
dueRouter.post(
  "/:id/payments",
  authenticate,
  requireMosqueMembership(...COLLECTION_OPERATOR_ROLES),
  recordDuePaymentHandler,
);

/**
 * POST /api/mosques/:mosqueId/dues/:id/waive and POST /api/dues/:id/waive
 * Access: ADMIN
 * Requires reason. Marks the due WAIVED, for example for a family in hardship.
 * It is recorded in the audit log.
 */
dueRouter.post(
  "/:id/waive",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  waiveDueHandler,
);

export default {
  chandaPlanRouter,
  dueRouter,
};

