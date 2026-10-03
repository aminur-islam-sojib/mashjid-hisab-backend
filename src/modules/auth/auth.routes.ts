// ---------------------------------------------------------------------------
// Auth Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import {
  register,
  login,
  refresh,
  getMe,
  logout,
} from "./auth.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const authRouter: Router = Router();

/**
 * POST /api/auth/register
 * Public — create a new User + Profile (+ optional Membership).
 */
authRouter.post("/register", register);

/**
 * POST /api/auth/login
 * Public — verify credentials, load active memberships, issue token pair & cookies.
 */
authRouter.post("/login", login);

/**
 * POST /api/auth/refresh
 * Public (with valid refresh token) — verifies refresh token against stored hash
 * and user's sessionVersion, issuing a fresh access token with the same activeMosqueId & role.
 */
authRouter.post("/refresh", refresh);

/**
 * GET /api/auth/me
 * Protected — reads access token from cookie, Authorization header (with/without Bearer),
 * custom header (x-access-token), or query parameter, and returns user + memberships.
 */
authRouter.get("/me", authenticate, getMe);

/**
 * POST /api/auth/logout
 * Revokes refresh token in the database and clears authentication cookies.
 */
authRouter.post("/logout", logout);

export default authRouter;
