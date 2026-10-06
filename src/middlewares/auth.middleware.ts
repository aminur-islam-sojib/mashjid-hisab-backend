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
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../errors/HttpError.js";
import { verifyAccessToken, type AccessTokenPayload } from "../utils/token.js";
import { Role, UserStatus } from "../../generated/prisma/client.js";

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
 * Endpoints that an authenticated user is permitted to call even when
 * their account requires an immediate password change (mustChangePassword === true).
 *
 * Requirements:
 *  • /auth/change-password (PATCH) — to set permanent password and clear the flag.
 *  • /auth/me (GET)               — to read user profile & mustChangePassword flag.
 *  • /auth/logout (POST)          — to revoke session and log out.
 */
export function isAllowedWhenPasswordChangeRequired(req: Request): boolean {
  const urlPath = (req.originalUrl || req.url || "").split("?")[0]!.toLowerCase().replace(/\/+$/, "");
  const routePath = `${req.baseUrl || ""}${req.path || ""}`.split("?")[0]!.toLowerCase().replace(/\/+$/, "");

  const isChangePassword =
    urlPath === "/api/auth/change-password" ||
    urlPath === "/auth/change-password" ||
    routePath === "/api/auth/change-password" ||
    routePath === "/auth/change-password";

  const isGetMe =
    urlPath === "/api/auth/me" ||
    urlPath === "/auth/me" ||
    routePath === "/api/auth/me" ||
    routePath === "/auth/me";

  const isLogout =
    urlPath === "/api/auth/logout" ||
    urlPath === "/auth/logout" ||
    routePath === "/api/auth/logout" ||
    routePath === "/auth/logout";

  if (isChangePassword && req.method === "PATCH") return true;
  if (isGetMe && req.method === "GET") return true;
  if (isLogout && req.method === "POST") return true;

  return false;
}

/**
 * Strict authentication middleware.
 * Verifies access token from headers, cookies, or query parameters.
 * Populates `req.user` with AccessTokenPayload.
 * Enforces mandatory password change restriction when mustChangePassword === true.
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

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
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

  req.user = payload;

  // Enforce temporary password change restriction
  if (payload.mustChangePassword && !isAllowedWhenPasswordChangeRequired(req)) {
    throw HttpError.forbidden(
      "Password change required. You must change your temporary password before accessing other resources.",
      "MUST_CHANGE_PASSWORD",
    );
  }

  next();
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

/**
 * Strict Super Admin guard.
 * Must be preceded by `authenticate`.
 *
 * Security guarantees:
 * 1. Checks that the caller is authenticated.
 * 2. Re-verifies live in the database that caller's account status is ACTIVE.
 * 3. Re-verifies live in the database that caller's platform role is strictly SUPER_ADMIN.
 * 4. Never trusts JWT token payload claims alone for platform-critical administrative actions.
 */
export async function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.sub) {
      throw HttpError.unauthorized(
        "Authentication required.",
        "AUTH_UNAUTHORIZED",
      );
    }

    const caller = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!caller) {
      throw HttpError.unauthorized(
        "Authenticated user account not found.",
        "AUTH_USER_NOT_FOUND",
      );
    }

    if (caller.status !== UserStatus.ACTIVE) {
      throw HttpError.forbidden(
        "Access denied. Your account is inactive or blocked.",
        "ACCOUNT_INACTIVE",
      );
    }

    if (caller.role !== Role.SUPER_ADMIN) {
      throw HttpError.forbidden(
        "Access denied. Only platform super administrators can perform this action.",
        "FORBIDDEN_SUPER_ADMIN_REQUIRED",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
