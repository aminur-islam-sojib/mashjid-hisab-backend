// ---------------------------------------------------------------------------
// Auth Controller — thin HTTP adapter layer.
//
// Responsibilities (ONLY these):
//  • Extract validated input from req
//  • Forward to service
//  • Set the httpOnly refresh-token cookie
//  • Send a consistent JSON response via sendResponse
//
// Zero business logic lives here. Any thrown HttpError is caught by
// catchAsync and forwarded to the global error-handler middleware.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { setRefreshTokenCookie } from "../../utils/cookie.js";
import { validateRegisterInput } from "./auth.validation.js";
import { registerUser } from "./auth.service.js";

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
export const register = catchAsync(async (req: Request, res: Response) => {
  // 1. Validate & sanitise input — throws HttpError on failure
  const input = validateRegisterInput(req.body);

  // 2. Delegate to service
  const result = await registerUser(input, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // 3. Place refresh token in an httpOnly cookie (never in the body)
  setRefreshTokenCookie(res, result.tokens.refreshToken);

  // 4. TODO: dispatch email-verification email
  //    e.g. emailQueue.push({ userId: result.user.id, token: result.emailVerifyToken })
  //    Kept out of the request cycle so a slow mail server can't delay the response.

  // 5. Respond — access token in body, refresh token already in cookie
  sendResponse(res, {
    statusCode: 201,
    message: "Registration successful. Please verify your email.",
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
    },
  });
});
