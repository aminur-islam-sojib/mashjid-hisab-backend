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
import type {
  CreateAccountInput,
  GetMosqueAccountsQuery,
  UpdateAccountInput,
} from "./account.validation.js";

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

/**
 * Lists Accounts for a mosque.
 *
 * Access: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER (OVERSIGHT_ROLES).
 * Sensitive information (accountNumber) is included here, which is why access
 * is restricted to governance and financial oversight bodies rather than general members.
 * Default: Returns active (non-archived) accounts.
 * If query.includeArchived is true: Returns all accounts including archived.
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param query - Optional query filters (includeArchived, type, search)
 */
export async function getMosqueAccounts(
  mosqueId: string,
  query?: GetMosqueAccountsQuery,
): Promise<AccountResponseItem[]> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  const where: Prisma.AccountWhereInput = {
    mosqueId: resolvedMosqueId,
  };

  // Filter archived status
  if (!query?.includeArchived) {
    where.isArchived = false;
  }

  // Optional type filter
  if (query?.type) {
    where.type = query.type;
  }

  // Optional search query on account name or account number
  if (query?.search) {
    where.OR = [
      {
        name: {
          contains: query.search,
          mode: "insensitive",
        },
      },
      {
        accountNumber: {
          contains: query.search,
          mode: "insensitive",
        },
      },
    ];
  }

  const accounts = await prisma.account.findMany({
    where,
    orderBy: [
      { isArchived: "asc" },
      { name: "asc" },
    ],
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

  return accounts.map((a) => ({
    id: a.id,
    mosqueId: a.mosqueId,
    name: a.name,
    type: a.type,
    accountNumber: a.accountNumber,
    openingBalance: a.openingBalance.toString(),
    isArchived: a.isArchived,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/**
 * Retrieves the count of recorded financial transactions or journal entries
 * associated with a specific account.
 *
 * If the transaction/ledger tables have not yet been migrated into the database,
 * safely returns 0 transactions. Once tables (such as 'transactions', 'ledger_entries',
 * or 'journal_lines') are migrated with an 'accountId' column, this dynamically queries
 * the actual row count without breaking prior to the migration.
 *
 * @param accountId - CUID of the target account
 * @param client - Prisma client or transaction client
 */
export async function getAccountTransactionCount(
  accountId: string,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<number> {
  try {
    const matchingTables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('transactions', 'ledger_entries', 'journal_lines', 'account_transactions')
    `;

    if (!matchingTables || matchingTables.length === 0) {
      return 0;
    }

    let total = 0;
    for (const row of matchingTables) {
      const tableName = row.table_name;
      const columnExists = await client.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
          AND column_name = 'accountId'
      `;

      if (columnExists && columnExists.length > 0) {
        const countResult = await client.$queryRawUnsafe<Array<{ count: string | number | bigint }>>(
          `SELECT COUNT(*)::text AS count FROM "${tableName}" WHERE "accountId" = $1`,
          accountId,
        );
        if (countResult && countResult[0] && countResult[0].count !== undefined) {
          total += Number(countResult[0].count);
        }
      }
    }

    return total;
  } catch {
    return 0;
  }
}

/**
 * Updates a financial Account for a mosque (name, type, accountNumber, openingBalance).
 *
 * Business & Security Rules:
 * 1. Multi-Tenant Scoping: Account must belong strictly to resolvedMosqueId (404 if not found).
 * 2. Inactive/Archived Guard: Cannot update an archived account (400 ACCOUNT_ARCHIVED).
 * 3. Unique Name Enforcement: Renaming checks against both active and archived accounts
 *    in the same mosque (case-insensitive) to prevent collision with @@unique([mosqueId, name]).
 * 4. Write-Once Opening Balance Safety Rail:
 *    Never updates openingBalance once the account has any transactions. Altering initial
 *    balances after transactions begin breaks historical accounting ledgers and bank reconciliations;
 *    any adjustments must be made via accounting journal entries (400 ACCOUNT_OPENING_BALANCE_LOCKED).
 *
 * @param mosqueId - Identifier (CUID or slug) of the target mosque
 * @param accountId - CUID of the account to update
 * @param input - Validated update fields
 */
export async function updateAccount(
  mosqueId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<AccountResponseItem> {
  const resolvedMosqueId = await resolveActiveMosqueId(mosqueId);

  // 1. Fetch current account within tenant boundary
  const currentAccount = await prisma.account.findFirst({
    where: {
      id: accountId,
      mosqueId: resolvedMosqueId,
    },
  });

  if (!currentAccount) {
    throw HttpError.notFound("Account not found.", "ACCOUNT_NOT_FOUND");
  }

  // 2. Reject modifications to archived accounts
  if (currentAccount.isArchived) {
    throw HttpError.badRequest(
      "Cannot update an archived account. Please restore it first.",
      "ACCOUNT_ARCHIVED",
    );
  }

  // 3. Name uniqueness verification if name is changing
  if (input.name !== undefined && input.name.trim().toLowerCase() !== currentAccount.name.toLowerCase()) {
    const existingWithSameName = await prisma.account.findFirst({
      where: {
        mosqueId: resolvedMosqueId,
        id: { not: currentAccount.id },
        name: {
          equals: input.name.trim(),
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        isArchived: true,
      },
    });

    if (existingWithSameName) {
      if (existingWithSameName.isArchived) {
        throw HttpError.conflict(
          `An account named '${input.name.trim()}' already exists in this mosque but is archived. Please restore it or choose a different name.`,
          "ACCOUNT_NAME_ARCHIVED_EXISTS",
        );
      }
      throw HttpError.conflict(
        `An account named '${input.name.trim()}' already exists in this mosque.`,
        "ACCOUNT_NAME_EXISTS",
      );
    }
  }

  // 4. Opening balance write-once lock: Never update openingBalance once transactions exist
  if (input.openingBalance !== undefined && input.openingBalance !== currentAccount.openingBalance) {
    const transactionCount = await getAccountTransactionCount(currentAccount.id);
    if (transactionCount > 0) {
      throw HttpError.badRequest(
        `Cannot update opening balance: This account already has ${transactionCount} recorded transaction(s). Once transactions exist, the opening balance is locked and adjustments must be made via accounting journal transactions.`,
        "ACCOUNT_OPENING_BALANCE_LOCKED",
      );
    }
  }

  // 5. Apply updates atomically
  try {
    const updatedAccount = await prisma.account.update({
      where: { id: currentAccount.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
        ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
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
      id: updatedAccount.id,
      mosqueId: updatedAccount.mosqueId,
      name: updatedAccount.name,
      type: updatedAccount.type,
      accountNumber: updatedAccount.accountNumber,
      openingBalance: updatedAccount.openingBalance.toString(),
      isArchived: updatedAccount.isArchived,
      createdAt: updatedAccount.createdAt,
      updatedAt: updatedAccount.updatedAt,
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


