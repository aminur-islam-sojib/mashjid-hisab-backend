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
import { HttpError } from "../../errors/HttpError.js";
import { validateRegisterInput, validateLoginInput } from "./auth.validation.js";
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
  getAuthenticatedUser,
} from "./auth.service.js";

/**
 * Extracts refresh token from httpOnly cookie, request body, or custom header.
 * Primary: httpOnly cookie.
 * Secondary: body / header (for mobile clients, Postman, curl).
 */
function extractRefreshToken(req: Request): string | null {
  // 1. Primary: httpOnly cookie
  if (req.cookies) {
    if (typeof req.cookies.refreshToken === "string" && req.cookies.refreshToken.trim()) {
      return req.cookies.refreshToken.trim();
    }
    if (typeof req.cookies.refresh_token === "string" && req.cookies.refresh_token.trim()) {
      return req.cookies.refresh_token.trim();
    }
  }

  // 2. Secondary fallback: request body
  if (req.body && typeof req.body === "object") {
    const bodyObj = req.body as Record<string, unknown>;
    if (typeof bodyObj["refreshToken"] === "string" && bodyObj["refreshToken"].trim()) {
      return bodyObj["refreshToken"].trim();
    }
    if (typeof bodyObj["refresh_token"] === "string" && bodyObj["refresh_token"].trim()) {
      return bodyObj["refresh_token"].trim();
    }
  }

  // 3. Fallback: custom header
  const headerToken = req.headers["x-refresh-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/auth/register — 201 Created
// ---------------------------------------------------------------------------
export const register = catchAsync(async (req: Request, res: Response) => {
  const input = validateRegisterInput(req.body);

  const result = await registerUser(input, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // Set cookies for frontend convenience
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
// POST /api/auth/refresh — 200 OK
// Verifies the refresh token (httpOnly cookie) against stored hash & sessionVersion.
// Issues a new short-lived access token carrying the same activeMosqueId & role snapshot.
// ---------------------------------------------------------------------------
export const refresh = catchAsync(async (req: Request, res: Response) => {
  const rawRefreshToken = extractRefreshToken(req);

  if (!rawRefreshToken) {
    throw HttpError.unauthorized(
      "Refresh token is required.",
      "AUTH_REFRESH_TOKEN_REQUIRED",
    );
  }

  const result = await refreshAccessToken(rawRefreshToken);

  // Automatically update the accessToken cookie for browser sessions
  setAccessTokenCookie(res, result.accessToken);

  sendResponse(res, {
    statusCode: 200,
    message: "Access token refreshed successfully.",
    data: {
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
// Revokes the refresh token in the database and clears auth cookies.
// ---------------------------------------------------------------------------
export const logout = catchAsync(async (req: Request, res: Response) => {
  const rawRefreshToken = extractRefreshToken(req);
  if (rawRefreshToken) {
    await revokeRefreshToken(rawRefreshToken);
  }

  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: 200,
    message: "Logged out successfully.",
    data: null,
  });
});
