// =============================================================================
// collection.routes.ts — Express Routing for Domain 8: Collection Sessions
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
  COLLECTION_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createCollectionSessionHandler,
  verifyCollectionSessionHandler,
  getCollectionsHandler,
  getCollectionByIdHandler,
} from "./collection.controller.js";

const collectionRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/collections and POST /api/collections
 * Access: ADMIN, TREAS, STAFF
 * Starts a counting session: occasion, date, counted totalAmount, and a note. Status is OPEN.
 */
collectionRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...COLLECTION_OPERATOR_ROLES),
  createCollectionSessionHandler,
);

/**
 * POST /api/mosques/:mosqueId/collections/:id/verify and POST /api/collections/:id/verify
 * Access: ADMIN, TREAS (a second person, not the counter)
 * Confirms the count. This posts one anonymous income entry to the chosen fund and account.
 */
collectionRouter.post(
  "/:id/verify",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  verifyCollectionSessionHandler,
);

/**
 * GET /api/mosques/:mosqueId/collections and GET /api/collections
 * Access: ADMIN, TREAS, COMM
 * History of counts with who counted and who verified.
 */
collectionRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getCollectionsHandler,
);

/**
 * GET /api/mosques/:mosqueId/collections/:id and GET /api/collections/:id
 * Access: ADMIN, TREAS, COMM
 * Single collection session detail.
 */
collectionRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getCollectionByIdHandler,
);

export default collectionRouter;

