// ---------------------------------------------------------------------------
// Cookie helpers — centralised cookie options so every auth endpoint
// sets/clears the refresh-token cookie with identical settings.
// ---------------------------------------------------------------------------

import type { CookieOptions, Response } from "express";
import config from "../config/index.js";

const REFRESH_COOKIE_NAME = "refreshToken" as const;

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,                                    // not accessible via JS
  secure: config.NODE_ENV === "production",          // HTTPS only in prod
  sameSite: config.NODE_ENV === "production" ? "strict" : "lax",
  path: "/api/auth",                                 // only sent to auth routes
};

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: config.JWT_REFRESH_EXPIRES_IN_MS,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, BASE_COOKIE_OPTIONS);
}

export { REFRESH_COOKIE_NAME };
