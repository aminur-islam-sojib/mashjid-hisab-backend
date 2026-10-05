// ---------------------------------------------------------------------------
// Category Router — Tenant-Scoped Category Management
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  FINANCIAL_OPERATOR_ROLES,
  OPERATIONAL_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createCategoryHandler,
  getCategoryByIdHandler,
  getMosqueCategoriesHandler,
} from "./category.controller.js";

const categoryRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/categories
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Creates a Category (name, type: INCOME|EXPENSE, optional fundId).
 * Setting fundId is what restricts this category to one Fund only.
 */
categoryRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  createCategoryHandler,
);

/**
 * GET /api/mosques/:mosqueId/categories
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Lists Categories for a mosque, filterable by ?type= and ?fundId=.
 * STAFF is included so they can select categories when submitting or recording operational expenses.
 */
categoryRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OPERATIONAL_ROLES),
  getMosqueCategoriesHandler,
);

/**
 * GET /api/mosques/:mosqueId/categories/:categoryId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Retrieves a single Category by its ID.
 */
categoryRouter.get(
  "/:categoryId",
  authenticate,
  requireMosqueMembership(...OPERATIONAL_ROLES),
  getCategoryByIdHandler,
);

export default categoryRouter;
