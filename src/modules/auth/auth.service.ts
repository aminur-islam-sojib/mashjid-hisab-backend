// ---------------------------------------------------------------------------
// Auth Service — register + login + refresh + me + logout
//
// Responsibilities:
//  1. Uniqueness check (email + phone) — before hashing to avoid wasted work.
//  2. Atomic DB transaction: User + Profile + optional Membership.
//  3. Email-verification token issued and persisted (hash only).
//  4. Refresh token row created (hash only) + JWT pair issued.
//  5. Refresh token verification against stored hash & user sessionVersion.
//  6. Returns only what the controller needs — no raw passwords or hashes
//     ever leave this layer.
//
// Error strategy: throw HttpError for domain violations. Unexpected DB errors
// surface as unhandled rejections caught by catchAsync → global error handler.
// ---------------------------------------------------------------------------

import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { prisma } from "../../lib/prisma.js";
import config from "../../config/index.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateOpaqueToken,
  hashToken,
  tokenExpiresAt,
  type RefreshTokenPayload,
} from "../../utils/token.js";
import type {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from "./auth.validation.js";
import {
  MembershipStatus,
  Role,
  UserStatus,
  type Membership,
} from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type PublicMembership = Pick<
  Membership,
  "id" | "mosqueId" | "role" | "status"
>;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  emailVerified: boolean;
  status: UserStatus;
  role: Role | null;
}

// ---------------------------------------------------------------------------
// Register result
// ---------------------------------------------------------------------------

export interface RegisterResult {
  user: PublicUser;
  memberships: PublicMembership[];
  accessToken: string;
  /** Raw refresh JWT — controller puts this in an httpOnly cookie only */
  refreshToken: string;
  /** Raw email-verification token — hand to email queue, never the client */
  emailVerifyToken: string;
}

// ---------------------------------------------------------------------------
// Login result
// ---------------------------------------------------------------------------

export interface LoginResult {
  user: PublicUser;
  /** Null when user has 0 or >1 active memberships (must call switch-mosque) */
  activeMosqueId: string | null;
  role: Role | null;
  accessToken: string;
  /** Raw refresh JWT — controller puts this in an httpOnly cookie only */
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Refresh result
// ---------------------------------------------------------------------------

export interface RefreshResult {
  accessToken: string;
  activeMosqueId: string | null;
  role: Role | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the single active mosque context for token claims.
 * • Exactly 1 ACTIVE membership → auto-selected.
 * • 0 or >1                     → null (client must call switch-mosque).
 */
function resolveActiveMembership(
  memberships: PublicMembership[],
): PublicMembership | null {
  const active = memberships.filter(
    (m) => m.status === MembershipStatus.ACTIVE,
  );
  return active.length === 1 && active[0] ? active[0] : null;
}

/**
 * Determine if the identifier string is an email or a phone number.
 * Used to route the DB lookup in loginUser.
 */
function classifyIdentifier(identifier: string): "email" | "phone" {
  return identifier.includes("@") ? "email" : "phone";
}

/**
 * Bcrypt dummy hash — used when the user is not found so the response time
 * is indistinguishable from a failed-password attempt (timing-safe login).
 * Generated with bcrypt.hash("__dummy__", 12) — safe to hardcode.
 */
const DUMMY_HASH =
  "$2b$12$eKVJklSSTIe7T5LBnYuMPOCRBEdp8DFtKMExplmCPOFr0uFRWS0uy";

// ---------------------------------------------------------------------------
// Issue a refresh token DB row and return the raw JWT
// ---------------------------------------------------------------------------

async function issueRefreshToken(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  {
    userId,
    sessionVersion,
    activeMembership,
    meta,
    jti,
  }: {
    userId: string;
    sessionVersion: number;
    activeMembership: PublicMembership | null;
    meta: { userAgent?: string; ipAddress?: string };
    jti: string;
  },
): Promise<string> {
  const rawRefreshJwt = signRefreshToken({
    sub: userId,
    jti,
    mosqueId: activeMembership?.mosqueId ?? null,
    role: activeMembership?.role ?? null,
    sessionVersion,
  });

  const tokenHash = hashToken(rawRefreshJwt);

  await tx.refreshToken.create({
    data: {
      userId,
      tokenHash,
      mosqueId: activeMembership?.mosqueId ?? null,
      role: activeMembership?.role ?? null,
      expiresAt: tokenExpiresAt(config.JWT_REFRESH_EXPIRES_IN_MS),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  return rawRefreshJwt;
}

// ---------------------------------------------------------------------------
// registerUser
// ---------------------------------------------------------------------------

export async function registerUser(
  input: RegisterInput,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<RegisterResult> {
  const { name, email, phone, password, mosqueId, locale } = input;

  // -------------------------------------------------------------------------
  // 1. Pre-flight uniqueness checks — parallel, outside the transaction
  // -------------------------------------------------------------------------
  const [existingEmail, existingPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    phone
      ? prisma.user.findUnique({ where: { phone }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (existingEmail) {
    throw HttpError.conflict(
      "An account with this email already exists.",
      "AUTH_EMAIL_TAKEN",
    );
  }
  if (existingPhone) {
    throw HttpError.conflict(
      "An account with this phone number already exists.",
      "AUTH_PHONE_TAKEN",
    );
  }

  // -------------------------------------------------------------------------
  // 2. Verify mosque exists before opening the transaction
  // -------------------------------------------------------------------------
  if (mosqueId) {
    const mosque = await prisma.mosque.findUnique({
      where: { id: mosqueId },
      select: { id: true },
    });
    if (!mosque) {
      throw HttpError.notFound(
        `Mosque with id "${mosqueId}" does not exist.`,
        "MOSQUE_NOT_FOUND",
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. CPU-expensive work BEFORE the transaction — keeps DB connection short
  // -------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  // -------------------------------------------------------------------------
  // 4. Prepare token material (sync) before opening the transaction
  // -------------------------------------------------------------------------
  const { raw: rawEmailToken, hash: emailTokenHash } = generateOpaqueToken();
  const refreshJti = crypto.randomUUID();

  // -------------------------------------------------------------------------
  // 5. Atomic transaction — User + Profile + optional Membership +
  //    EmailVerificationToken + RefreshToken (hash only)
  // -------------------------------------------------------------------------
  const { createdUser, memberships, rawRefreshJwt } =
    await prisma.$transaction(async (tx) => {
      // 5a. User + Profile (nested write = 1 round-trip)
      const createdUser = await tx.user.create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          locale: locale ?? "bn",
          emailVerified: false,
          sessionVersion: 1,
          profile: { create: {} },
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          locale: true,
          emailVerified: true,
          status: true,
          role: true,
          sessionVersion: true,
        },
      });

      // 5b. Optional Membership
      const memberships: PublicMembership[] = [];
      if (mosqueId) {
        const membership = await tx.membership.create({
          data: {
            userId: createdUser.id,
            mosqueId,
            role: Role.MEMBER,
            status: MembershipStatus.PENDING, // ACTIVE once approval flow is built
          },
          select: { id: true, mosqueId: true, role: true, status: true },
        });
        memberships.push(membership);
      }

      // 5c. Email-verification token — hash only in DB
      await tx.emailVerificationToken.create({
        data: {
          userId: createdUser.id,
          tokenHash: emailTokenHash,
          expiresAt: tokenExpiresAt(config.EMAIL_VERIFY_TOKEN_TTL_MS),
        },
      });

      // 5d. Refresh token (hash only)
      const activeMembership = resolveActiveMembership(memberships);
      const rawRefreshJwt = await issueRefreshToken(tx, {
        userId: createdUser.id,
        sessionVersion: createdUser.sessionVersion,
        activeMembership,
        meta,
        jti: refreshJti,
      });

      return { createdUser, memberships, rawRefreshJwt };
    });

  // -------------------------------------------------------------------------
  // 6. Sign access token (outside transaction — purely in-memory)
  // -------------------------------------------------------------------------
  const activeMembership = resolveActiveMembership(memberships);

  const accessToken = signAccessToken({
    sub: createdUser.id,
    mosqueId: activeMembership?.mosqueId ?? null,
    role: activeMembership?.role ?? null,
    sessionVersion: createdUser.sessionVersion,
  });

  return {
    user: {
      id: createdUser.id,
      name: createdUser.name,
      email: createdUser.email,
      phone: createdUser.phone ?? null,
      locale: createdUser.locale,
      emailVerified: createdUser.emailVerified,
      status: createdUser.status,
      role: createdUser.role ?? null,
    },
    memberships,
    accessToken,
    refreshToken: rawRefreshJwt,
    emailVerifyToken: rawEmailToken,
  };
}

// ---------------------------------------------------------------------------
// loginUser
// ---------------------------------------------------------------------------

export async function loginUser(
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<LoginResult> {
  const { identifier, password } = input;

  // -------------------------------------------------------------------------
  // 1. Locate the user by email or phone
  // -------------------------------------------------------------------------
  const type = classifyIdentifier(identifier);

  const user = await prisma.user.findUnique({
    where:
      type === "email"
        ? { email: identifier.toLowerCase() }
        : { phone: identifier },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      locale: true,
      emailVerified: true,
      status: true,
      role: true,
      passwordHash: true,
      sessionVersion: true,
    },
  });

  // -------------------------------------------------------------------------
  // 2. Verify password — ALWAYS run bcrypt.compare even when user is not
  //    found to prevent timing attacks that reveal account existence.
  // -------------------------------------------------------------------------
  const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatch) {
    throw HttpError.unauthorized(
      "Email or password is incorrect.",
      "AUTH_INVALID_CREDENTIALS",
    );
  }

  // -------------------------------------------------------------------------
  // 2b. Account status check — block banned / deactivated accounts immediately
  // -------------------------------------------------------------------------
  if (user.status === UserStatus.BLOCKED) {
    throw HttpError.forbidden(
      "Your account has been blocked. Please contact support.",
      "ACCOUNT_BLOCKED",
    );
  }

  if (user.status === UserStatus.INACTIVE) {
    throw HttpError.forbidden(
      "Your account is inactive. Please contact support to reactivate your account.",
      "ACCOUNT_INACTIVE",
    );
  }

  // -------------------------------------------------------------------------
  // 3. Load ALL active memberships for this user
  // -------------------------------------------------------------------------
  const memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      status: MembershipStatus.ACTIVE,
    },
    select: { id: true, mosqueId: true, role: true, status: true },
  });

  // -------------------------------------------------------------------------
  // 4. Resolve mosque context & effective role
  //    • 1 ACTIVE membership → embed mosqueId + membership role
  //    • 0 or >1             → null mosqueId + fallback to user.role (e.g. SUPER_ADMIN)
  // -------------------------------------------------------------------------
  const activeMembership = resolveActiveMembership(memberships);
  const effectiveRole = activeMembership?.role ?? user.role ?? null;

  // -------------------------------------------------------------------------
  // 5. Issue token pair
  // -------------------------------------------------------------------------
  const refreshJti = crypto.randomUUID();

  const rawRefreshJwt = await prisma.$transaction(async (tx) => {
    return issueRefreshToken(tx, {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      activeMembership,
      meta,
      jti: refreshJti,
    });
  });

  const accessToken = signAccessToken({
    sub: user.id,
    mosqueId: activeMembership?.mosqueId ?? null,
    role: effectiveRole,
    sessionVersion: user.sessionVersion,
  });

  // -------------------------------------------------------------------------
  // 6. Return clean public shape
  // -------------------------------------------------------------------------
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      locale: user.locale,
      emailVerified: user.emailVerified,
      status: user.status,
      role: user.role ?? null,
    },
    activeMosqueId: activeMembership?.mosqueId ?? null,
    role: effectiveRole,
    accessToken,
    refreshToken: rawRefreshJwt,
  };
}

// ---------------------------------------------------------------------------
// refreshAccessToken — verifies refresh token and issues a new access token
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  rawRefreshToken: string,
): Promise<RefreshResult> {
  // 1. Verify cryptographic JWT signature & expiration
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw HttpError.unauthorized(
        "Refresh token has expired. Please login again.",
        "AUTH_REFRESH_TOKEN_EXPIRED",
      );
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw HttpError.unauthorized(
        "Invalid refresh token.",
        "AUTH_REFRESH_TOKEN_INVALID",
      );
    }
    throw HttpError.unauthorized(
      "Failed to authenticate refresh token.",
      "AUTH_UNAUTHORIZED",
    );
  }

  // 2. Hash the raw refresh token to look up the DB record
  const tokenHash = hashToken(rawRefreshToken);

  // 3. Find record in DB and join the user to inspect current sessionVersion
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          status: true,
          sessionVersion: true,
        },
      },
    },
  });

  if (!storedToken || !storedToken.user) {
    throw HttpError.unauthorized(
      "Refresh token is invalid or unrecognized.",
      "AUTH_REFRESH_TOKEN_INVALID",
    );
  }

  // 3b. Account status check
  if (storedToken.user.status !== UserStatus.ACTIVE) {
    throw HttpError.forbidden(
      "Your account is inactive or blocked.",
      "ACCOUNT_INACTIVE",
    );
  }

  // 4. Rejected if the token was revoked (soft-deleted on logout/switch-mosque/reset)
  if (storedToken.revokedAt) {
    throw HttpError.unauthorized(
      "Refresh token has been revoked.",
      "AUTH_REFRESH_TOKEN_REVOKED",
    );
  }

  // 5. Check database expiration
  if (storedToken.expiresAt < new Date()) {
    throw HttpError.unauthorized(
      "Refresh token has expired. Please login again.",
      "AUTH_REFRESH_TOKEN_EXPIRED",
    );
  }

  // 6. Rejected if sessionVersion is stale (bumped on role change, password reset, logout-everywhere)
  if (storedToken.user.sessionVersion !== payload.sessionVersion) {
    throw HttpError.unauthorized(
      "Session is stale or has been invalidated. Please login again.",
      "AUTH_SESSION_STALE",
    );
  }

  // 7. Issue new short-lived access token carrying the same activeMosqueId and role
  const newAccessToken = signAccessToken({
    sub: storedToken.userId,
    mosqueId: storedToken.mosqueId,
    role: storedToken.role,
    sessionVersion: storedToken.user.sessionVersion,
  });

  return {
    accessToken: newAccessToken,
    activeMosqueId: storedToken.mosqueId,
    role: storedToken.role,
  };
}

// ---------------------------------------------------------------------------
// revokeRefreshToken — marks refresh token as revoked in DB on logout
// ---------------------------------------------------------------------------

export async function revokeRefreshToken(
  rawRefreshToken: string,
  userId?: string,
): Promise<void> {
  try {
    const tokenHash = hashToken(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        ...(userId ? { userId } : {}),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  } catch {
    // Best-effort: ignore if token hash is missing or DB record not found
  }
}

// ---------------------------------------------------------------------------
// getAuthenticatedUser — loads current profile and active memberships
// ---------------------------------------------------------------------------

export async function getAuthenticatedUser(
  userId: string,
  activeMosqueId?: string | null,
): Promise<{
  user: PublicUser;
  activeMosqueId: string | null;
  role: Role | null;
  memberships: (PublicMembership & {
    mosque: { id: string; name: string; slug: string };
  })[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      locale: true,
      emailVerified: true,
      status: true,
      role: true,
      memberships: {
        where: { status: MembershipStatus.ACTIVE },
        select: {
          id: true,
          mosqueId: true,
          role: true,
          status: true,
          mosque: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
  });

  if (!user) {
    throw HttpError.unauthorized(
      "User account no longer exists.",
      "AUTH_USER_NOT_FOUND",
    );
  }

  if (user.status === UserStatus.BLOCKED) {
    throw HttpError.forbidden(
      "Your account has been blocked. Please contact support.",
      "ACCOUNT_BLOCKED",
    );
  }

  // Resolve current active membership
  let active = user.memberships.find((m) => m.mosqueId === activeMosqueId);
  if (!active && user.memberships.length === 1) {
    active = user.memberships[0];
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      locale: user.locale,
      emailVerified: user.emailVerified,
      status: user.status,
      role: user.role ?? null,
    },
    activeMosqueId: active?.mosqueId ?? null,
    role: active?.role ?? user.role ?? null,
    memberships: user.memberships,
  };
}

// ---------------------------------------------------------------------------
// requestPasswordReset — creates reset token and logs/sends it
// Constant-time response: returns void regardless of whether email exists.
// ---------------------------------------------------------------------------

export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<{ rawToken: string | null }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    select: { id: true, email: true },
  });

  if (!user) {
    // Return silently to prevent user enumeration
    return { rawToken: null };
  }

  // Invalidate any previously active unused reset tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  // Generate new secure opaque token (hash stored, raw sent via email)
  const { raw: rawToken, hash: tokenHash } = generateOpaqueToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: tokenExpiresAt(config.PASSWORD_RESET_TOKEN_TTL_MS),
    },
  });

  // Return raw token for email dispatching / dev testing
  return { rawToken };
}

// ---------------------------------------------------------------------------
// resetPassword — verifies reset token, updates password, and bumps sessionVersion
// Bumping sessionVersion immediately invalidates all outstanding refresh tokens.
// ---------------------------------------------------------------------------

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<void> {
  const tokenHash = hashToken(input.token);

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, sessionVersion: true },
      },
    },
  });

  if (!resetRecord || !resetRecord.user) {
    throw HttpError.badRequest(
      "Invalid or expired password reset token.",
      "AUTH_RESET_TOKEN_INVALID",
    );
  }

  if (resetRecord.usedAt) {
    throw HttpError.badRequest(
      "This password reset token has already been used.",
      "AUTH_RESET_TOKEN_USED",
    );
  }

  if (resetRecord.expiresAt < new Date()) {
    throw HttpError.badRequest(
      "Password reset token has expired. Please request a new one.",
      "AUTH_RESET_TOKEN_EXPIRED",
    );
  }

  // Hash new password before transaction
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);

  // Atomic transaction: mark token used, bump sessionVersion, update password, revoke sessions
  await prisma.$transaction(async (tx) => {
    // 1. Mark token as consumed
    await tx.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    // 2. Update user's password and increment sessionVersion
    await tx.user.update({
      where: { id: resetRecord.userId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
      },
    });

    // 3. Invalidate/revoke all active refresh tokens for this user in DB
    await tx.refreshToken.updateMany({
      where: {
        userId: resetRecord.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// verifyEmail — verifies emailed token and sets User.emailVerified = true
// Has no effect on existing sessions (sessionVersion is not bumped).
// ---------------------------------------------------------------------------

export async function verifyEmail(
  input: VerifyEmailInput,
): Promise<void> {
  const tokenHash = hashToken(input.token);

  const verifyRecord = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, emailVerified: true },
      },
    },
  });

  if (!verifyRecord || !verifyRecord.user) {
    throw HttpError.badRequest(
      "Invalid or expired email verification token.",
      "AUTH_VERIFY_TOKEN_INVALID",
    );
  }

  if (verifyRecord.usedAt) {
    throw HttpError.badRequest(
      "This verification token has already been used.",
      "AUTH_VERIFY_TOKEN_USED",
    );
  }

  if (verifyRecord.expiresAt < new Date()) {
    throw HttpError.badRequest(
      "Email verification token has expired. Please request a new one.",
      "AUTH_VERIFY_TOKEN_EXPIRED",
    );
  }

  // Atomic transaction: mark token as consumed & mark user as verified
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: verifyRecord.id },
      data: { usedAt: new Date() },
    });

    await tx.user.update({
      where: { id: verifyRecord.userId },
      data: { emailVerified: true },
    });
  });
}
