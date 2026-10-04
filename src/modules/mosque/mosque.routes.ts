// ---------------------------------------------------------------------------
// Mosque Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { createMosqueHandler } from "./mosque.controller.js";

const mosqueRouter: Router = Router();

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
