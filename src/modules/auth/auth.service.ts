// ---------------------------------------------------------------------------
// Auth Service — register + login + me
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
import type { RegisterInput, LoginInput } from "./auth.validation.js";
import {
  MembershipStatus,
  Role,
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

  const tokenHash = crypto
    .createHash("sha256")
    .update(rawRefreshJwt)
    .digest("hex");

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
  // 4. Resolve mosque context
  //    • 1 ACTIVE  → embed mosqueId + role in both tokens
  //    • 0 or >1   → null (client must create/join or call switch-mosque)
  // -------------------------------------------------------------------------
  const activeMembership = resolveActiveMembership(memberships);

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
    role: activeMembership?.role ?? null,
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
    },
    activeMosqueId: activeMembership?.mosqueId ?? null,
    role: activeMembership?.role ?? null,
    accessToken,
    refreshToken: rawRefreshJwt,
  };
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
    },
    activeMosqueId: active?.mosqueId ?? null,
    role: active?.role ?? null,
    memberships: user.memberships,
  };
}
