// =============================================================================
// audit.routes.ts — Express Router for Financial Audit Logs
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  ADMIN_ONLY_ROLES,
} from "../../middlewares/mosque.middleware.js";
import { getAuditLogsHandler } from "./audit.controller.js";

const auditRouter: Router = Router({ mergeParams: true });

/**
 * GET /audit-logs
 * Access: ADMIN
 *
 * Who did what and when for every money action (create, approve, void, waive, close period).
 * Filters: actor, entity, date.
 */
auditRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  getAuditLogsHandler,
);

export default auditRouter;
