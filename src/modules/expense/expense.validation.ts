// ---------------------------------------------------------------------------
// Expense Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { ExpenseStatus } from "../../../generated/prisma/client.js";

export interface CreateExpenseInput {
  amount: bigint;
  accountId: string;
  fundId: string;
  categoryId: string;
  date: Date;
  payee: string;
  voucherNo?: string | null;
  notes?: string | null;
  attachments: string[];
  mosqueId?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/expenses and POST /api/expenses
 *
 * Requirements:
 *  - amount: strictly positive integer in minor units (poisha), bigint > 0
 *  - accountId: required non-empty string
 *  - fundId: required non-empty string
 *  - categoryId: required non-empty string
 *  - date: required valid date (ISO-8601 string or Date)
 *  - payee: required string (min 2, max 200)
 *  - voucherNo: optional string (max 100)
 *  - attachments: required array with at least one bill photo / receipt URL
 *  - notes: optional string (max 500)
 */
export function validateCreateExpenseInput(body: unknown): CreateExpenseInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units) ----------------
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Expense amount is required." });
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

  // -- accountId (required) ---------------------------------------------------
  let accountId = "";
  if (raw["accountId"] === undefined || raw["accountId"] === null || raw["accountId"] === "") {
    issues.push({ field: "accountId", issue: "Account ID is required." });
  } else if (typeof raw["accountId"] !== "string" || !raw["accountId"].trim()) {
    issues.push({ field: "accountId", issue: "Account ID must be a non-empty string." });
  } else {
    accountId = raw["accountId"].trim();
  }

  // -- fundId (required) ------------------------------------------------------
  let fundId = "";
  if (raw["fundId"] === undefined || raw["fundId"] === null || raw["fundId"] === "") {
    issues.push({ field: "fundId", issue: "Fund ID is required." });
  } else if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
    issues.push({ field: "fundId", issue: "Fund ID must be a non-empty string." });
  } else {
    fundId = raw["fundId"].trim();
  }

  // -- categoryId (required) --------------------------------------------------
  let categoryId = "";
  if (raw["categoryId"] === undefined || raw["categoryId"] === null || raw["categoryId"] === "") {
    issues.push({ field: "categoryId", issue: "Category ID is required." });
  } else if (typeof raw["categoryId"] !== "string" || !raw["categoryId"].trim()) {
    issues.push({ field: "categoryId", issue: "Category ID must be a non-empty string." });
  } else {
    categoryId = raw["categoryId"].trim();
  }

  // -- date (required) --------------------------------------------------------
  let date: Date = new Date();
  if (raw["date"] === undefined || raw["date"] === null || raw["date"] === "") {
    issues.push({ field: "date", issue: "Expense date is required." });
  } else if (typeof raw["date"] === "string" || typeof raw["date"] === "number" || raw["date"] instanceof Date) {
    const parsedDate = new Date(raw["date"]);
    if (isNaN(parsedDate.getTime())) {
      issues.push({ field: "date", issue: "Invalid date format. Expected a valid ISO-8601 date string." });
    } else {
      date = parsedDate;
    }
  } else {
    issues.push({ field: "date", issue: "Date must be a valid date string or timestamp." });
  }

  // -- payee (required) -------------------------------------------------------
  let payee = "";
  const rawPayee = raw["payee"];
  if (rawPayee === undefined || rawPayee === null || rawPayee === "") {
    issues.push({ field: "payee", issue: "Payee is required." });
  } else if (typeof rawPayee !== "string") {
    issues.push({ field: "payee", issue: "Payee must be a string." });
  } else {
    const trimmed = rawPayee.trim();
    if (trimmed.length < 2) {
      issues.push({ field: "payee", issue: "Payee must be at least 2 characters." });
    } else if (trimmed.length > 200) {
      issues.push({ field: "payee", issue: "Payee cannot exceed 200 characters." });
    } else {
      payee = trimmed;
    }
  }

  // -- voucherNo / voucherNumber (optional) ----------------------------------
  let voucherNo: string | null = null;
  const rawVoucher = raw["voucherNo"] ?? raw["voucherNumber"];
  if (rawVoucher !== undefined && rawVoucher !== null && rawVoucher !== "") {
    if (typeof rawVoucher !== "string") {
      issues.push({ field: "voucherNo", issue: "Voucher number must be a string." });
    } else {
      const trimmed = rawVoucher.trim();
      if (trimmed.length > 100) {
        issues.push({ field: "voucherNo", issue: "Voucher number cannot exceed 100 characters." });
      } else {
        voucherNo = trimmed;
      }
    }
  }

  // -- attachments / attachment / billPhoto (required: bill photo) ------------
  const attachments: string[] = [];
  const rawAttachments = raw["attachments"];
  const rawAttachment = raw["attachment"] ?? raw["billPhoto"];

  if (Array.isArray(rawAttachments)) {
    for (let i = 0; i < rawAttachments.length; i++) {
      const item = rawAttachments[i];
      if (typeof item === "string" && item.trim()) {
        attachments.push(item.trim());
      } else {
        issues.push({
          field: `attachments[${i}]`,
          issue: "Attachment URL must be a non-empty string.",
        });
      }
    }
  } else if (typeof rawAttachment === "string" && rawAttachment.trim()) {
    attachments.push(rawAttachment.trim());
  } else if (rawAttachments !== undefined && !Array.isArray(rawAttachments)) {
    issues.push({
      field: "attachments",
      issue: "Attachments must be an array of string URLs.",
    });
  }

  if (attachments.length === 0) {
    issues.push({
      field: "attachments",
      issue: "At least one attachment (bill photo or receipt scan) is required to record an expense.",
    });
  }

  // -- notes (optional) -------------------------------------------------------
  let notes: string | null = null;
  const rawNotes = raw["notes"] ?? raw["description"];
  if (rawNotes !== undefined && rawNotes !== null && rawNotes !== "") {
    if (typeof rawNotes !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      const trimmed = rawNotes.trim();
      if (trimmed.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        notes = trimmed;
      }
    }
  }

  // -- mosqueId (optional parameter from body) -------------------------------
  let mosqueId: string | undefined = undefined;
  if (typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    amount,
    accountId,
    fundId,
    categoryId,
    date,
    payee,
    voucherNo,
    notes,
    attachments,
    mosqueId,
  };
}

/**
 * Validates a CUID route parameter for expense endpoints.
 */
export function validateExpenseIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Expense ID must be a non-empty string.", "INVALID_EXPENSE_ID");
  }
  return param.trim();
}

export interface GetMosqueExpensesQueryInput {
  payee?: string;
  voucherNo?: string;
  fund?: string;
  fundId?: string;
  account?: string;
  accountId?: string;
  category?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
  // Gracefully accepted filters shared with donations
  donor?: string;
  memberId?: string;
  family?: string;
  familyId?: string;
  campaign?: string;
  campaignId?: string;
  source?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/expenses and GET /api/expenses.
 *
 * Supported filters:
 *  - payee: text substring search on payee
 *  - voucherNo (or voucher): exact or substring match on voucher number
 *  - fund (or fundId): target fund CUID
 *  - account (or accountId): target account CUID
 *  - category (or categoryId): target category CUID
 *  - status: ExpenseStatus (PENDING, PENDING_APPROVAL, POSTED, REJECTED, VOIDED)
 *  - date range: startDate / endDate (aliases: fromDate / toDate, from / to)
 *  - search: full-text search across voucherNo, payee, notes
 *  - pagination: page (default 1), limit (default 20, max 100)
 */
export function validateGetMosqueExpensesQuery(query: unknown): GetMosqueExpensesQueryInput {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueExpensesQueryInput = {};

  // -- payee filter
  if (typeof raw["payee"] === "string" && raw["payee"].trim()) {
    result.payee = raw["payee"].trim();
  }

  // -- voucherNo filter
  const voucherVal = raw["voucherNo"] ?? raw["voucher"];
  if (typeof voucherVal === "string" && voucherVal.trim()) {
    result.voucherNo = voucherVal.trim();
  }

  // -- fund / fundId filter
  const fundVal = raw["fund"] ?? raw["fundId"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    result.fund = fundVal.trim();
    result.fundId = fundVal.trim();
  }

  // -- account / accountId filter
  const accountVal = raw["account"] ?? raw["accountId"];
  if (typeof accountVal === "string" && accountVal.trim()) {
    result.account = accountVal.trim();
    result.accountId = accountVal.trim();
  }

  // -- category / categoryId filter
  const categoryVal = raw["category"] ?? raw["categoryId"];
  if (typeof categoryVal === "string" && categoryVal.trim()) {
    result.category = categoryVal.trim();
    result.categoryId = categoryVal.trim();
  }

  // -- status filter
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("Status filter must be a string.");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(ExpenseStatus).includes(statusUpper as ExpenseStatus)) {
      throw HttpError.badRequest(
        `Invalid expense status '${raw["status"]}'. Allowed: ${Object.values(ExpenseStatus).join(", ")}.`,
        "INVALID_EXPENSE_STATUS",
      );
    }
    result.status = statusUpper as ExpenseStatus;
  }

  // -- date range (startDate / endDate / fromDate / toDate / from / to)
  const rawStart = raw["startDate"] ?? raw["fromDate"] ?? raw["from"];
  if (rawStart !== undefined && rawStart !== null && rawStart !== "") {
    const d = new Date(rawStart as string | number);
    if (isNaN(d.getTime())) {
      throw HttpError.badRequest("Invalid startDate/from format. Expected valid date.", "INVALID_DATE_FORMAT");
    }
    result.startDate = d;
  }

  const rawEnd = raw["endDate"] ?? raw["toDate"] ?? raw["to"];
  if (rawEnd !== undefined && rawEnd !== null && rawEnd !== "") {
    if (typeof rawEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd.trim())) {
      const d = new Date(rawEnd.trim());
      d.setUTCHours(23, 59, 59, 999);
      result.endDate = d;
    } else {
      const d = new Date(rawEnd as string | number);
      if (isNaN(d.getTime())) {
        throw HttpError.badRequest("Invalid endDate/to format. Expected valid date.", "INVALID_DATE_FORMAT");
      }
      result.endDate = d;
    }
  }

  // -- text search
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    result.search = raw["search"].trim();
  }

  // -- pagination (page, limit)
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      throw HttpError.badRequest("page must be a positive integer.", "INVALID_PAGINATION_PAGE");
    }
    result.page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1) {
      throw HttpError.badRequest("limit must be a positive integer.", "INVALID_PAGINATION_LIMIT");
    }
    result.limit = l;
  }

  // -- gracefully accepted donation filters
  if (typeof raw["donor"] === "string" && raw["donor"].trim()) {
    result.donor = raw["donor"].trim();
  }
  if (typeof raw["memberId"] === "string" && raw["memberId"].trim()) {
    result.memberId = raw["memberId"].trim();
  }
  if (typeof raw["family"] === "string" && raw["family"].trim()) {
    result.family = raw["family"].trim();
  }
  if (typeof raw["familyId"] === "string" && raw["familyId"].trim()) {
    result.familyId = raw["familyId"].trim();
  }
  if (typeof raw["campaign"] === "string" && raw["campaign"].trim()) {
    result.campaign = raw["campaign"].trim();
  }
  if (typeof raw["campaignId"] === "string" && raw["campaignId"].trim()) {
    result.campaignId = raw["campaignId"].trim();
  }
  if (typeof raw["source"] === "string" && raw["source"].trim()) {
    result.source = raw["source"].trim();
  }

  return result;
}

export interface UpdateExpenseInput {
  notes?: string | null;
  payee?: string;
  attachments?: string[];
}

const IMMUTABLE_EXPENSE_FIELDS = [
  "amount",
  "fundId",
  "fund",
  "accountId",
  "account",
  "categoryId",
  "category",
  "date",
  "voucherNo",
  "voucherNumber",
  "voucher",
  "status",
  "reversalOfId",
] as const;

/**
 * Validates request payload for PATCH /api/mosques/:mosqueId/expenses/:id and PATCH /api/expenses/:id
 *
 * Rules:
 *  - Only non-financial fields are editable: notes, payee, attachments.
 *  - Financial/core fields (amount, fund, account, category, date, voucherNo, status) are strictly rejected
 *    with 400 Bad Request and error code 'TRANSACTION_IMMUTABLE'.
 *  - At least one editable field must be provided.
 */
export function validateUpdateExpenseInput(body: unknown): UpdateExpenseInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  // 1. Strict immutability check
  for (const field of IMMUTABLE_EXPENSE_FIELDS) {
    if (raw[field] !== undefined) {
      throw HttpError.badRequest(
        "Financial fields (amount, fund, account, date, category, voucher) cannot be modified on recorded expenses. Void and recreate the entry if a financial correction is needed.",
        "TRANSACTION_IMMUTABLE",
      );
    }
  }

  const issues: ValidationIssue[] = [];
  const result: UpdateExpenseInput = {};
  let hasFields = false;

  // -- notes / note / description
  const notesVal =
    raw["notes"] !== undefined
      ? raw["notes"]
      : raw["note"] !== undefined
      ? raw["note"]
      : raw["description"];

  if (notesVal !== undefined) {
    hasFields = true;
    if (notesVal === null || notesVal === "") {
      result.notes = null;
    } else if (typeof notesVal !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string or null." });
    } else {
      const trimmed = notesVal.trim();
      if (trimmed.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        result.notes = trimmed || null;
      }
    }
  }

  // -- payee
  const payeeVal = raw["payee"];
  if (payeeVal !== undefined) {
    hasFields = true;
    if (typeof payeeVal !== "string") {
      issues.push({ field: "payee", issue: "Payee must be a string." });
    } else {
      const trimmed = payeeVal.trim();
      if (trimmed.length < 2) {
        issues.push({ field: "payee", issue: "Payee must be at least 2 characters." });
      } else if (trimmed.length > 200) {
        issues.push({ field: "payee", issue: "Payee cannot exceed 200 characters." });
      } else {
        result.payee = trimmed;
      }
    }
  }

  // -- attachments / attachment / billPhoto
  const rawAttachments = raw["attachments"];
  const rawAttachment =
    raw["attachment"] !== undefined ? raw["attachment"] : raw["billPhoto"];

  if (rawAttachments !== undefined || rawAttachment !== undefined) {
    hasFields = true;
    const attachments: string[] = [];
    if (Array.isArray(rawAttachments)) {
      for (let i = 0; i < rawAttachments.length; i++) {
        const item = rawAttachments[i];
        if (typeof item === "string" && item.trim()) {
          attachments.push(item.trim());
        } else {
          issues.push({
            field: `attachments[${i}]`,
            issue: "Attachment URL must be a non-empty string.",
          });
        }
      }
    } else if (typeof rawAttachment === "string" && rawAttachment.trim()) {
      attachments.push(rawAttachment.trim());
    } else {
      issues.push({
        field: "attachments",
        issue: "Attachments must be an array of string URLs.",
      });
    }

    if (attachments.length === 0) {
      issues.push({
        field: "attachments",
        issue: "At least one attachment (bill photo or receipt scan) is required.",
      });
    } else {
      result.attachments = attachments;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasFields) {
    throw HttpError.badRequest(
      "At least one editable field (notes, payee, attachments) must be provided.",
      "NO_FIELDS_TO_UPDATE",
    );
  }

  return result;
}

export interface VoidExpenseInput {
  reason: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/expenses/:id/void and POST /api/expenses/:id/void
 */
export function validateVoidExpenseInput(body: unknown): VoidExpenseInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw["reason"] !== "string" || !raw["reason"].trim()) {
    throw HttpError.badRequest("Void reason is required.", "MISSING_VOID_REASON");
  }
  const reason = raw["reason"].trim();
  if (reason.length < 3) {
    throw HttpError.badRequest(
      "Void reason must be at least 3 characters.",
      "INVALID_VOID_REASON",
    );
  }
  if (reason.length > 500) {
    throw HttpError.badRequest(
      "Void reason cannot exceed 500 characters.",
      "INVALID_VOID_REASON",
    );
  }
  return { reason };
}



