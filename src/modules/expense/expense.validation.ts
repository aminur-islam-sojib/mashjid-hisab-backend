// ---------------------------------------------------------------------------
// Expense Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";

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

