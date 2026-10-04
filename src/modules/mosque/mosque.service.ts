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
  InviteStatus,
  type Mosque,
  type Membership,
  Prisma,
} from "../../../generated/prisma/client.js";
import type {
  CreateMosqueInput,
  UpdateMosqueInput,
} from "./mosque.validation.js";

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

export interface MosqueSettings {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  timezone: string;
  fiscalYearStart: number;
  isArchived: boolean;
  archivedAt: Date | null;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArchiveMosqueResult {
  id: string;
  name: string;
  slug: string;
  isArchived: boolean;
  archivedAt: Date | null;
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
      mosque: {
        isArchived: false,
        ...(options?.search
          ? {
              OR: [
                { name: { contains: options.search, mode: "insensitive" } },
                { slug: { contains: options.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
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

/**
 * Retrieves full mosque settings for an active member.
 *
 * Security & anti-enumeration guarantee:
 * Throws 404 Not Found (never 403 Forbidden) if the caller holds no ACTIVE
 * membership in the mosque or if the mosque does not exist, completely
 * preventing attackers from probing the existence of private tenants.
 *
 * @param userId - Caller's unique user ID.
 * @param mosqueId - Target mosque ID or slug.
 * @returns Full mosque settings object with caller's effective role.
 */
export async function getMosqueSettings(
  userId: string,
  mosqueId: string,
): Promise<MosqueSettings> {
  // 1. Account status verification (ensure caller is not blocked or inactive)
  await assertActiveUser(userId);

  // 2. Query membership and join mosque data atomically.
  // Supports lookup by both mosque cuid and unique slug.
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      OR: [
        { mosqueId },
        { mosque: { slug: mosqueId } },
      ],
    },
    select: {
      role: true,
      mosque: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          timezone: true,
          fiscalYearStart: true,
          isArchived: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  // 3. Anti-enumeration security check:
  // Return 404 Not Found if no active membership exists.
  // Does not disclose whether the tenant exists or whether caller lacks permission.
  if (!membership || !membership.mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  return {
    id: membership.mosque.id,
    name: membership.mosque.name,
    slug: membership.mosque.slug,
    address: membership.mosque.address,
    timezone: membership.mosque.timezone,
    fiscalYearStart: membership.mosque.fiscalYearStart,
    isArchived: membership.mosque.isArchived,
    archivedAt: membership.mosque.archivedAt,
    role: membership.role,
    createdAt: membership.mosque.createdAt,
    updatedAt: membership.mosque.updatedAt,
  };
}

/**
 * Updates mosque tenant settings (name, address, timezone, fiscalYearStart).
 *
 * Business logic & fiscal integrity guarantee:
 * Changing `fiscalYearStart` is a critical business decision because it realigns
 * financial accounting periods, splits/merges budget cycles, and affects financial
 * reporting boundaries. Therefore, changing `fiscalYearStart` to a new month requires
 * explicit confirmation (`confirmFiscalYearChange: true`). Silently applying a
 * change to `fiscalYearStart` is strictly blocked.
 *
 * @param mosqueId - Target mosque unique ID.
 * @param input - Validated update fields and optional confirmation flag.
 * @returns Updated mosque settings with MOSQUE_ADMIN role context.
 */
export async function updateMosque(
  mosqueId: string,
  input: UpdateMosqueInput,
): Promise<MosqueSettings> {
  // 1. Fetch current mosque record
  const currentMosque = await prisma.mosque.findUnique({
    where: { id: mosqueId },
  });

  if (!currentMosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  if (currentMosque.isArchived) {
    throw HttpError.badRequest(
      "Cannot update settings: This mosque has been archived.",
      "MOSQUE_ARCHIVED",
    );
  }

  // 2. Fiscal year start change guard:
  // If fiscalYearStart is being changed to a different month, require explicit confirmation.
  if (
    input.fiscalYearStart !== undefined &&
    input.fiscalYearStart !== currentMosque.fiscalYearStart
  ) {
    if (!input.confirmFiscalYearChange) {
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const oldMonth = monthNames[currentMosque.fiscalYearStart - 1];
      const newMonth = monthNames[input.fiscalYearStart - 1];

      throw HttpError.badRequest(
        `Changing the fiscal year start month from ${oldMonth} (${currentMosque.fiscalYearStart}) to ${newMonth} (${input.fiscalYearStart}) alters accounting periods, budget cycles, and financial report boundaries. Set 'confirmFiscalYearChange: true' in your request body to confirm this update.`,
        "FISCAL_YEAR_CHANGE_CONFIRMATION_REQUIRED",
      );
    }
  }

  // 3. Atomically update settings
  const updatedMosque = await prisma.mosque.update({
    where: { id: mosqueId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
      ...(input.fiscalYearStart !== undefined && {
        fiscalYearStart: input.fiscalYearStart,
      }),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      address: true,
      timezone: true,
      fiscalYearStart: true,
      isArchived: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ...updatedMosque,
    role: Role.MOSQUE_ADMIN,
  };
}

/**
 * Soft-deletes a mosque tenant by setting `isArchived: true` and recording `archivedAt`.
 *
 * Safety rails enforced:
 * 1. Blocks if the mosque is already archived.
 * 2. Blocks if there are unresolved active invitations (`status: PENDING` and not expired).
 * 3. Blocks if there are active accounts/funds with non-zero balance.
 *
 * @param mosqueId - Target mosque unique ID.
 * @returns The archived mosque record.
 */
export async function archiveMosque(mosqueId: string): Promise<ArchiveMosqueResult> {
  // 1. Fetch current mosque
  const mosque = await prisma.mosque.findUnique({
    where: { id: mosqueId },
    select: {
      id: true,
      name: true,
      slug: true,
      isArchived: true,
    },
  });

  if (!mosque) {
    throw HttpError.notFound("Mosque not found.", "MOSQUE_NOT_FOUND");
  }

  if (mosque.isArchived) {
    throw HttpError.badRequest(
      "Operation rejected: Mosque is already archived.",
      "MOSQUE_ALREADY_ARCHIVED",
    );
  }

  // 2. Safety Rail: Check for unresolved pending membership invitations
  const pendingInvitesCount = await prisma.membershipInvite.count({
    where: {
      mosqueId,
      status: InviteStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
  });

  if (pendingInvitesCount > 0) {
    throw HttpError.badRequest(
      `Cannot archive mosque: There are ${pendingInvitesCount} unresolved pending invitation(s). Please revoke or resolve pending invites before archiving.`,
      "MOSQUE_ARCHIVE_BLOCKED_PENDING_INVITES",
    );
  }

  // 3. Safety Rail: Check for active accounts with non-zero balance
  const activeAccountsWithBalance = await prisma.account.findMany({
    where: {
      mosqueId,
      isArchived: false,
      openingBalance: { not: 0n },
    },
    select: { id: true, name: true, openingBalance: true },
  });

  if (activeAccountsWithBalance.length > 0) {
    const accountNames = activeAccountsWithBalance.map((a) => a.name).join(", ");
    throw HttpError.badRequest(
      `Cannot archive mosque: There are active accounts with non-zero balances (${accountNames}). All accounts must be settled or zeroed out before archiving.`,
      "MOSQUE_ARCHIVE_BLOCKED_NON_ZERO_BALANCE",
    );
  }

  // 4. Soft-delete the mosque
  const archived = await prisma.mosque.update({
    where: { id: mosqueId },
    data: {
      isArchived: true,
      archivedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      isArchived: true,
      archivedAt: true,
    },
  });

  return archived;
}
