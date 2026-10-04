// ---------------------------------------------------------------------------
// Mosque Service — Core Multi-tenant Mosque & Membership Logic
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import { generateUniqueSlug } from "../../utils/slug.js";
import {
  Role,
  MembershipStatus,
  type Mosque,
  type Membership,
  Prisma,
} from "../../../generated/prisma/client.js";
import type { CreateMosqueInput } from "./mosque.validation.js";

export interface CreateMosqueResult {
  mosque: Mosque;
  membership: Membership;
}

/**
 * Creates a new Mosque tenant and immediately assigns the creator as an
 * ACTIVE MOSQUE_ADMIN within the same atomic database transaction.
 *
 * Guarantees:
 * 1. Atomicity: The mosque cannot exist without its founding admin membership.
 * 2. Slug uniqueness: Explicit slug collision throws 409 Conflict; auto-generated
 *    slugs resolve collisions automatically.
 * 3. Validation: Caller must exist as a registered User.
 */
export async function createMosque(
  userId: string,
  input: CreateMosqueInput,
): Promise<CreateMosqueResult> {
  // 1. Verify caller user exists
  const caller = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!caller) {
    throw HttpError.notFound("User account not found.", "USER_NOT_FOUND");
  }

  // 2. Resolve Slug
  let finalSlug: string;

  if (input.slug) {
    // Caller specified custom slug — check for collisions
    const existing = await prisma.mosque.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });

    if (existing) {
      throw HttpError.conflict(
        `The slug '${input.slug}' is already taken. Please choose another slug.`,
        "MOSQUE_SLUG_CONFLICT",
      );
    }

    finalSlug = input.slug;
  } else {
    // Auto-generate URL-safe slug from mosque name
    finalSlug = await generateUniqueSlug(input.name, async (candidate) => {
      const found = await prisma.mosque.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      return Boolean(found);
    });
  }

  // 3. Atomically create Mosque + Founding MOSQUE_ADMIN Membership
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Step A: Create tenant Mosque
      const mosque = await tx.mosque.create({
        data: {
          name: input.name,
          slug: finalSlug,
          address: input.address ?? null,
          timezone: input.timezone ?? "Asia/Dhaka",
          fiscalYearStart: input.fiscalYearStart ?? 7,
        },
      });

      // Step B: Create founding Membership
      const membership = await tx.membership.create({
        data: {
          userId,
          mosqueId: mosque.id,
          role: Role.MOSQUE_ADMIN,
          status: MembershipStatus.ACTIVE,
          invitedById: null,
        },
      });

      return { mosque, membership };
    });

    return result;
  } catch (error) {
    // Handle database unique constraint collision (e.g. concurrent slug creation)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        `A mosque with the slug '${finalSlug}' already exists.`,
        "MOSQUE_SLUG_CONFLICT",
      );
    }
    throw error;
  }
}

/**
 * Reusable query: Finds a mosque by unique ID.
 */
export async function getMosqueById(mosqueId: string): Promise<Mosque | null> {
  return prisma.mosque.findUnique({
    where: { id: mosqueId },
  });
}

/**
 * Reusable query: Finds a mosque by unique slug.
 */
export async function getMosqueBySlug(slug: string): Promise<Mosque | null> {
  return prisma.mosque.findUnique({
    where: { slug },
  });
}
