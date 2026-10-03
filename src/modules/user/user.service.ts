// ---------------------------------------------------------------------------
// User Service
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import type { UpdateProfileInput } from "./user.validation.js";

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
