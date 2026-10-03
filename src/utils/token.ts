// ---------------------------------------------------------------------------
// Token utilities — JWT signing/verification + opaque token generation.
//
// Rules enforced here:
//  • Access token  — short-lived (15 m default), signed with ACCESS secret.
//  • Refresh token — long-lived, signed with REFRESH secret, stored as hash.
//  • Email-verify  — opaque random hex; only the hash is persisted.
//  • Password-reset — same pattern as email-verify.
//
// We keep crypto operations in one place so the algorithm and secret
// rotation strategy are changed in exactly one file.
// ---------------------------------------------------------------------------

import jwt from "jsonwebtoken";
import crypto from "crypto";
import config from "../config/index.js";
import { Role } from "../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessTokenPayload {
  sub: string;           // userId
  mosqueId: string | null;
  role: Role | null;
  sessionVersion: number;
}

export interface RefreshTokenPayload {
  sub: string;           // userId
  jti: string;           // unique token id — used to locate the DB row
  mosqueId: string | null;
  role: Role | null;
  sessionVersion: number;
}

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: Math.floor(config.JWT_REFRESH_EXPIRES_IN_MS / 1000) as jwt.SignOptions["expiresIn"],
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

// ---------------------------------------------------------------------------
// Opaque token helpers (email verify / password reset)
// ---------------------------------------------------------------------------

/** Returns { raw, hash }. Persist only the hash; send the raw value to user. */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex"); // 64-char hex string
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/** Hash an incoming raw token for DB look-up. */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Compute expiry Date given a TTL in milliseconds. */
export function tokenExpiresAt(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}
