// =============================================================================
// collection.validation.ts — Input Validation for Domain 8: Collection Sessions
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";
import { CollectionStatus } from "../../../generated/prisma/client.js";

export interface ValidationIssue {
  field: string;
  issue: string;
}

export interface CreateCollectionSessionInput {
  occasion: string;
  date: Date;
  totalAmount: bigint;
  notes?: string | null;
  fundId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  mosqueId?: string;
}

export interface VerifyCollectionSessionInput {
  fundId?: string;
  accountId?: string;
  categoryId?: string;
  notes?: string;
}

export interface GetCollectionsQueryInput {
  status?: CollectionStatus;
  occasion?: string;
  fundId?: string;
  accountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export function validateCollectionIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Collection session ID must be a non-empty string.", "INVALID_COLLECTION_ID");
  }
  return param.trim();
}

/**
 * Validates POST /collections input body
 */
export function validateCreateCollectionSessionInput(body: unknown): CreateCollectionSessionInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- occasion (required, string, 2-100 chars)
  let occasion = "";
  if (typeof raw["occasion"] !== "string" || !raw["occasion"].trim()) {
    issues.push({ field: "occasion", issue: "Collection occasion is required (e.g. 'JUMMAH', 'EID', 'TARAWEEH')." });
  } else {
    occasion = raw["occasion"].trim();
    if (occasion.length < 2 || occasion.length > 100) {
      issues.push({ field: "occasion", issue: "Occasion must be between 2 and 100 characters." });
    }
  }

  // -- totalAmount (required, strictly positive BigInt minor units)
  let totalAmount = 0n;
  if (raw["totalAmount"] === undefined || raw["totalAmount"] === null || raw["totalAmount"] === "") {
    issues.push({ field: "totalAmount", issue: "Total amount is required." });
  } else {
    try {
      const rawAmount = raw["totalAmount"];
      if (typeof rawAmount === "bigint") {
        if (rawAmount <= 0n) {
          issues.push({ field: "totalAmount", issue: "Total amount must be a positive integer in minor units (poisha)." });
        } else {
          totalAmount = rawAmount;
        }
      } else if (typeof rawAmount === "number") {
        if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          issues.push({ field: "totalAmount", issue: "Total amount must be a positive integer in minor units (poisha)." });
        } else {
          totalAmount = BigInt(rawAmount);
        }
      } else if (typeof rawAmount === "string") {
        const trimmed = rawAmount.trim();
        if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          issues.push({ field: "totalAmount", issue: "Total amount must be a positive integer in minor units (poisha)." });
        } else {
          totalAmount = BigInt(trimmed);
        }
      } else {
        issues.push({ field: "totalAmount", issue: "Total amount must be a valid integer or numeric string." });
      }
    } catch {
      issues.push({ field: "totalAmount", issue: "Invalid total amount format." });
    }
  }

  // -- date (optional, defaults to now)
  let date = new Date();
  if (raw["date"] !== undefined && raw["date"] !== null && raw["date"] !== "") {
    if (typeof raw["date"] === "string" || typeof raw["date"] === "number" || raw["date"] instanceof Date) {
      const parsedDate = new Date(raw["date"]);
      if (Number.isNaN(parsedDate.getTime())) {
        issues.push({ field: "date", issue: "Invalid date format." });
      } else {
        date = parsedDate;
      }
    } else {
      issues.push({ field: "date", issue: "Date must be a valid date string or timestamp." });
    }
  }

  // -- notes (optional string)
  let notes: string | null = null;
  if (raw["notes"] !== undefined && raw["notes"] !== null) {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      notes = raw["notes"].trim() || null;
      if (notes && notes.length > 1000) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 1000 characters." });
      }
    }
  }

  // -- fundId (optional string)
  let fundId: string | null = null;
  if (raw["fundId"] !== undefined && raw["fundId"] !== null) {
    if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
      issues.push({ field: "fundId", issue: "fundId must be a valid string." });
    } else {
      fundId = raw["fundId"].trim();
    }
  }

  // -- accountId (optional string)
  let accountId: string | null = null;
  if (raw["accountId"] !== undefined && raw["accountId"] !== null) {
    if (typeof raw["accountId"] !== "string" || !raw["accountId"].trim()) {
      issues.push({ field: "accountId", issue: "accountId must be a valid string." });
    } else {
      accountId = raw["accountId"].trim();
    }
  }

  // -- categoryId (optional string)
  let categoryId: string | null = null;
  if (raw["categoryId"] !== undefined && raw["categoryId"] !== null) {
    if (typeof raw["categoryId"] !== "string" || !raw["categoryId"].trim()) {
      issues.push({ field: "categoryId", issue: "categoryId must be a valid string." });
    } else {
      categoryId = raw["categoryId"].trim();
    }
  }

  // -- mosqueId (optional string)
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null) {
    if (typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
      mosqueId = raw["mosqueId"].trim();
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    occasion,
    date,
    totalAmount,
    notes,
    fundId,
    accountId,
    categoryId,
    mosqueId,
  };
}

/**
 * Validates POST /collections/:id/verify input body
 */
export function validateVerifyCollectionSessionInput(body: unknown): VerifyCollectionSessionInput {
  if (!body || typeof body !== "object") {
    return {};
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let fundId: string | undefined;
  if (raw["fundId"] !== undefined && raw["fundId"] !== null) {
    if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
      issues.push({ field: "fundId", issue: "fundId must be a non-empty string." });
    } else {
      fundId = raw["fundId"].trim();
    }
  }

  let accountId: string | undefined;
  if (raw["accountId"] !== undefined && raw["accountId"] !== null) {
    if (typeof raw["accountId"] !== "string" || !raw["accountId"].trim()) {
      issues.push({ field: "accountId", issue: "accountId must be a non-empty string." });
    } else {
      accountId = raw["accountId"].trim();
    }
  }

  let categoryId: string | undefined;
  if (raw["categoryId"] !== undefined && raw["categoryId"] !== null) {
    if (typeof raw["categoryId"] !== "string" || !raw["categoryId"].trim()) {
      issues.push({ field: "categoryId", issue: "categoryId must be a non-empty string." });
    } else {
      categoryId = raw["categoryId"].trim();
    }
  }

  let notes: string | undefined;
  if (raw["notes"] !== undefined && raw["notes"] !== null) {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "notes must be a string." });
    } else {
      notes = raw["notes"].trim();
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    fundId,
    accountId,
    categoryId,
    notes,
  };
}

/**
 * Validates GET /collections query parameters
 */
export function validateGetCollectionsQuery(query: unknown): GetCollectionsQueryInput {
  if (!query || typeof query !== "object") {
    return {};
  }

  const raw = query as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let status: CollectionStatus | undefined;
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    const s = String(raw["status"]).toUpperCase();
    if (Object.values(CollectionStatus).includes(s as CollectionStatus)) {
      status = s as CollectionStatus;
    } else {
      issues.push({
        field: "status",
        issue: `Invalid status. Must be one of: ${Object.values(CollectionStatus).join(", ")}.`,
      });
    }
  }

  let occasion: string | undefined;
  if (typeof raw["occasion"] === "string" && raw["occasion"].trim()) {
    occasion = raw["occasion"].trim();
  }

  let fundId: string | undefined;
  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    fundId = raw["fundId"].trim();
  }

  let accountId: string | undefined;
  if (typeof raw["accountId"] === "string" && raw["accountId"].trim()) {
    accountId = raw["accountId"].trim();
  }

  let dateFrom: Date | undefined;
  if (raw["dateFrom"] !== undefined && raw["dateFrom"] !== null && raw["dateFrom"] !== "") {
    const d = new Date(String(raw["dateFrom"]));
    if (Number.isNaN(d.getTime())) {
      issues.push({ field: "dateFrom", issue: "dateFrom must be a valid ISO date." });
    } else {
      dateFrom = d;
    }
  }

  let dateTo: Date | undefined;
  if (raw["dateTo"] !== undefined && raw["dateTo"] !== null && raw["dateTo"] !== "") {
    const d = new Date(String(raw["dateTo"]));
    if (Number.isNaN(d.getTime())) {
      issues.push({ field: "dateTo", issue: "dateTo must be a valid ISO date." });
    } else {
      dateTo = d;
    }
  }

  let page: number | undefined;
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      issues.push({ field: "page", issue: "page must be a positive integer >= 1." });
    } else {
      page = p;
    }
  }

  let limit: number | undefined;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      issues.push({ field: "limit", issue: "limit must be an integer between 1 and 100." });
    } else {
      limit = l;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    status,
    occasion,
    fundId,
    accountId,
    dateFrom,
    dateTo,
    page,
    limit,
  };
}
