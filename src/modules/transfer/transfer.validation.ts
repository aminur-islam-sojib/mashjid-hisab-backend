// ---------------------------------------------------------------------------
// Transfer Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { TransferStatus } from "../../../generated/prisma/client.js";

export interface CreateTransferInput {
  amount: bigint;
  fromAccountId: string;
  toAccountId: string;
  fromFundId: string;
  toFundId: string;
  date: Date;
  reason?: string | null;
  notes?: string | null;
  mosqueId?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/transfers and POST /api/transfers
 *
 * Rules:
 *  - amount: strictly positive integer in minor units (poisha), bigint > 0
 *  - fromAccountId: required non-empty string
 *  - toAccountId: required non-empty string
 *  - fundId OR fromFundId / toFundId: required. If fundId is provided, both legs share it.
 *  - If fromFundId !== toFundId: fund-to-fund transfer; reason is mandatory (min 3 chars).
 *  - fromAccountId and toAccountId cannot be identical if fromFundId and toFundId are identical.
 *  - date: valid date, defaults to current time if omitted.
 *  - notes: optional string (max 500).
 */
export function validateCreateTransferInput(body: unknown): CreateTransferInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units) ----------------
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Transfer amount is required." });
  } else {
    try {
      const rawAmount = raw["amount"];
      if (typeof rawAmount === "bigint") {
        if (rawAmount <= 0n) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = rawAmount;
        }
      } else if (typeof rawAmount === "number") {
        if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = BigInt(rawAmount);
        }
      } else if (typeof rawAmount === "string") {
        const trimmed = rawAmount.trim();
        if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = BigInt(trimmed);
        }
      } else {
        issues.push({
          field: "amount",
          issue: "Amount must be a valid number or numeric string.",
        });
      }
    } catch {
      issues.push({
        field: "amount",
        issue: "Amount must be a positive integer in minor units (poisha).",
      });
    }
  }

  // -- fromAccountId (required) ----------------------------------------------
  let fromAccountId = "";
  if (
    raw["fromAccountId"] === undefined ||
    raw["fromAccountId"] === null ||
    raw["fromAccountId"] === ""
  ) {
    issues.push({ field: "fromAccountId", issue: "Source account ID (fromAccountId) is required." });
  } else if (typeof raw["fromAccountId"] !== "string" || !raw["fromAccountId"].trim()) {
    issues.push({ field: "fromAccountId", issue: "Source account ID must be a non-empty string." });
  } else {
    fromAccountId = raw["fromAccountId"].trim();
  }

  // -- toAccountId (required) ------------------------------------------------
  let toAccountId = "";
  if (
    raw["toAccountId"] === undefined ||
    raw["toAccountId"] === null ||
    raw["toAccountId"] === ""
  ) {
    issues.push({
      field: "toAccountId",
      issue: "Destination account ID (toAccountId) is required.",
    });
  } else if (typeof raw["toAccountId"] !== "string" || !raw["toAccountId"].trim()) {
    issues.push({
      field: "toAccountId",
      issue: "Destination account ID must be a non-empty string.",
    });
  } else {
    toAccountId = raw["toAccountId"].trim();
  }

  // -- fund resolution (fundId, fromFundId, toFundId) ------------------------
  let fromFundId = "";
  let toFundId = "";

  const rawFundId = typeof raw["fundId"] === "string" ? raw["fundId"].trim() : "";
  const rawFromFundId = typeof raw["fromFundId"] === "string" ? raw["fromFundId"].trim() : "";
  const rawToFundId = typeof raw["toFundId"] === "string" ? raw["toFundId"].trim() : "";

  if (rawFundId) {
    fromFundId = rawFundId;
    toFundId = rawToFundId || rawFundId;
  } else if (rawFromFundId) {
    fromFundId = rawFromFundId;
    toFundId = rawToFundId || rawFromFundId;
  } else {
    issues.push({
      field: "fundId",
      issue: "Fund ID (fundId or fromFundId) is required.",
    });
  }

  // Guard against identical source and destination
  if (
    fromAccountId &&
    toAccountId &&
    fromFundId &&
    toFundId &&
    fromAccountId === toAccountId &&
    fromFundId === toFundId
  ) {
    issues.push({
      field: "toAccountId",
      issue:
        "Source and destination cannot both be identical. Must move money to a different account or fund.",
    });
  }

  // -- reason (mandatory for fund-to-fund transfers) -------------------------
  let reason: string | null = null;
  const isFundToFund = Boolean(fromFundId && toFundId && fromFundId !== toFundId);

  if (raw["reason"] !== undefined && raw["reason"] !== null) {
    if (typeof raw["reason"] !== "string") {
      issues.push({ field: "reason", issue: "Reason must be a string." });
    } else {
      const trimmedReason = raw["reason"].trim();
      if (trimmedReason.length > 500) {
        issues.push({ field: "reason", issue: "Reason cannot exceed 500 characters." });
      } else if (trimmedReason.length > 0) {
        reason = trimmedReason;
      }
    }
  }

  if (isFundToFund && (!reason || reason.length < 3)) {
    issues.push({
      field: "reason",
      issue:
        "A clear reason (at least 3 characters) is required for fund-to-fund transfers.",
    });
  }

  // -- date (optional, defaults to current date) -----------------------------
  let date = new Date();
  if (raw["date"] !== undefined && raw["date"] !== null && raw["date"] !== "") {
    if (typeof raw["date"] === "string" || raw["date"] instanceof Date) {
      const parsedDate = new Date(raw["date"]);
      if (isNaN(parsedDate.getTime())) {
        issues.push({ field: "date", issue: "Date must be a valid ISO-8601 date string." });
      } else {
        date = parsedDate;
      }
    } else {
      issues.push({ field: "date", issue: "Date must be a valid date or date string." });
    }
  }

  // -- notes (optional, max 500) ---------------------------------------------
  let notes: string | null = null;
  if (raw["notes"] !== undefined && raw["notes"] !== null) {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      const trimmedNotes = raw["notes"].trim();
      if (trimmedNotes.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else if (trimmedNotes.length > 0) {
        notes = trimmedNotes;
      }
    }
  }

  // -- mosqueId (optional override in body) ----------------------------------
  let mosqueId: string | undefined;
  if (typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Invalid transfer input.");
  }

  return {
    amount,
    fromAccountId,
    toAccountId,
    fromFundId,
    toFundId,
    date,
    reason,
    notes,
    mosqueId,
  };
}

export interface GetMosqueTransfersQueryInput {
  page: number;
  limit: number;
  accountId?: string;
  fundId?: string;
  status?: TransferStatus;
  dateFrom?: Date;
  dateTo?: Date;
  isFundTransfer?: boolean;
  search?: string;
  sortBy: "date" | "createdAt" | "amount";
  sortOrder: "asc" | "desc";
  mosqueId?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/transfers and GET /api/transfers
 */
export function validateGetMosqueTransfersQuery(query: unknown): GetMosqueTransfersQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // page (default 1)
  let page = 1;
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const parsedPage = Number(raw["page"]);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      issues.push({ field: "page", issue: "Page must be a positive integer greater than or equal to 1." });
    } else {
      page = parsedPage;
    }
  }

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

  // accountId filter
  let accountId: string | undefined;
  if (typeof raw["accountId"] === "string" && raw["accountId"].trim()) {
    accountId = raw["accountId"].trim();
  }

  // fundId filter
  let fundId: string | undefined;
  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    fundId = raw["fundId"].trim();
  }

  // status filter
  let status: TransferStatus | undefined;
  if (typeof raw["status"] === "string" && raw["status"].trim()) {
    const rawStatus = raw["status"].trim().toUpperCase();
    if (Object.values(TransferStatus).includes(rawStatus as TransferStatus)) {
      status = rawStatus as TransferStatus;
    } else {
      issues.push({
        field: "status",
        issue: `Invalid status. Allowed values: ${Object.values(TransferStatus).join(", ")}.`,
      });
    }
  }

  // dateFrom filter
  let dateFrom: Date | undefined;
  if (raw["dateFrom"] !== undefined && raw["dateFrom"] !== null && raw["dateFrom"] !== "") {
    const parsed = new Date(String(raw["dateFrom"]));
    if (isNaN(parsed.getTime())) {
      issues.push({ field: "dateFrom", issue: "dateFrom must be a valid ISO-8601 date string." });
    } else {
      dateFrom = parsed;
    }
  }

  // dateTo filter
  let dateTo: Date | undefined;
  if (raw["dateTo"] !== undefined && raw["dateTo"] !== null && raw["dateTo"] !== "") {
    const parsed = new Date(String(raw["dateTo"]));
    if (isNaN(parsed.getTime())) {
      issues.push({ field: "dateTo", issue: "dateTo must be a valid ISO-8601 date string." });
    } else {
      dateTo = parsed;
    }
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    issues.push({ field: "dateFrom", issue: "dateFrom cannot be later than dateTo." });
  }

  // isFundTransfer filter (boolean)
  let isFundTransfer: boolean | undefined;
  if (raw["isFundTransfer"] !== undefined && raw["isFundTransfer"] !== null && raw["isFundTransfer"] !== "") {
    const str = String(raw["isFundTransfer"]).toLowerCase().trim();
    if (str === "true" || str === "1") {
      isFundTransfer = true;
    } else if (str === "false" || str === "0") {
      isFundTransfer = false;
    } else {
      issues.push({ field: "isFundTransfer", issue: "isFundTransfer must be 'true' or 'false'." });
    }
  }

  // search filter
  let search: string | undefined;
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    search = raw["search"].trim();
  }

  // sortBy (default: date)
  let sortBy: "date" | "createdAt" | "amount" = "date";
  if (typeof raw["sortBy"] === "string" && raw["sortBy"].trim()) {
    const val = raw["sortBy"].trim();
    if (val === "date" || val === "createdAt" || val === "amount") {
      sortBy = val;
    } else {
      issues.push({ field: "sortBy", issue: "sortBy must be one of: 'date', 'createdAt', 'amount'." });
    }
  }

  // sortOrder (default: desc)
  let sortOrder: "asc" | "desc" = "desc";
  if (typeof raw["sortOrder"] === "string" && raw["sortOrder"].trim()) {
    const val = raw["sortOrder"].trim().toLowerCase();
    if (val === "asc" || val === "desc") {
      sortOrder = val;
    } else {
      issues.push({ field: "sortOrder", issue: "sortOrder must be 'asc' or 'desc'." });
    }
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
    page,
    limit,
    accountId,
    fundId,
    status,
    dateFrom,
    dateTo,
    isFundTransfer,
    search,
    sortBy,
    sortOrder,
    mosqueId,
  };
}

export interface VoidTransferInput {
  reason: string;
}

/**
 * Validates request payload for POST /api/transfers/:id/void
 */
export function validateVoidTransferInput(body: unknown): VoidTransferInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let reason = "";
  if (raw["reason"] === undefined || raw["reason"] === null || raw["reason"] === "") {
    issues.push({ field: "reason", issue: "Reason is required to void a transfer." });
  } else if (typeof raw["reason"] !== "string" || raw["reason"].trim().length < 3) {
    issues.push({
      field: "reason",
      issue: "Reason must be at least 3 characters long.",
    });
  } else {
    reason = raw["reason"].trim();
    if (reason.length > 500) {
      issues.push({ field: "reason", issue: "Reason cannot exceed 500 characters." });
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Invalid void transfer input.");
  }

  return { reason };
}

/**
 * Validates URL parameter :id
 */
export function validateTransferIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Transfer identifier is required.", "INVALID_TRANSFER_ID");
  }
  return param.trim();
}
