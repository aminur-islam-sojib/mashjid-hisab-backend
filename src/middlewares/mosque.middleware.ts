// ---------------------------------------------------------------------------
// Mosque Tenancy & Authorization Middlewares
//
// Core design guarantees:
//  • Every route is re-scoped to :mosqueId in the URL itself.
//  • Always re-checks caller's live Membership against the database on every request.
//  • Never trusts JWT's activeMosqueId claim as authorization.
//  • Only MembershipStatus.ACTIVE memberships are granted access.
//  • Enforces role-based access for setup/financial oversight.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../errors/HttpError.js";
import {
  Role,
  MembershipStatus,
  UserStatus,
  type Membership,
  type Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Role Presets for Easy Reusability
// ---------------------------------------------------------------------------

/**
 * Roles permitted to view chart of accounts, funds, bank account numbers, etc.
 * MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const OVERSIGHT_ROLES: readonly Role[] = [
  Role.MOSQUE_ADMIN,
  Role.TREASURER,
  Role.COMMITTEE_MEMBER,
] as const;

/**
 * Roles permitted to modify financial records and chart of accounts.
 * MOSQUE_ADMIN, TREASURER
 */
export const FINANCIAL_OPERATOR_ROLES: readonly Role[] = [
  Role.MOSQUE_ADMIN,
  Role.TREASURER,
] as const;

/**
 * Administrator only role
 */
export const ADMIN_ONLY_ROLES: readonly Role[] = [
  Role.MOSQUE_ADMIN,
] as const;

/**
 * Roles permitted to view operational records such as categories for expense entry.
 * MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 */
export const OPERATIONAL_ROLES: readonly Role[] = [
  Role.MOSQUE_ADMIN,
  Role.TREASURER,
  Role.COMMITTEE_MEMBER,
  Role.STAFF,
] as const;

/**
 * Middleware factory requiring the caller to hold an ACTIVE Membership in the
 * mosque identified by the `:mosqueId` route parameter.
 *
 * If `allowedRoles` are specified, verifies that caller's live role is included.
 * Populates `req.membership` and `req.mosqueId` on success.
 */
export function requireMosqueMembership(...allowedRoles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Ensure user is authenticated
      if (!req.user?.sub) {
        throw HttpError.unauthorized(
          "Authentication required.",
          "AUTH_UNAUTHORIZED",
        );
      }

      // 2. Extract mosqueId from URL parameters
      const mosqueId = req.params["mosqueId"] || req.params["id"];
      if (!mosqueId || typeof mosqueId !== "string" || !mosqueId.trim()) {
        throw HttpError.badRequest(
          "Route is missing required mosqueId identifier.",
          "INVALID_MOSQUE_ID",
        );
      }

      // 3. Query DB for live Membership (supports both CUID and slug, never trust stale JWT claims)
      const membership = await prisma.membership.findFirst({
        where: {
          userId: req.user.sub,
          OR: [
            { mosqueId: mosqueId.trim() },
            { mosque: { slug: mosqueId.trim() } },
          ],
        },
        include: {
          user: {
            select: { status: true },
          },
        },
      });

      // 4. Must exist and membership must be ACTIVE.
      // Returns 404 (not 403) to prevent leaking existence of private tenants.
      if (!membership || membership.status !== MembershipStatus.ACTIVE) {
        throw HttpError.notFound(
          "Mosque not found.",
          "MOSQUE_NOT_FOUND",
        );
      }

      // 4b. Global user account must be ACTIVE
      if (membership.user.status !== UserStatus.ACTIVE) {
        throw HttpError.forbidden(
          "Access denied. Your user account is inactive or blocked.",
          "ACCOUNT_INACTIVE",
        );
      }

      // 5. Check role restrictions if specified
      if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
        throw HttpError.forbidden(
          `Access denied. Role '${membership.role}' is not authorized to access this resource.`,
          "FORBIDDEN_ROLE",
        );
      }

      // 6. Attach canonical membership and primary mosque ID to request context
      req.membership = membership;
      req.mosqueId = membership.mosqueId;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * The "last admin" guard helper.
 * Blocks demoting, revoking, or removing the last active MOSQUE_ADMIN in a mosque.
 * Can run inside or outside a database transaction.
 */
export async function assertNotLastAdmin(
  mosqueId: string,
  targetUserId: string,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<void> {
  const target = await client.membership.findUnique({
    where: {
      userId_mosqueId: {
        userId: targetUserId,
        mosqueId,
      },
    },
    select: {
      role: true,
      status: true,
    },
  });

  // Only guards when the target is an ACTIVE MOSQUE_ADMIN
  if (target?.role === Role.MOSQUE_ADMIN && target.status === MembershipStatus.ACTIVE) {
    const activeAdminCount = await client.membership.count({
      where: {
        mosqueId,
        role: Role.MOSQUE_ADMIN,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (activeAdminCount <= 1) {
      throw HttpError.badRequest(
        "Operation blocked: A mosque must retain at least one active MOSQUE_ADMIN. You cannot remove or demote the last administrator.",
        "LAST_ADMIN_PROTECTED",
      );
    }
  }
}
