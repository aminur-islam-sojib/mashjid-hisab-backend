// ---------------------------------------------------------------------------
// Transaction Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";

export type TransactionTypeFilter = "DONATION" | "EXPENSE" | "TRANSFER" | "INCOME";

export type TransactionStatusFilter =
  | "PENDING"
  | "PENDING_APPROVAL"
  | "POSTED"
  | "REJECTED"
  | "VOIDED";

export interface CursorPayload {
  date: string;
  id: string;
}

export interface GetTransactionsQueryInput {
  cursor?: string;
  limit: number;
  type?: TransactionTypeFilter;
  status?: TransactionStatusFilter;
  categoryId?: string;
  fundId?: string;
  accountId?: string;
  createdBy?: string;
  search?: string;
  startDate?: Date;
  endDate?: Date;
  mosqueId?: string;
}

export interface GetPendingTransactionsQueryInput {
  limit: number;
  type?: "DONATION" | "EXPENSE";
  search?: string;
  mosqueId?: string;
}

export interface RejectTransactionInput {
  reason: string;
}

/**
 * Validates query parameters for GET /api/transactions
 */
export function validateGetTransactionsQuery(query: unknown): GetTransactionsQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // limit (default 20, max 100)
  let limit = 20;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const parsedLimit = Number(raw["limit"]);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      issues.push({ field: "limit", issue: "Limit must be an integer between 1 and 100." });
    } else {
      limit = parsedLimit;
    }
  }

  // cursor (opaque string)
  let cursor: string | undefined;
  if (typeof raw["cursor"] === "string" && raw["cursor"].trim()) {
    cursor = raw["cursor"].trim();
  }

  // type filter
  let type: TransactionTypeFilter | undefined;
  if (typeof raw["type"] === "string" && raw["type"].trim()) {
    const rawType = raw["type"].trim().toUpperCase();
    if (["DONATION", "EXPENSE", "TRANSFER", "INCOME"].includes(rawType)) {
      type = (rawType === "INCOME" ? "DONATION" : rawType) as TransactionTypeFilter;
    } else {
      issues.push({
        field: "type",
        issue: "Type must be one of: 'DONATION', 'EXPENSE', 'TRANSFER', 'INCOME'.",
      });
    }
  }

  // status filter
  let status: TransactionStatusFilter | undefined;
  if (typeof raw["status"] === "string" && raw["status"].trim()) {
    const rawStatus = raw["status"].trim().toUpperCase();
    if (["PENDING", "PENDING_APPROVAL", "POSTED", "REJECTED", "VOIDED"].includes(rawStatus)) {
      status = rawStatus as TransactionStatusFilter;
    } else {
      issues.push({
        field: "status",
        issue: "Status must be one of: 'PENDING', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'VOIDED'.",
      });
    }
  }

  // categoryId
  let categoryId: string | undefined;
  if (typeof raw["categoryId"] === "string" && raw["categoryId"].trim()) {
    categoryId = raw["categoryId"].trim();
  }

  // fundId
  let fundId: string | undefined;
  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    fundId = raw["fundId"].trim();
  }

  // accountId
  let accountId: string | undefined;
  if (typeof raw["accountId"] === "string" && raw["accountId"].trim()) {
    accountId = raw["accountId"].trim();
  }

  // createdBy
  let createdBy: string | undefined;
  if (typeof raw["createdBy"] === "string" && raw["createdBy"].trim()) {
    createdBy = raw["createdBy"].trim();
  }

  // search
  let search: string | undefined;
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    search = raw["search"].trim();
  }

  // startDate
  let startDate: Date | undefined;
  if (raw["startDate"] !== undefined && raw["startDate"] !== null && raw["startDate"] !== "") {
    const parsed = new Date(String(raw["startDate"]));
    if (isNaN(parsed.getTime())) {
      issues.push({ field: "startDate", issue: "startDate must be a valid ISO-8601 date." });
    } else {
      startDate = parsed;
    }
  }

  // endDate
  let endDate: Date | undefined;
  if (raw["endDate"] !== undefined && raw["endDate"] !== null && raw["endDate"] !== "") {
    const parsed = new Date(String(raw["endDate"]));
    if (isNaN(parsed.getTime())) {
      issues.push({ field: "endDate", issue: "endDate must be a valid ISO-8601 date." });
    } else {
      endDate = parsed;
    }
  }

  if (startDate && endDate && startDate > endDate) {
    issues.push({ field: "startDate", issue: "startDate cannot be later than endDate." });
  }

  // mosqueId override
  let mosqueId: string | undefined;
  if (typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Invalid query parameters.");
  }

  return {
    cursor,
    limit,
    type,
    status,
    categoryId,
    fundId,
    accountId,
    createdBy,
    search,
    startDate,
    endDate,
    mosqueId,
  };
}

/**
 * Validates query parameters for GET /api/transactions/pending
 */
export function validateGetPendingTransactionsQuery(
  query: unknown,
): GetPendingTransactionsQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let limit = 50;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const parsedLimit = Number(raw["limit"]);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      issues.push({ field: "limit", issue: "Limit must be an integer between 1 and 100." });
    } else {
      limit = parsedLimit;
    }
  }

  let type: "DONATION" | "EXPENSE" | undefined;
  if (typeof raw["type"] === "string" && raw["type"].trim()) {
    const rawType = raw["type"].trim().toUpperCase();
    if (rawType === "DONATION" || rawType === "EXPENSE") {
      type = rawType;
    } else {
      issues.push({
        field: "type",
        issue: "Type must be either 'DONATION' or 'EXPENSE'.",
      });
    }
  }

  let search: string | undefined;
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    search = raw["search"].trim();
  }

  let mosqueId: string | undefined;
  if (typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Invalid query parameters.");
  }

  return {
    limit,
    type,
    search,
    mosqueId,
  };
}

/**
 * Validates body for POST /api/transactions/:id/reject
 */
export function validateRejectTransactionInput(body: unknown): RejectTransactionInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let reason = "";
  if (raw["reason"] === undefined || raw["reason"] === null || raw["reason"] === "") {
    issues.push({ field: "reason", issue: "Reason is required to reject a transaction." });
  } else if (typeof raw["reason"] !== "string" || raw["reason"].trim().length < 3) {
    issues.push({ field: "reason", issue: "Reason must be at least 3 characters long." });
  } else {
    reason = raw["reason"].trim();
    if (reason.length > 500) {
      issues.push({ field: "reason", issue: "Reason cannot exceed 500 characters." });
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Invalid rejection input.");
  }

  return { reason };
}

/**
 * Validates URL parameter :id
 */
export function validateTransactionIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Transaction identifier is required.", "INVALID_TRANSACTION_ID");
  }
  return param.trim();
}

