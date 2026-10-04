// ---------------------------------------------------------------------------
// Mosque Service — Core Multi-tenant Mosque & Membership Logic
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import { generateUniqueSlug } from "../../utils/slug.js";
import {
  Role,
  MembershipStatus,
  UserStatus,
  type Mosque,
  type Membership,
  Prisma,
} from "../../../generated/prisma/client.js";
import type { CreateMosqueInput } from "./mosque.validation.js";

export interface CreateMosqueResult {
  mosque: Mosque;
  membership: Membership;
}

export interface GetUserMosquesOptions {
  currentMosqueId?: string | null;
  search?: string;
}

export interface UserMosqueItem {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  timezone: string;
  fiscalYearStart: number;
  role: Role;
  membershipId: string;
  membershipStatus: MembershipStatus;
  isCurrent: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  membership: {
    id: string;
    role: Role;
    status: MembershipStatus;
    createdAt: Date;
  };
}

/**
 * Reusable security helper: Verifies user exists and account status is ACTIVE.
 * Throws HttpError if missing, blocked, or inactive.
 */
export async function assertActiveUser(userId: string) {
  const caller = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });

  if (!caller) {
    throw HttpError.notFound("User account not found.", "USER_NOT_FOUND");
  }

  if (caller.status === UserStatus.BLOCKED) {
    throw HttpError.forbidden(
      "Your account has been blocked. Please contact support.",
      "ACCOUNT_BLOCKED",
    );
  }

  if (caller.status === UserStatus.INACTIVE) {
    throw HttpError.forbidden(
      "Your account is inactive. Please activate your account first.",
      "ACCOUNT_INACTIVE",
    );
  }

  return caller;
}

/**
 * Creates a new Mosque tenant and immediately assigns the creator as an
 * ACTIVE MOSQUE_ADMIN within the same atomic database transaction.
 *
 * Guarantees:
 * 1. Atomicity: The mosque cannot exist without its founding admin membership.
 * 2. Slug uniqueness: Explicit slug collision throws 409 Conflict; auto-generated
 *    slugs resolve collisions automatically.
 * 3. Validation: Caller must exist and have ACTIVE account status.
 */
export async function createMosque(
  userId: string,
  input: CreateMosqueInput,
): Promise<CreateMosqueResult> {
  // 1. Verify caller user exists and is in good standing
  await assertActiveUser(userId);

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

/**
 * Lists every mosque the caller has an ACTIVE Membership in.
 * Powers the multi-tenant mosque switcher UI.
 *
 * Security guarantees:
 * 1. Caller account state: Verifies user exists and account is ACTIVE (not BLOCKED/INACTIVE).
 * 2. Membership status filter: Excludes PENDING, SUSPENDED, and REJECTED memberships.
 * 3. Tenant isolation: Strictly scopes results to caller's own memberships.
 * 4. Contextual identification: Accurately flags `isCurrent` matching current active session context.
 *
 * @param userId - Caller's unique user ID.
 * @param options - Optional context parameters including `currentMosqueId` and search term.
 * @returns Array of formatted mosque items with membership context.
 */
export async function getUserMosques(
  userId: string,
  options?: GetUserMosquesOptions,
): Promise<UserMosqueItem[]> {
  // 1. Live account status check (ensures blocked/inactive callers cannot view tenant data)
  await assertActiveUser(userId);

  // 2. Query all ACTIVE memberships with associated mosque data
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      ...(options?.search
        ? {
            mosque: {
              OR: [
                { name: { contains: options.search, mode: "insensitive" } },
                { slug: { contains: options.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      mosqueId: true,
      role: true,
      status: true,
      createdAt: true,
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          timezone: true,
          fiscalYearStart: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const currentMosqueId = options?.currentMosqueId ?? null;

  // 3. Map into clean, fully-typed UI-ready DTO
  return memberships.map((m) => {
    const isCurrent = currentMosqueId
      ? m.mosqueId === currentMosqueId
      : memberships.length === 1;

    return {
      id: m.mosque.id,
      name: m.mosque.name,
      slug: m.mosque.slug,
      address: m.mosque.address,
      timezone: m.mosque.timezone,
      fiscalYearStart: m.mosque.fiscalYearStart,
      role: m.role,
      membershipId: m.id,
      membershipStatus: m.status,
      isCurrent,
      joinedAt: m.createdAt,
      createdAt: m.mosque.createdAt,
      updatedAt: m.mosque.updatedAt,
      membership: {
        id: m.id,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
      },
    };
  });
}

/**
 * Reusable helper: Retrieves caller's active membership in a specific mosque.
 * Returns null if the user does not hold an ACTIVE membership in the target mosque.
 */
export async function getUserActiveMembership(
  userId: string,
  mosqueId: string,
): Promise<Membership | null> {
  return prisma.membership.findFirst({
    where: {
      userId,
      mosqueId,
      status: MembershipStatus.ACTIVE,
    },
  });
}
