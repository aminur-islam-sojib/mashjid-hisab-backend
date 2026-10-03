// ---------------------------------------------------------------------------
// Auth Service — register
//
// Responsibilities:
//  1. Uniqueness check (email + phone) — before hashing to avoid wasted work.
//  2. Atomic DB transaction: User + Profile + optional Membership.
//  3. Email-verification token issued and persisted (hash only).
//  4. Refresh token row created (hash only) + JWT pair issued.
//  5. Returns only what the controller needs — no raw passwords or hashes
//     ever leave this layer.
//
// Error strategy: throw HttpError for domain violations (duplicate email,
// mosque not found). Unexpected DB errors surface as unhandled rejections
// caught by catchAsync → global error handler.
// ---------------------------------------------------------------------------

import bcrypt from "bcrypt";
import crypto from "crypto";

import { prisma } from "../../lib/prisma.js";
import config from "../../config/index.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  signAccessToken,
  signRefreshToken,
  generateOpaqueToken,
  tokenExpiresAt,
} from "../../utils/token.js";
import type { RegisterInput } from "./auth.validation.js";
import {
  MembershipStatus,
  Role,
  type Membership,
  type User,
} from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Return types — strip secrets before leaving the service layer
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string; // raw JWT — caller puts it in an httpOnly cookie
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  emailVerified: boolean;
  membership: Pick<Membership, "id" | "mosqueId" | "role" | "status"> | null;
}

export interface RegisterResult {
  user: RegisteredUser;
  tokens: AuthTokens;
  /** raw email-verification token — caller hands this to the email service */
  emailVerifyToken: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the active mosque context from a list of ACTIVE memberships.
 * • 1 ACTIVE  → auto-selected
 * • 0 or >1   → null (client must switch-mosque or create/join one)
 */
function resolveActiveMembership(
  memberships: Pick<Membership, "id" | "mosqueId" | "role" | "status">[],
): Pick<Membership, "id" | "mosqueId" | "role" | "status"> | null {
  const active = memberships.filter((m) => m.status === MembershipStatus.ACTIVE);
  return active.length === 1 && active[0] ? active[0] : null;
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
  // 1. Pre-flight uniqueness checks — fast, outside the transaction
  // -------------------------------------------------------------------------
  const [existingEmail, existingPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    phone
      ? prisma.user.findUnique({ where: { phone }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (existingEmail) {
    throw HttpError.conflict(
      "An account with this email already exists",
      "EMAIL_TAKEN",
    );
  }
  if (existingPhone) {
    throw HttpError.conflict(
      "An account with this phone number already exists",
      "PHONE_TAKEN",
    );
  }

  // -------------------------------------------------------------------------
  // 2. Verify mosque exists before we open the transaction
  // -------------------------------------------------------------------------
  if (mosqueId) {
    const mosque = await prisma.mosque.findUnique({
      where: { id: mosqueId },
      select: { id: true },
    });
    if (!mosque) {
      throw HttpError.notFound(
        `Mosque with id "${mosqueId}" does not exist`,
        "MOSQUE_NOT_FOUND",
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. Expensive CPU work — hash password BEFORE the transaction to keep
  //    the DB connection time as short as possible.
  // -------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  // -------------------------------------------------------------------------
  // 4. Generate tokens (cheap, sync) before opening the transaction
  // -------------------------------------------------------------------------
  const { raw: rawEmailToken, hash: emailTokenHash } = generateOpaqueToken();
  const refreshJti = crypto.randomUUID();

  // -------------------------------------------------------------------------
  // 5. Atomic DB transaction — User + Profile + optional Membership +
  //    EmailVerificationToken + RefreshToken
  // -------------------------------------------------------------------------
  const {
    user,
    membership,
    refreshTokenRecord,
  } = await prisma.$transaction(async (tx) => {
    // 5a. Create User
    const user = await tx.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        locale: locale ?? "bn",
        emailVerified: false,
        sessionVersion: 1,
        // 5b. Profile created inline (nested write = same round-trip)
        profile: {
          create: {},
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        locale: true,
        emailVerified: true,
        sessionVersion: true,
      },
    });

    // 5c. Optional Membership
    let membership: Pick<Membership, "id" | "mosqueId" | "role" | "status"> | null = null;
    if (mosqueId) {
      membership = await tx.membership.create({
        data: {
          userId: user.id,
          mosqueId,
          role: Role.MEMBER,
          status: MembershipStatus.PENDING, // tighten to ACTIVE once approval flow exists
        },
        select: { id: true, mosqueId: true, role: true, status: true },
      });
    }

    // 5d. Email-verification token (hash only in DB)
    await tx.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: emailTokenHash,
        expiresAt: tokenExpiresAt(config.EMAIL_VERIFY_TOKEN_TTL_MS),
      },
    });

    // 5e. Determine mosque context for tokens
    const activeMembership = membership
      ? resolveActiveMembership([membership])
      : null;

    // 5f. Refresh token DB row (hash only)
    const refreshExpiresAt = tokenExpiresAt(config.JWT_REFRESH_EXPIRES_IN_MS);
    const rawRefreshJwt = signRefreshToken({
      sub: user.id,
      jti: refreshJti,
      mosqueId: activeMembership?.mosqueId ?? null,
      role: activeMembership?.role ?? null,
      sessionVersion: user.sessionVersion,
    });

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawRefreshJwt)
      .digest("hex");

    const refreshTokenRecord = await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        mosqueId: activeMembership?.mosqueId ?? null,
        role: activeMembership?.role ?? null,
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      select: { id: true },
    });

    return { user, membership, refreshTokenRecord, rawRefreshJwt, activeMembership };
  }) as {
    user: Pick<User, "id" | "name" | "email" | "phone" | "locale" | "emailVerified" | "sessionVersion">;
    membership: Pick<Membership, "id" | "mosqueId" | "role" | "status"> | null;
    refreshTokenRecord: { id: string };
    rawRefreshJwt: string;
    activeMembership: Pick<Membership, "id" | "mosqueId" | "role" | "status"> | null;
  };

  // The transaction closure captures rawRefreshJwt and activeMembership —
  // re-derive them from returned values here for cleanliness.
  const activeMembership = membership
    ? resolveActiveMembership([membership])
    : null;

  const rawRefreshJwt = signRefreshToken({
    sub: user.id,
    jti: refreshJti,
    mosqueId: activeMembership?.mosqueId ?? null,
    role: activeMembership?.role ?? null,
    sessionVersion: user.sessionVersion,
  });

  const accessToken = signAccessToken({
    sub: user.id,
    mosqueId: activeMembership?.mosqueId ?? null,
    role: activeMembership?.role ?? null,
    sessionVersion: user.sessionVersion,
  });

  // -------------------------------------------------------------------------
  // 6. Shape the public-facing user object (no hashes, no internal fields)
  // -------------------------------------------------------------------------
  const publicUser: RegisteredUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    locale: user.locale,
    emailVerified: user.emailVerified,
    membership,
  };

  return {
    user: publicUser,
    tokens: {
      accessToken,
      refreshToken: rawRefreshJwt,
    },
    emailVerifyToken: rawEmailToken,
  };
}
