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
  // 1. Validate & sanitise — throws HttpError on any violation
  const input = validateRegisterInput(req.body);

  // 2. Delegate all business logic to the service
  const result = await registerUser(input, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  // 3. Refresh token → httpOnly cookie only (never exposed in the body)
  setRefreshTokenCookie(res, result.refreshToken);

  // 4. TODO: enqueue email-verification email out-of-band
  //    emailQueue.push({ userId: result.user.id, token: result.emailVerifyToken })

  // 5. Respond — exact agreed shape
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
