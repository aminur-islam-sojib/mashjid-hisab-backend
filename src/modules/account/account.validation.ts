// ---------------------------------------------------------------------------
// Account Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { AccountType } from "../../../generated/prisma/client.js";

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  accountNumber?: string | null;
  openingBalance: bigint;
}

/**
 * Validates route parameter :accountId
 */
export function validateAccountIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Account identifier is required.", "INVALID_ACCOUNT_ID");
  }
  return param.trim();
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/accounts
 *
 * Rules:
 * - name: required string, 2-100 chars after trimming
 * - type: optional string, defaults to CASH, must be a valid AccountType
 * - accountNumber: optional string, max 50 chars (null if empty)
 * - openingBalance: optional non-negative integer minor units (poisha), defaults to 0n.
 *   Write-once in practice; subsequent modifications require adjusting ledger entries.
 */
export function validateCreateAccountInput(body: unknown): CreateAccountInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name (required) -------------------------------------------------------
  let name = "";
  if (raw["name"] === undefined || raw["name"] === null || raw["name"] === "") {
    issues.push({ field: "name", issue: "Account name is required." });
  } else if (typeof raw["name"] !== "string") {
    issues.push({ field: "name", issue: "Account name must be a string." });
  } else {
    name = raw["name"].trim();
    if (name.length < 2) {
      issues.push({
        field: "name",
        issue: "Account name must be at least 2 characters long.",
      });
    } else if (name.length > 100) {
      issues.push({
        field: "name",
        issue: "Account name cannot exceed 100 characters.",
      });
    }
  }

  // -- type (optional, default CASH) -----------------------------------------
  let type: AccountType = AccountType.CASH;
  if (raw["type"] !== undefined && raw["type"] !== null && raw["type"] !== "") {
    if (typeof raw["type"] !== "string") {
      issues.push({ field: "type", issue: "Account type must be a string." });
    } else {
      const typeUpper = raw["type"].trim().toUpperCase();
      if (!Object.values(AccountType).includes(typeUpper as AccountType)) {
        issues.push({
          field: "type",
          issue: `Invalid account type '${raw["type"]}'. Allowed types: ${Object.values(AccountType).join(", ")}.`,
        });
      } else {
        type = typeUpper as AccountType;
      }
    }
  }

  // -- accountNumber (optional, max 50 chars) ---------------------------------
  let accountNumber: string | null = null;
  if (raw["accountNumber"] !== undefined && raw["accountNumber"] !== null) {
    if (typeof raw["accountNumber"] !== "string") {
      issues.push({
        field: "accountNumber",
        issue: "Account number must be a string.",
      });
    } else {
      const trimmedAcc = raw["accountNumber"].trim();
      if (trimmedAcc.length > 50) {
        issues.push({
          field: "accountNumber",
          issue: "Account number cannot exceed 50 characters.",
        });
      } else {
        accountNumber = trimmedAcc || null;
      }
    }
  }

  // -- openingBalance (optional, non-negative integer minor units, default 0n) -
  let openingBalance = 0n;
  if (
    raw["openingBalance"] !== undefined &&
    raw["openingBalance"] !== null &&
    raw["openingBalance"] !== ""
  ) {
    const rawBal = raw["openingBalance"];
    if (typeof rawBal === "bigint") {
      if (rawBal < 0n) {
        issues.push({
          field: "openingBalance",
          issue: "Opening balance cannot be negative.",
        });
      } else {
        openingBalance = rawBal;
      }
    } else if (typeof rawBal === "number") {
      if (!Number.isFinite(rawBal) || !Number.isInteger(rawBal)) {
        issues.push({
          field: "openingBalance",
          issue: "Opening balance must be an integer in minor units (poisha).",
        });
      } else if (rawBal < 0) {
        issues.push({
          field: "openingBalance",
          issue: "Opening balance cannot be negative.",
        });
      } else {
        openingBalance = BigInt(rawBal);
      }
    } else if (typeof rawBal === "string") {
      const trimmed = rawBal.trim();
      if (!/^\d+$/.test(trimmed)) {
        issues.push({
          field: "openingBalance",
          issue: "Opening balance must be a non-negative integer in minor units (poisha).",
        });
      } else {
        try {
          openingBalance = BigInt(trimmed);
        } catch {
          issues.push({
            field: "openingBalance",
            issue: "Opening balance is an invalid numerical value.",
          });
        }
      }
    } else {
      issues.push({
        field: "openingBalance",
        issue: "Opening balance must be an integer number or string in minor units (poisha).",
      });
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    name,
    type,
    accountNumber,
    openingBalance,
  };
}

export interface GetMosqueAccountsQuery {
  includeArchived?: boolean;
  type?: AccountType;
  search?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/accounts
 */
export function validateGetMosqueAccountsQuery(query: unknown): GetMosqueAccountsQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueAccountsQuery = {};

  // -- includeArchived (optional) --------------------------------------------
  if (
    raw["includeArchived"] !== undefined &&
    raw["includeArchived"] !== null &&
    raw["includeArchived"] !== ""
  ) {
    if (
      raw["includeArchived"] === true ||
      raw["includeArchived"] === "true" ||
      raw["includeArchived"] === "1"
    ) {
      result.includeArchived = true;
    } else if (
      raw["includeArchived"] === false ||
      raw["includeArchived"] === "false" ||
      raw["includeArchived"] === "0"
    ) {
      result.includeArchived = false;
    } else {
      throw HttpError.badRequest(
        "Query parameter 'includeArchived' must be a boolean (true/false).",
        "INVALID_QUERY_PARAM",
      );
    }
  }

  // -- type (optional) -------------------------------------------------------
  if (raw["type"] !== undefined && raw["type"] !== null && raw["type"] !== "") {
    if (typeof raw["type"] !== "string") {
      throw HttpError.badRequest("Account type filter must be a string.");
    }
    const typeUpper = raw["type"].trim().toUpperCase();
    if (!Object.values(AccountType).includes(typeUpper as AccountType)) {
      throw HttpError.badRequest(
        `Invalid account type filter '${raw["type"]}'. Allowed types: ${Object.values(AccountType).join(", ")}.`,
        "INVALID_ACCOUNT_TYPE",
      );
    }
    result.type = typeUpper as AccountType;
  }

  // -- search (optional) -----------------------------------------------------
  if (raw["search"] !== undefined && raw["search"] !== null && raw["search"] !== "") {
    if (typeof raw["search"] !== "string") {
      throw HttpError.badRequest("Search query must be a string.");
    }
    const trimmed = raw["search"].trim();
    if (trimmed.length > 100) {
      throw HttpError.badRequest("Search query cannot exceed 100 characters.");
    }
    result.search = trimmed;
  }

  return result;
}
