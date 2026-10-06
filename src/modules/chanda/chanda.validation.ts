// =============================================================================
// chanda.validation.ts — Input Validation for Domain 7: Chanda Plans & Dues
// =============================================================================

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import {
  ChandaFrequency,
  ChandaPlanStatus,
  DueStatus,
  DonationSource,
} from "../../../generated/prisma/client.js";

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CreateChandaPlanInput {
  amount: bigint;
  fundId: string;
  frequency: ChandaFrequency;
  startMonth: string;
  familyId?: string | null;
  memberId?: string | null;
  mosqueId?: string;
}

export function validateCreateChandaPlanInput(body: unknown): CreateChandaPlanInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units)
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Chanda amount is required." });
  } else {
    try {
      const rawAmount = raw["amount"];
      if (typeof rawAmount === "bigint") {
        if (rawAmount <= 0n) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = rawAmount;
        }
      } else if (typeof rawAmount === "number") {
        if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = BigInt(rawAmount);
        }
      } else if (typeof rawAmount === "string") {
        const trimmed = rawAmount.trim();
        if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = BigInt(trimmed);
        }
      } else {
        issues.push({ field: "amount", issue: "Amount must be a valid number or numeric string." });
      }
    } catch {
      issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
    }
  }

  // -- fundId (required)
  let fundId = "";
  if (!raw["fundId"] || typeof raw["fundId"] !== "string" || !String(raw["fundId"]).trim()) {
    issues.push({ field: "fundId", issue: "Fund ID is required." });
  } else {
    fundId = String(raw["fundId"]).trim();
  }

  // -- frequency (MONTHLY | YEARLY, default MONTHLY)
  let frequency: ChandaFrequency = ChandaFrequency.MONTHLY;
  if (raw["frequency"] !== undefined && raw["frequency"] !== null && raw["frequency"] !== "") {
    if (typeof raw["frequency"] !== "string") {
      issues.push({ field: "frequency", issue: "Frequency must be a string." });
    } else {
      const freqUpper = raw["frequency"].trim().toUpperCase();
      if (!Object.values(ChandaFrequency).includes(freqUpper as ChandaFrequency)) {
        issues.push({
          field: "frequency",
          issue: `Invalid frequency '${raw["frequency"]}'. Allowed: ${Object.values(ChandaFrequency).join(", ")}.`,
        });
      } else {
        frequency = freqUpper as ChandaFrequency;
      }
    }
  }

  // -- startMonth ("YYYY-MM", required)
  let startMonth = "";
  if (!raw["startMonth"] || typeof raw["startMonth"] !== "string" || !String(raw["startMonth"]).trim()) {
    issues.push({ field: "startMonth", issue: "Start month is required in 'YYYY-MM' format (e.g. '2026-07')." });
  } else {
    const sm = String(raw["startMonth"]).trim();
    if (!PERIOD_REGEX.test(sm)) {
      issues.push({ field: "startMonth", issue: "startMonth must match 'YYYY-MM' format (e.g. '2026-07')." });
    } else {
      startMonth = sm;
    }
  }

  // -- Payer: exactly one of familyId or memberId must be specified
  let familyId: string | null = null;
  if (raw["familyId"] !== undefined && raw["familyId"] !== null && raw["familyId"] !== "") {
    if (typeof raw["familyId"] !== "string" || !raw["familyId"].trim()) {
      issues.push({ field: "familyId", issue: "Family ID must be a non-empty string." });
    } else {
      familyId = raw["familyId"].trim();
    }
  }

  let memberId: string | null = null;
  if (raw["memberId"] !== undefined && raw["memberId"] !== null && raw["memberId"] !== "") {
    if (typeof raw["memberId"] !== "string" || !raw["memberId"].trim()) {
      issues.push({ field: "memberId", issue: "Member ID must be a non-empty string." });
    } else {
      memberId = raw["memberId"].trim();
    }
  }

  if (!familyId && !memberId) {
    issues.push({
      field: "payer",
      issue: "A plan must specify either a familyId or a memberId.",
    });
  }

  if (familyId && memberId) {
    issues.push({
      field: "payer",
      issue: "A plan cannot specify both familyId and memberId. Choose one payer.",
    });
  }

  // -- mosqueId (optional in body for root route)
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null && raw["mosqueId"] !== "") {
    if (typeof raw["mosqueId"] !== "string" || !raw["mosqueId"].trim()) {
      issues.push({ field: "mosqueId", issue: "Mosque ID must be a non-empty string." });
    } else {
      mosqueId = raw["mosqueId"].trim();
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    amount,
    fundId,
    frequency,
    startMonth,
    familyId,
    memberId,
    mosqueId,
  };
}

export interface GetChandaPlansQueryInput {
  familyId?: string;
  memberId?: string;
  fundId?: string;
  status?: ChandaPlanStatus;
  frequency?: ChandaFrequency;
  page?: number;
  limit?: number;
}

export function validateGetChandaPlansQuery(query: unknown): GetChandaPlansQueryInput {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetChandaPlansQueryInput = {};

  const famVal = raw["familyId"] ?? raw["family"];
  if (typeof famVal === "string" && famVal.trim()) {
    result.familyId = famVal.trim();
  }

  const memVal = raw["memberId"] ?? raw["member"];
  if (typeof memVal === "string" && memVal.trim()) {
    result.memberId = memVal.trim();
  }

  const fundVal = raw["fundId"] ?? raw["fund"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    result.fundId = fundVal.trim();
  }

  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("status filter must be a string.");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(ChandaPlanStatus).includes(statusUpper as ChandaPlanStatus)) {
      throw HttpError.badRequest(
        `Invalid status '${raw["status"]}'. Allowed: ${Object.values(ChandaPlanStatus).join(", ")}.`,
        "INVALID_STATUS",
      );
    }
    result.status = statusUpper as ChandaPlanStatus;
  }

  if (raw["frequency"] !== undefined && raw["frequency"] !== null && raw["frequency"] !== "") {
    if (typeof raw["frequency"] !== "string") {
      throw HttpError.badRequest("frequency filter must be a string.");
    }
    const freqUpper = raw["frequency"].trim().toUpperCase();
    if (!Object.values(ChandaFrequency).includes(freqUpper as ChandaFrequency)) {
      throw HttpError.badRequest(
        `Invalid frequency '${raw["frequency"]}'. Allowed: ${Object.values(ChandaFrequency).join(", ")}.`,
        "INVALID_FREQUENCY",
      );
    }
    result.frequency = freqUpper as ChandaFrequency;
  }

  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      throw HttpError.badRequest("page must be a positive integer.");
    }
    result.page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      throw HttpError.badRequest("limit must be a positive integer between 1 and 100.");
    }
    result.limit = l;
  }

  return result;
}

export interface UpdateChandaPlanInput {
  amount: bigint;
}

export function validateUpdateChandaPlanInput(body: unknown): UpdateChandaPlanInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;

  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    throw HttpError.badRequest("New plan amount is required.", "MISSING_AMOUNT");
  }

  try {
    const rawAmount = raw["amount"];
    let amount = 0n;
    if (typeof rawAmount === "bigint") {
      amount = rawAmount;
    } else if (typeof rawAmount === "number") {
      if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount)) {
        throw new Error();
      }
      amount = BigInt(rawAmount);
    } else if (typeof rawAmount === "string") {
      const trimmed = rawAmount.trim();
      if (!/^[0-9]+$/.test(trimmed)) throw new Error();
      amount = BigInt(trimmed);
    } else {
      throw new Error();
    }

    if (amount <= 0n) {
      throw new Error();
    }

    return { amount };
  } catch {
    throw HttpError.badRequest(
      "Amount must be a positive integer in minor units (poisha).",
      "INVALID_AMOUNT",
    );
  }
}

export interface GenerateDuesInput {
  period: string; // "YYYY-MM"
  mosqueId?: string;
}

export function validateGenerateDuesInput(body: unknown): GenerateDuesInput {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  let period = "";
  if (raw["period"] !== undefined && raw["period"] !== null && raw["period"] !== "") {
    if (typeof raw["period"] !== "string") {
      throw HttpError.badRequest("Period must be a string in 'YYYY-MM' format.", "INVALID_PERIOD");
    }
    const trimmed = raw["period"].trim();
    if (!PERIOD_REGEX.test(trimmed)) {
      throw HttpError.badRequest(
        "Period must match 'YYYY-MM' format (e.g. '2026-07').",
        "INVALID_PERIOD_FORMAT",
      );
    }
    period = trimmed;
  } else {
    // Default to current calendar month in YYYY-MM
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    period = `${year}-${month}`;
  }

  let mosqueId: string | undefined;
  if (raw["mosqueId"] && typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  return { period, mosqueId };
}

export interface GetDuesQueryInput {
  period?: string;
  status?: DueStatus;
  familyId?: string;
  memberId?: string;
  fundId?: string;
  planId?: string;
  page?: number;
  limit?: number;
}

export function validateGetDuesQuery(query: unknown): GetDuesQueryInput {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetDuesQueryInput = {};

  if (raw["period"] !== undefined && raw["period"] !== null && raw["period"] !== "") {
    if (typeof raw["period"] !== "string") {
      throw HttpError.badRequest("period filter must be a string.");
    }
    const trimmed = raw["period"].trim();
    if (!PERIOD_REGEX.test(trimmed)) {
      throw HttpError.badRequest("period filter must match 'YYYY-MM' format.", "INVALID_PERIOD");
    }
    result.period = trimmed;
  }

  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("status filter must be a string.");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(DueStatus).includes(statusUpper as DueStatus)) {
      throw HttpError.badRequest(
        `Invalid status '${raw["status"]}'. Allowed: ${Object.values(DueStatus).join(", ")}.`,
        "INVALID_STATUS",
      );
    }
    result.status = statusUpper as DueStatus;
  }

  const famVal = raw["familyId"] ?? raw["family"];
  if (typeof famVal === "string" && famVal.trim()) {
    result.familyId = famVal.trim();
  }

  const memVal = raw["memberId"] ?? raw["member"];
  if (typeof memVal === "string" && memVal.trim()) {
    result.memberId = memVal.trim();
  }

  const fundVal = raw["fundId"] ?? raw["fund"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    result.fundId = fundVal.trim();
  }

  if (typeof raw["planId"] === "string" && raw["planId"].trim()) {
    result.planId = raw["planId"].trim();
  }

  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      throw HttpError.badRequest("page must be a positive integer.");
    }
    result.page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      throw HttpError.badRequest("limit must be a positive integer between 1 and 100.");
    }
    result.limit = l;
  }

  return result;
}

export interface RecordDuePaymentInput {
  amount: bigint;
  accountId: string;
  categoryId: string;
  date?: Date;
  source?: DonationSource;
  notes?: string | null;
  attachments?: string[];
  mosqueId?: string;
}

export function validateRecordDuePaymentInput(body: unknown): RecordDuePaymentInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units)
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Payment amount is required." });
  } else {
    try {
      const rawAmount = raw["amount"];
      if (typeof rawAmount === "bigint") {
        if (rawAmount <= 0n) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = rawAmount;
        }
      } else if (typeof rawAmount === "number") {
        if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = BigInt(rawAmount);
        }
      } else if (typeof rawAmount === "string") {
        const trimmed = rawAmount.trim();
        if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
        } else {
          amount = BigInt(trimmed);
        }
      } else {
        issues.push({ field: "amount", issue: "Amount must be a valid number or numeric string." });
      }
    } catch {
      issues.push({ field: "amount", issue: "Amount must be a positive integer in minor units (poisha)." });
    }
  }

  // -- accountId (required)
  let accountId = "";
  if (!raw["accountId"] || typeof raw["accountId"] !== "string" || !String(raw["accountId"]).trim()) {
    issues.push({ field: "accountId", issue: "Account ID is required." });
  } else {
    accountId = String(raw["accountId"]).trim();
  }

  // -- categoryId (required)
  let categoryId = "";
  if (!raw["categoryId"] || typeof raw["categoryId"] !== "string" || !String(raw["categoryId"]).trim()) {
    issues.push({ field: "categoryId", issue: "Category ID is required." });
  } else {
    categoryId = String(raw["categoryId"]).trim();
  }

  // -- date (optional, defaults to current date)
  let date: Date | undefined;
  if (raw["date"] !== undefined && raw["date"] !== null && raw["date"] !== "") {
    const d = new Date(raw["date"] as string | number | Date);
    if (isNaN(d.getTime())) {
      issues.push({ field: "date", issue: "Invalid date format. Expected valid ISO-8601 string." });
    } else {
      date = d;
    }
  }

  // -- source (optional, default MEMBER)
  let source: DonationSource = DonationSource.MEMBER;
  if (raw["source"] !== undefined && raw["source"] !== null && raw["source"] !== "") {
    if (typeof raw["source"] !== "string") {
      issues.push({ field: "source", issue: "Source must be a string." });
    } else {
      const sourceUpper = raw["source"].trim().toUpperCase();
      if (!Object.values(DonationSource).includes(sourceUpper as DonationSource)) {
        issues.push({
          field: "source",
          issue: `Invalid donation source '${raw["source"]}'. Allowed sources: ${Object.values(DonationSource).join(", ")}.`,
        });
      } else {
        source = sourceUpper as DonationSource;
      }
    }
  }

  // -- notes
  let notes: string | null = null;
  if (raw["notes"] !== undefined && raw["notes"] !== null && raw["notes"] !== "") {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      const trimmedNotes = raw["notes"].trim();
      if (trimmedNotes.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        notes = trimmedNotes || null;
      }
    }
  }

  // -- attachments
  let attachments: string[] = [];
  if (raw["attachments"] !== undefined && raw["attachments"] !== null) {
    if (!Array.isArray(raw["attachments"])) {
      issues.push({ field: "attachments", issue: "Attachments must be an array of string URLs." });
    } else {
      for (let i = 0; i < raw["attachments"].length; i++) {
        const item = raw["attachments"][i];
        if (typeof item !== "string" || !item.trim()) {
          issues.push({ field: `attachments[${i}]`, issue: "Attachment item must be a non-empty string." });
        } else {
          attachments.push(item.trim());
        }
      }
    }
  }

  let mosqueId: string | undefined;
  if (raw["mosqueId"] && typeof raw["mosqueId"] === "string" && raw["mosqueId"].trim()) {
    mosqueId = raw["mosqueId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    amount,
    accountId,
    categoryId,
    date,
    source,
    notes,
    attachments,
    mosqueId,
  };
}

export interface WaiveDueInput {
  reason: string;
}

export function validateWaiveDueInput(body: unknown): WaiveDueInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw["reason"] !== "string" || !raw["reason"].trim()) {
    throw HttpError.badRequest("Waive reason is required.", "MISSING_WAIVE_REASON");
  }

  const reason = raw["reason"].trim();
  if (reason.length < 3) {
    throw HttpError.badRequest("Waive reason must be at least 3 characters.", "INVALID_WAIVE_REASON");
  }
  if (reason.length > 500) {
    throw HttpError.badRequest("Waive reason cannot exceed 500 characters.", "INVALID_WAIVE_REASON");
  }

  return { reason };
}

export interface GetDuesSummaryQueryInput {
  period: string; // "YYYY-MM"
  fundId?: string;
}

export function validateGetDuesSummaryQuery(query: unknown): GetDuesSummaryQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;

  let period = "";
  if (raw["period"] !== undefined && raw["period"] !== null && raw["period"] !== "") {
    if (typeof raw["period"] !== "string") {
      throw HttpError.badRequest("period filter must be a string.");
    }
    const trimmed = raw["period"].trim();
    if (!PERIOD_REGEX.test(trimmed)) {
      throw HttpError.badRequest("period filter must match 'YYYY-MM' format.", "INVALID_PERIOD");
    }
    period = trimmed;
  } else {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    period = `${year}-${month}`;
  }

  let fundId: string | undefined;
  const fundVal = raw["fundId"] ?? raw["fund"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    fundId = fundVal.trim();
  }

  return { period, fundId };
}

export function validatePlanIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Plan identifier is required.", "INVALID_PLAN_ID");
  }
  return param.trim();
}

export function validateDueIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Due identifier is required.", "INVALID_DUE_ID");
  }
  return param.trim();
}

