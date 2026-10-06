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
import config from "../../config/index.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  validateRegisterInput,
  validateLoginInput,
  validateForgotPasswordInput,
  validateResetPasswordInput,
  validateVerifyEmailInput,
  validateChangePasswordInput,
} from "./auth.validation.js";
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
  getAuthenticatedUser,
  requestPasswordReset,
  resetPassword as resetPasswordService,
  verifyEmail as verifyEmailService,
  changePassword as changePasswordService,
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

  // In development, log the simulated email to console and provide token in response
  const verifyUrl = `${config.CLIENT_URL}/verify-email?token=${result.emailVerifyToken}`;
  if (config.NODE_ENV === "development") {
    console.log(`\n============================================================`);
    console.log(`📨 [DEV EMAIL SIMULATOR] Email Verification`);
    console.log(`To:    ${result.user.email}`);
    console.log(`Token: ${result.emailVerifyToken}`);
    console.log(`Link:  ${verifyUrl}`);
    console.log(`============================================================\n`);
  }

  sendResponse(res, {
    statusCode: 201,
    message: "Registration successful. Please verify your email.",
    data: {
      user: result.user,
      memberships: result.memberships,
      accessToken: result.accessToken,
    },
    dev: {
      emailVerifyToken: result.emailVerifyToken,
      emailVerifyUrl: verifyUrl,
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
// POST /api/auth/logout — 200 OK (Authenticated)
// Revokes the current refresh token server-side and clears its cookies.
// The access token simply expires on its own short TTL (15 min).
// ---------------------------------------------------------------------------
export const logout = catchAsync(async (req: Request, res: Response) => {
  const rawRefreshToken = extractRefreshToken(req);
  const userId = req.user?.sub;

  if (rawRefreshToken) {
    await revokeRefreshToken(rawRefreshToken, userId);
  }

  // Clear both auth cookies (refreshToken at /api/auth, accessToken at /)
  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: 200,
    message: "Logged out successfully.",
    data: null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password — 200 OK (Public)
// Always returns constant-time generic success message to prevent user enumeration.
// ---------------------------------------------------------------------------
export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const input = validateForgotPasswordInput(req.body);

  const { rawToken } = await requestPasswordReset(input);

  let devMeta: Record<string, unknown> | undefined;
  if (rawToken) {
    const resetUrl = `${config.CLIENT_URL}/reset-password?token=${rawToken}`;
    if (config.NODE_ENV === "development") {
      console.log(`\n============================================================`);
      console.log(`📨 [DEV EMAIL SIMULATOR] Password Reset`);
      console.log(`To:    ${input.email}`);
      console.log(`Token: ${rawToken}`);
      console.log(`Link:  ${resetUrl}`);
      console.log(`============================================================\n`);
    }
    devMeta = {
      resetToken: rawToken,
      resetUrl,
    };
  }

  sendResponse(res, {
    statusCode: 200,
    message: "If an account with that email exists, password reset instructions have been sent.",
    data: null,
    dev: devMeta,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password — 200 OK (Public with valid token)
// Verifies reset token, sets new password, and bumps sessionVersion
// (which invalidates all existing refresh tokens for the user).
// ---------------------------------------------------------------------------
export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const input = validateResetPasswordInput(req.body);

  await resetPasswordService(input);

  // Clear auth cookies in case the user has cookies from an old session on this browser
  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: 200,
    message: "Password has been reset successfully. Please login with your new password.",
    data: null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-email — 200 OK (Public with valid token)
// Verifies emailed token and marks emailVerified = true.
// Does not bump sessionVersion or affect existing login sessions.
// ---------------------------------------------------------------------------
export const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const input = validateVerifyEmailInput(req.body);

  await verifyEmailService(input);

  sendResponse(res, {
    statusCode: 200,
    message: "Email verified successfully.",
    data: null,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/change-password — 200 OK (Authenticated)
// Verifies caller's current password, sets a new passwordHash, clears mustChangePassword,
// and bumps sessionVersion — invalidating all other sessions.
// ---------------------------------------------------------------------------
export const changePassword = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const activeMosqueId = req.user?.mosqueId;
  const input = validateChangePasswordInput(req.body);

  const result = await changePasswordService(userId, input, activeMosqueId, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // Set fresh auth cookies for the new session version
  setAccessTokenCookie(res, result.accessToken);
  setRefreshTokenCookie(res, result.refreshToken);

  sendResponse(res, {
    statusCode: 200,
    message: "Password changed successfully.",
    data: {
      user: result.user,
      accessToken: result.accessToken,
    },
  });
});

