// ---------------------------------------------------------------------------
// Auth Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { register } from "./auth.controller.js";

const authRouter: Router = Router();

/**
 * POST /api/auth/register
 * Public — create a new User + Profile (+ optional Membership).
 */
authRouter.post("/register", register);

export default authRouter;
