// ---------------------------------------------------------------------------
// Mosque Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireMosqueMembership } from "../../middlewares/mosque.middleware.js";
import { Role } from "../../../generated/prisma/client.js";
import {
  createMosqueHandler,
  getUserMosquesHandler,
  getMosqueSettingsHandler,
  updateMosqueHandler,
} from "./mosque.controller.js";

const mosqueRouter: Router = Router();

/**
 * GET /api/mosques
 * Access: Authenticated
 *
 * Lists every mosque the caller has an ACTIVE Membership in — powers the mosque switcher.
 */
mosqueRouter.get("/", authenticate, getUserMosquesHandler);

/**
 * GET /api/mosques/:mosqueId
 * Access: Authenticated + any role in that mosque
 *
 * Full mosque settings (name, address, timezone, fiscalYearStart).
 * 404s (not 403) if the caller has no Membership there — don't reveal the mosque exists.
 */
mosqueRouter.get(
  "/:mosqueId",
  authenticate,
  requireMosqueMembership(),
  getMosqueSettingsHandler,
);

/**
 * PATCH /api/mosques/:mosqueId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Updates name/address/timezone/fiscalYearStart.
 * Changing fiscalYearStart mid-year requires explicit confirmation ('confirmFiscalYearChange: true').
 */
mosqueRouter.patch(
  "/:mosqueId",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  updateMosqueHandler,
);

/**
 * POST /api/mosques
 * Access: Authenticated
 *
 * Creates the Mosque, then in the same database transaction creates a Membership
 * for the caller with role: MOSQUE_ADMIN, status: ACTIVE.
 * This is the only way a new tenant comes into existence.
 */
mosqueRouter.post("/", authenticate, createMosqueHandler);

export default mosqueRouter;
