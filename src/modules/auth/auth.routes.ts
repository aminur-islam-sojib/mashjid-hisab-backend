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
  forgotPassword,
  resetPassword,
  verifyEmail,
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
 * Authenticated — revokes the current refresh token server-side and clears cookies.
 */
authRouter.post("/logout", authenticate, logout);

/**
 * POST /api/auth/forgot-password
 * Public — generates password reset token and emails it. Returns constant-time
 * generic success response to prevent account enumeration.
 */
authRouter.post("/forgot-password", forgotPassword);

/**
 * POST /api/auth/reset-password
 * Public (with valid reset token) — verifies token, updates password, and bumps
 * sessionVersion (invalidating existing refresh tokens on all devices).
 */
authRouter.post("/reset-password", resetPassword);

/**
 * POST /api/auth/verify-email
 * Public (with valid verify token) — verifies emailed token and marks emailVerified = true.
 */
authRouter.post("/verify-email", verifyEmail);

export default authRouter;
