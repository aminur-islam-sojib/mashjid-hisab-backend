// ---------------------------------------------------------------------------
// Authentication & Authorization Middlewares
//
// Flexible token extraction support:
//  • Headers:
//      - `Authorization: Bearer <token>`
//      - `Authorization: <token>` (without Bearer keyword)
//      - `Authorization: JWT <token>` or `Authorization: Token <token>`
//      - Custom headers: `x-access-token`, `access-token`, `x-token`, `token`
//  • Cookies:
//      - `req.cookies.accessToken`
//      - `req.cookies.access_token`
//      - `req.cookies.token`
//  • Query parameters (great for SSE, WebSockets, downloads):
//      - `?token=<token>`, `?accessToken=<token>`, `?access_token=<token>`
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../errors/HttpError.js";
import { verifyAccessToken, type AccessTokenPayload } from "../utils/token.js";
import type { Role } from "../../generated/prisma/client.js";

/**
 * Extracts the access token from any possible location in the incoming request:
 * 1. Authorization header (with or without 'Bearer' / 'JWT' / 'Token' prefix)
 * 2. Cookies (accessToken, access_token, token)
 * 3. Custom headers (x-access-token, access-token, token)
 * 4. Query parameters (token, accessToken, access_token)
 */
export function extractAccessToken(req: Request): string | null {
  // 1. Authorization header
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const trimmed = authHeader.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/);
      // Case A: "Bearer <token>", "JWT <token>", "Token <token>"
      if (parts.length === 2 && /^(bearer|jwt|token)$/i.test(parts[0]!)) {
        return parts[1]!.trim();
      }
      // Case B: Direct raw token without scheme prefix, e.g. "Authorization: eyJhbGci..."
      if (parts.length === 1 && !/^(bearer|jwt|token)$/i.test(parts[0]!)) {
        return parts[0]!.trim();
      }
    }
  }

  // 2. Cookie extraction
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (cookies) {
    if (cookies.accessToken) return cookies.accessToken;
    if (cookies.access_token) return cookies.access_token;
    if (cookies.token) return cookies.token;
  }

  const signedCookies = (
    req as unknown as { signedCookies?: Record<string, string | undefined> }
  ).signedCookies;
  if (signedCookies) {
    if (signedCookies.accessToken) return signedCookies.accessToken;
    if (signedCookies.access_token) return signedCookies.access_token;
    if (signedCookies.token) return signedCookies.token;
  }

  // 3. Custom headers
  const customHeader =
    req.headers["x-access-token"] ||
    req.headers["access-token"] ||
    req.headers["x-token"] ||
    req.headers["token"];

  if (typeof customHeader === "string" && customHeader.trim()) {
    const trimmed = customHeader.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length === 2 && /^(bearer|jwt|token)$/i.test(parts[0]!)) {
      return parts[1]!.trim();
    }
    return trimmed;
  }

  // 4. Query string parameter fallback (e.g. EventSource / SSE / file export)
  const query = req.query as Record<string, unknown> | undefined;
  if (query) {
    const queryToken =
      query.token || query.accessToken || query.access_token;
    if (typeof queryToken === "string" && queryToken.trim()) {
      return queryToken.trim();
    }
  }

  return null;
}

/**
 * Strict authentication middleware.
 * Verifies access token from headers, cookies, or query parameters.
 * Populates `req.user` with AccessTokenPayload.
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractAccessToken(req);

  if (!token) {
    throw HttpError.unauthorized(
      "Authentication required. No access token provided in headers, cookies, or query parameters.",
      "AUTH_UNAUTHORIZED",
    );
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw HttpError.unauthorized(
        "Access token has expired. Please refresh your session.",
        "AUTH_TOKEN_EXPIRED",
      );
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw HttpError.unauthorized(
        "Invalid access token.",
        "AUTH_TOKEN_INVALID",
      );
    }
    throw HttpError.unauthorized(
      "Failed to authenticate access token.",
      "AUTH_UNAUTHORIZED",
    );
  }
}

/**
 * Optional authentication middleware.
 * Populates `req.user` if a valid token is provided, otherwise continues silently.
 */
export function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractAccessToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // Ignore token validation errors on optional routes
    }
  }
  next();
}

/**
 * Role-based authorization guard.
 * Must be preceded by `authenticate`.
 */
export function authorizeRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw HttpError.unauthorized(
        "Authentication required.",
        "AUTH_UNAUTHORIZED",
      );
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      throw HttpError.forbidden(
        "You do not have permission to perform this action in this mosque context.",
        "FORBIDDEN",
      );
    }

    next();
  };
}
