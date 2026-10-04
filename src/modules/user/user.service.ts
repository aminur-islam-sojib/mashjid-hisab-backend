// ---------------------------------------------------------------------------
// User Service
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import { Role, UserStatus } from "../../../generated/prisma/client.js";
import type {
  UpdateProfileInput,
  UpdateUserStatusInput,
} from "./user.validation.js";

export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
) {
  // 1. Verify user exists
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true },
  });

  if (!currentUser) {
    throw HttpError.notFound("User account not found.", "USER_NOT_FOUND");
  }

  // 2. Uniqueness check on phone number if updated
  if (input.phone && input.phone !== currentUser.phone) {
    const existingPhone = await prisma.user.findFirst({
      where: {
        phone: input.phone,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (existingPhone) {
      throw HttpError.conflict(
        "This phone number is already associated with another account.",
        "AUTH_PHONE_TAKEN",
      );
    }
  }

  // 3. Atomically update User and Profile
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.locale !== undefined && { locale: input.locale }),
      profile: {
        upsert: {
          create: {
            avatarUrl: input.avatarUrl ?? null,
            bio: input.bio ?? null,
            address: input.address ?? null,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          },
          update: {
            ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
            ...(input.bio !== undefined && { bio: input.bio }),
            ...(input.address !== undefined && { address: input.address }),
            ...(input.dateOfBirth !== undefined && {
              dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
            }),
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      locale: true,
      emailVerified: true,
      status: true,
      profile: {
        select: {
          avatarUrl: true,
          bio: true,
          address: true,
          dateOfBirth: true,
          updatedAt: true,
        },
      },
    },
  });

  return updatedUser;
}

// ---------------------------------------------------------------------------
// updateUserStatus — Super Admin only
//
// Security guarantees:
//  • Verifies target user exists.
//  • Prevents Super Admin self-lockout (cannot deactivate/block own account).
//  • Protects last active Super Admin from being blocked/deactivated.
//  • Atomically updates status, increments sessionVersion, and soft-revokes
//    all active refresh tokens on BLOCKED or INACTIVE to invalidate sessions instantly.
// ---------------------------------------------------------------------------
export async function updateUserStatus(
  callerUserId: string,
  targetUserId: string,
  input: UpdateUserStatusInput,
) {
  // 1. Locate target user
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      sessionVersion: true,
    },
  });

  if (!targetUser) {
    throw HttpError.notFound("User account not found.", "USER_NOT_FOUND");
  }

  // 2. Prevent self-lockout: A Super Admin cannot block or deactivate their own account
  if (callerUserId === targetUserId && input.status !== UserStatus.ACTIVE) {
    throw HttpError.badRequest(
      "Operation rejected: You cannot deactivate or block your own super administrator account.",
      "CANNOT_MODIFY_OWN_STATUS",
    );
  }

  // 3. Last Super Admin protection:
  // If target user is a SUPER_ADMIN and is being blocked/deactivated, ensure there is at least one other active SUPER_ADMIN
  if (
    targetUser.role === Role.SUPER_ADMIN &&
    targetUser.status === UserStatus.ACTIVE &&
    input.status !== UserStatus.ACTIVE
  ) {
    const activeSuperAdminCount = await prisma.user.count({
      where: {
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    if (activeSuperAdminCount <= 1) {
      throw HttpError.badRequest(
        "Operation blocked: The platform must retain at least one active SUPER_ADMIN. You cannot block or deactivate the last super administrator.",
        "LAST_SUPER_ADMIN_PROTECTED",
      );
    }
  }

  // 4. If status is being changed to BLOCKED or INACTIVE:
  // Immediately bump sessionVersion AND revoke all existing refresh tokens
  // This invalidates all outstanding sessions on all devices for this user
  const shouldInvalidateSessions = input.status !== UserStatus.ACTIVE;

  const updatedUser = await prisma.$transaction(async (tx) => {
    if (shouldInvalidateSessions) {
      // Soft-revoke all refresh tokens
      await tx.refreshToken.updateMany({
        where: {
          userId: targetUserId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    return tx.user.update({
      where: { id: targetUserId },
      data: {
        status: input.status,
        ...(shouldInvalidateSessions ? { sessionVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerified: true,
        locale: true,
        updatedAt: true,
      },
    });
  });

  return updatedUser;
}

