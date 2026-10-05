// ---------------------------------------------------------------------------
// Account Service — Mosque Financial Accounts Management
// ---------------------------------------------------------------------------

import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  AccountType,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../mosque/mosque.service.js";
import type { CreateAccountInput } from "./account.validation.js";

export interface AccountResponseItem {
  id: string;
  mosqueId: string;
  name: string;
  type: AccountType;
  accountNumber: string | null;
  openingBalance: string; // Poisha (minor units) represented as string for safe JSON serialization
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Utility helper to convert integer poisha (minor units) to formatted decimal currency string.
 * e.g. 10050n -> "100.50"
 */
export function formatPoishaToCurrency(poisha: bigint): string {
  const isNegative = poisha < 0n;
  const abs = isNegative ? -poisha : poisha;
  const major = abs / 100n;
  const minor = abs % 100n;
  const minorStr = minor < 10n ? `0${minor}` : `${minor}`;
  return `${isNegative ? "-" : ""}${major}.${minorStr}`;
}

/**
 * Creates a new financial Account for a mosque (Cash safe, Bank account, Mobile wallet, etc.).
 *
 * Business & Security Rules:
 * - Mosque must exist and not be archived (verified via resolveActiveMosqueId).
 * - Name uniqueness is scoped per mosque (enforced at both DB and application levels).
 * - An archived account with the same name blocks creation to preserve data integrity.
 * - openingBalance is write-once in practice. Changing it later must go through an
 *   adjusting transaction/ledger entry once the accounting ledger exists.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param input - Validated create account payload
 */
export async function createAccount(
  mosqueId: string,
  input: CreateAccountInput,
): Promise<AccountResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // Check for existing account with identical name (case-insensitive) in this mosque
  const existingAccount = await prisma.account.findFirst({
    where: {
      mosqueId: resolvedMosqueId,
      name: {
        equals: input.name,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
      isArchived: true,
    },
  });

  if (existingAccount) {
    if (existingAccount.isArchived) {
      throw HttpError.conflict(
        `An account named '${input.name}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
        "ACCOUNT_NAME_ARCHIVED_EXISTS",
      );
    }
    throw HttpError.conflict(
      `An account named '${input.name}' already exists in this mosque.`,
      "ACCOUNT_NAME_EXISTS",
    );
  }

  try {
    const account = await prisma.account.create({
      data: {
        mosqueId: resolvedMosqueId,
        name: input.name,
        type: input.type,
        accountNumber: input.accountNumber ?? null,
        openingBalance: input.openingBalance,
      },
      select: {
        id: true,
        mosqueId: true,
        name: true,
        type: true,
        accountNumber: true,
        openingBalance: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: account.id,
      mosqueId: account.mosqueId,
      name: account.name,
      type: account.type,
      accountNumber: account.accountNumber,
      openingBalance: account.openingBalance.toString(),
      isArchived: account.isArchived,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw HttpError.conflict(
        `An account named '${input.name}' already exists in this mosque.`,
        "ACCOUNT_NAME_EXISTS",
      );
    }
    throw error;
  }
}

/**
 * Retrieves a single Account by ID scoped to the specified mosque.
 *
 * Anti-enumeration and tenant boundary guarantee:
 * Throws 404 Not Found if the account does not exist or belongs to another mosque.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param accountId - CUID of the account
 */
export async function getAccountById(
  mosqueId: string,
  accountId: string,
): Promise<AccountResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const account = await prisma.account.findFirst({
    where: {
      id: accountId,
      mosqueId: resolvedMosqueId,
    },
    select: {
      id: true,
      mosqueId: true,
      name: true,
      type: true,
      accountNumber: true,
      openingBalance: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!account) {
    throw HttpError.notFound("Account not found.", "ACCOUNT_NOT_FOUND");
  }

  return {
    id: account.id,
    mosqueId: account.mosqueId,
    name: account.name,
    type: account.type,
    accountNumber: account.accountNumber,
    openingBalance: account.openingBalance.toString(),
    isArchived: account.isArchived,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
