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
} from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Public return types — no secrets, no internal fields
// ---------------------------------------------------------------------------

export type PublicMembership = Pick<
  Membership,
  "id" | "mosqueId" | "role" | "status"
>;

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  emailVerified: boolean;
}

export interface RegisterResult {
  user: RegisteredUser;
  memberships: PublicMembership[];
  accessToken: string;
  /** raw refresh JWT — controller puts this in an httpOnly cookie only */
  refreshToken: string;
  /** raw email-verification token — hand to the email queue, never the client */
  emailVerifyToken: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the single active mosque context for token claims.
 * • Exactly 1 ACTIVE membership → auto-selected for the JWT payload.
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
  // 3. CPU-expensive work BEFORE the transaction — bcrypt keeps the DB
  //    connection time as short as possible.
  // -------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  // -------------------------------------------------------------------------
  // 4. Prepare token material (cheap + sync) before opening the transaction
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
            // PENDING until the mosque's approval flow promotes it to ACTIVE
            status: MembershipStatus.PENDING,
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

      // 5d. Determine mosque context for token claims
      const activeMembership = resolveActiveMembership(memberships);

      // 5e. Sign refresh JWT and persist only the hash
      const rawRefreshJwt = signRefreshToken({
        sub: createdUser.id,
        jti: refreshJti,
        mosqueId: activeMembership?.mosqueId ?? null,
        role: activeMembership?.role ?? null,
        sessionVersion: createdUser.sessionVersion,
      });

      const refreshTokenHash = crypto
        .createHash("sha256")
        .update(rawRefreshJwt)
        .digest("hex");

      await tx.refreshToken.create({
        data: {
          userId: createdUser.id,
          tokenHash: refreshTokenHash,
          mosqueId: activeMembership?.mosqueId ?? null,
          role: activeMembership?.role ?? null,
          expiresAt: tokenExpiresAt(config.JWT_REFRESH_EXPIRES_IN_MS),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
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

  // -------------------------------------------------------------------------
  // 7. Return clean public-facing shape — no hashes, no DB internals
  // -------------------------------------------------------------------------
  return {
    user: {
      id: createdUser.id,
      name: createdUser.name,
      email: createdUser.email,
      phone: createdUser.phone ?? null,
      locale: createdUser.locale,
      emailVerified: createdUser.emailVerified,
    },
    memberships,
    accessToken,
    refreshToken: rawRefreshJwt,
    emailVerifyToken: rawEmailToken,
  };
}
