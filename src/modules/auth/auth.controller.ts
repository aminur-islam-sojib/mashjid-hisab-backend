// ---------------------------------------------------------------------------
// Auth Controller — thin HTTP adapter layer.
//
// Responsibilities (ONLY these):
//  • Extract validated input from req
//  • Forward to service
//  • Set auth cookies (both accessToken cookie & refreshToken cookie)
//  • Send a consistent JSON response via sendResponse
//
// Zero business logic lives here. Any thrown HttpError is caught by
// catchAsync and forwarded to the global error-handler middleware.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearAuthCookies,
} from "../../utils/cookie.js";
import { validateRegisterInput, validateLoginInput } from "./auth.validation.js";
import {
  registerUser,
  loginUser,
  getAuthenticatedUser,
} from "./auth.service.js";

// ---------------------------------------------------------------------------
// POST /api/auth/register — 201 Created
// ---------------------------------------------------------------------------
export const register = catchAsync(async (req: Request, res: Response) => {
  const input = validateRegisterInput(req.body);

  const result = await registerUser(input, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // Set cookies for frontend convenience:
  // 1. accessToken cookie (path: "/", maxAge: 15m) — works for cookie-based clients
  // 2. refreshToken cookie (path: "/api/auth", maxAge: 7d) — for refresh endpoint
  setAccessTokenCookie(res, result.accessToken);
  setRefreshTokenCookie(res, result.refreshToken);

  // TODO: enqueue email-verification out-of-band
  // emailQueue.push({ userId: result.user.id, token: result.emailVerifyToken })

  sendResponse(res, {
    statusCode: 201,
    message: "Registration successful. Please verify your email.",
    data: {
      user: result.user,
      memberships: result.memberships,
      accessToken: result.accessToken,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login — 200 OK
// ---------------------------------------------------------------------------
export const login = catchAsync(async (req: Request, res: Response) => {
  const input = validateLoginInput(req.body);

  const result = await loginUser(input, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // Set cookies for both browser cookie-based & token-in-header auth
  setAccessTokenCookie(res, result.accessToken);
  setRefreshTokenCookie(res, result.refreshToken);

  sendResponse(res, {
    statusCode: 200,
    message: "Login successful.",
    data: {
      user: result.user,
      activeMosqueId: result.activeMosqueId,
      role: result.role,
      accessToken: result.accessToken,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me — 200 OK (Protected)
// Resolves user profile and active memberships using the verified token.
// ---------------------------------------------------------------------------
export const getMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const activeMosqueId = req.user!.mosqueId;

  const result = await getAuthenticatedUser(userId, activeMosqueId);

  sendResponse(res, {
    statusCode: 200,
    message: "Current user profile fetched successfully.",
    data: result,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — 200 OK
// Clears both accessToken and refreshToken cookies.
// ---------------------------------------------------------------------------
export const logout = catchAsync(async (_req: Request, res: Response) => {
  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: 200,
    message: "Logged out successfully.",
    data: null,
  });
});
