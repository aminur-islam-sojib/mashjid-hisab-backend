// ---------------------------------------------------------------------------
// Cookie helpers — centralised cookie options so every auth endpoint
// sets/clears access and refresh tokens with identical, production-ready settings.
// ---------------------------------------------------------------------------

import type { CookieOptions, Response } from "express";
import config from "../config/index.js";

export const ACCESS_COOKIE_NAME = "accessToken" as const;
export const REFRESH_COOKIE_NAME = "refreshToken" as const;

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,                                    // inaccessible to document.cookie (XSS-safe)
  secure: config.NODE_ENV === "production",          // HTTPS only in production
  sameSite: config.NODE_ENV === "production" ? "strict" : "lax",
};

/**
 * Access token cookie options.
 * path: "/" ensures it is sent on every API route (/api/auth, /api/mosques, etc.)
 */
export const ACCESS_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  path: "/",
  maxAge: config.JWT_ACCESS_EXPIRES_IN_MS,
};

/**
 * Refresh token cookie options.
 * path: "/api/auth" limits transmission to auth refresh/logout endpoints only.
 */
export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  path: "/api/auth",
  maxAge: config.JWT_REFRESH_EXPIRES_IN_MS,
};

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE_NAME, token, ACCESS_COOKIE_OPTIONS);
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken?: string; refreshToken?: string },
): void {
  if (tokens.accessToken) {
    setAccessTokenCookie(res, tokens.accessToken);
  }
  if (tokens.refreshToken) {
    setRefreshTokenCookie(res, tokens.refreshToken);
  }
}

export function clearAccessTokenCookie(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, {
    ...BASE_COOKIE_OPTIONS,
    path: "/",
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...BASE_COOKIE_OPTIONS,
    path: "/api/auth",
  });
}

export function clearAuthCookies(res: Response): void {
  clearAccessTokenCookie(res);
  clearRefreshTokenCookie(res);
}
