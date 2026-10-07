// =============================================================================
// report.validation.ts — Input Validation for Domain 10: Reports & Period Control
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";
import { ReportType, ExportFormat } from "../../../generated/prisma/client.js";

export interface ValidationIssue {
  field: string;
  issue: string;
}

export interface ReopenPeriodInput {
  reason: string;
}

export interface AccountReconciliationInput {
  realBalance: bigint;
  asOf?: Date;
  notes?: string;
  fundId?: string;
}

export interface BalancesReportQueryInput {
  asOf?: Date;
}

export interface IncomeExpenseReportQueryInput {
  startDate?: Date;
  endDate?: Date;
  groupBy?: "fund" | "category" | "month";
  fundId?: string;
}

export interface FundStatementQueryInput {
  startDate?: Date;
  endDate?: Date;
}

export interface AccountStatementQueryInput {
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface DonorsReportQueryInput {
  startDate?: Date;
  endDate?: Date;
  groupBy?: "member" | "family";
  status?: "top" | "lapsed" | "all";
  limit?: number;
}

export interface CreateReportExportInput {
  reportType: ReportType;
  format: ExportFormat;
  parameters?: Record<string, unknown>;
}

/**
 * Validates accounting period format: YYYY-MM (e.g. "2026-09")
 */
export function validatePeriodParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Period parameter is required.", "INVALID_PERIOD");
  }

  const trimmed = param.trim();
  const periodRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!periodRegex.test(trimmed)) {
    throw HttpError.badRequest(
      "Period must be formatted as YYYY-MM (e.g. 2026-09).",
      "INVALID_PERIOD_FORMAT",
    );
  }

  return trimmed;
}

/**
 * Validates POST /periods/:period/reopen body
 */
export function validateReopenPeriodInput(body: unknown): ReopenPeriodInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const reason = raw["reason"];

  if (typeof reason !== "string" || !reason.trim()) {
    throw HttpError.badRequest(
      "A valid non-empty reason is required to reopen a closed accounting period.",
      "REOPEN_REASON_REQUIRED",
    );
  }

  return { reason: reason.trim() };
}

/**
 * Validates POST /accounts/:accountId/reconciliations body
 */
export function validateAccountReconciliationInput(body: unknown): AccountReconciliationInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- realBalance (required, poisha integer)
  let realBalance: bigint | undefined;
  if (raw["realBalance"] === undefined || raw["realBalance"] === null || raw["realBalance"] === "") {
    issues.push({ field: "realBalance", issue: "realBalance (counted physical/statement amount in poisha) is required." });
  } else {
    try {
      const val = typeof raw["realBalance"] === "number"
        ? Math.round(raw["realBalance"]).toString()
        : String(raw["realBalance"]).trim();
      realBalance = BigInt(val);
    } catch {
      issues.push({ field: "realBalance", issue: "realBalance must be an integer poisha value (BigInt)." });
    }
  }

  // -- asOf (optional Date)
  let asOf: Date | undefined;
  if (raw["asOf"] !== undefined && raw["asOf"] !== null && raw["asOf"] !== "") {
    const parsed = new Date(String(raw["asOf"]));
    if (isNaN(parsed.getTime())) {
      issues.push({ field: "asOf", issue: "asOf must be a valid ISO-8601 date string." });
    } else {
      asOf = parsed;
    }
  }

  // -- notes (optional string)
  let notes: string | undefined;
  if (raw["notes"] !== undefined && raw["notes"] !== null) {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "notes must be a string." });
    } else {
      notes = raw["notes"].trim();
    }
  }

  // -- fundId (optional string)
  let fundId: string | undefined;
  if (raw["fundId"] !== undefined && raw["fundId"] !== null) {
    if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
      issues.push({ field: "fundId", issue: "fundId must be a valid string." });
    } else {
      fundId = raw["fundId"].trim();
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Validation failed.");
  }

  return {
    realBalance: realBalance!,
    asOf,
    notes,
    fundId,
  };
}

/**
 * Validates GET /reports/balances query
 */
export function validateBalancesReportQueryInput(query: unknown): BalancesReportQueryInput {
  if (!query || typeof query !== "object") {
    return {};
  }

  const raw = query as Record<string, unknown>;
  let asOf: Date | undefined;

  if (raw["asOf"] !== undefined && raw["asOf"] !== null && raw["asOf"] !== "") {
    const parsed = new Date(String(raw["asOf"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid asOf date parameter.", "INVALID_DATE");
    }
    asOf = parsed;
  }

  return { asOf };
}

/**
 * Validates GET /reports/income-expense query
 */
export function validateIncomeExpenseReportQueryInput(query: unknown): IncomeExpenseReportQueryInput {
  if (!query || typeof query !== "object") {
    return { groupBy: "month" };
  }

  const raw = query as Record<string, unknown>;
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let groupBy: "fund" | "category" | "month" = "month";
  let fundId: string | undefined;

  if (raw["startDate"]) {
    const parsed = new Date(String(raw["startDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid startDate parameter.", "INVALID_START_DATE");
    }
    startDate = parsed;
  }

  if (raw["endDate"]) {
    const parsed = new Date(String(raw["endDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid endDate parameter.", "INVALID_END_DATE");
    }
    endDate = parsed;
  }

  if (raw["groupBy"]) {
    const grp = String(raw["groupBy"]).toLowerCase().trim();
    if (grp === "fund" || grp === "category" || grp === "month") {
      groupBy = grp;
    } else {
      throw HttpError.badRequest("groupBy must be one of: fund, category, month.", "INVALID_GROUP_BY");
    }
  }

  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    fundId = raw["fundId"].trim();
  }

  return { startDate, endDate, groupBy, fundId };
}

/**
 * Validates GET /reports/funds/:fundId/statement query
 */
export function validateFundStatementQueryInput(query: unknown): FundStatementQueryInput {
  if (!query || typeof query !== "object") {
    return {};
  }

  const raw = query as Record<string, unknown>;
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (raw["startDate"]) {
    const parsed = new Date(String(raw["startDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid startDate parameter.", "INVALID_START_DATE");
    }
    startDate = parsed;
  }

  if (raw["endDate"]) {
    const parsed = new Date(String(raw["endDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid endDate parameter.", "INVALID_END_DATE");
    }
    endDate = parsed;
  }

  return { startDate, endDate };
}

/**
 * Validates GET /reports/accounts/:accountId/statement query
 */
export function validateAccountStatementQueryInput(query: unknown): AccountStatementQueryInput {
  if (!query || typeof query !== "object") {
    return { limit: 100, page: 1 };
  }

  const raw = query as Record<string, unknown>;
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let limit = 100;
  let page = 1;

  if (raw["startDate"]) {
    const parsed = new Date(String(raw["startDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid startDate parameter.", "INVALID_START_DATE");
    }
    startDate = parsed;
  }

  if (raw["endDate"]) {
    const parsed = new Date(String(raw["endDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid endDate parameter.", "INVALID_END_DATE");
    }
    endDate = parsed;
  }

  if (raw["limit"] !== undefined) {
    const parsed = parseInt(String(raw["limit"]), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 1000);
    }
  }

  if (raw["page"] !== undefined) {
    const parsed = parseInt(String(raw["page"]), 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  return { startDate, endDate, limit, page };
}

/**
 * Validates GET /reports/donors query
 */
export function validateDonorsReportQueryInput(query: unknown): DonorsReportQueryInput {
  if (!query || typeof query !== "object") {
    return { groupBy: "member", status: "all", limit: 50 };
  }

  const raw = query as Record<string, unknown>;
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let groupBy: "member" | "family" = "member";
  let status: "top" | "lapsed" | "all" = "all";
  let limit = 50;

  if (raw["startDate"]) {
    const parsed = new Date(String(raw["startDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid startDate parameter.", "INVALID_START_DATE");
    }
    startDate = parsed;
  }

  if (raw["endDate"]) {
    const parsed = new Date(String(raw["endDate"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid endDate parameter.", "INVALID_END_DATE");
    }
    endDate = parsed;
  }

  if (raw["groupBy"]) {
    const val = String(raw["groupBy"]).toLowerCase().trim();
    if (val === "member" || val === "family") {
      groupBy = val;
    }
  }

  if (raw["status"]) {
    const val = String(raw["status"]).toLowerCase().trim();
    if (val === "top" || val === "lapsed" || val === "all") {
      status = val;
    }
  }

  if (raw["limit"] !== undefined) {
    const parsed = parseInt(String(raw["limit"]), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 500);
    }
  }

  return { startDate, endDate, groupBy, status, limit };
}

/**
 * Validates fiscal year parameter (e.g. 2026)
 */
export function validateFiscalYearParam(param: unknown): number {
  if (param === undefined || param === null || param === "") {
    throw HttpError.badRequest("Fiscal year parameter is required.", "INVALID_YEAR");
  }

  const parsed = parseInt(String(param).trim(), 10);
  if (isNaN(parsed) || parsed < 2000 || parsed > 2100) {
    throw HttpError.badRequest(
      "Fiscal year must be a valid 4-digit year between 2000 and 2100.",
      "INVALID_FISCAL_YEAR",
    );
  }

  return parsed;
}

/**
 * Validates POST /reports/exports body
 */
export function validateCreateReportExportInput(body: unknown): CreateReportExportInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- reportType (required)
  let reportType: ReportType | undefined;
  if (!raw["reportType"] || typeof raw["reportType"] !== "string") {
    issues.push({ field: "reportType", issue: "reportType is required." });
  } else {
    const normalized = raw["reportType"].trim().toUpperCase().replace(/-/g, "_");
    if (Object.values(ReportType).includes(normalized as ReportType)) {
      reportType = normalized as ReportType;
    } else {
      issues.push({
        field: "reportType",
        issue: `reportType must be one of: ${Object.values(ReportType).join(", ")}.`,
      });
    }
  }

  // -- format (optional, default CSV)
  let format: ExportFormat = ExportFormat.CSV;
  if (raw["format"] !== undefined && raw["format"] !== null) {
    const normalized = String(raw["format"]).trim().toUpperCase();
    if (Object.values(ExportFormat).includes(normalized as ExportFormat)) {
      format = normalized as ExportFormat;
    } else {
      issues.push({
        field: "format",
        issue: `format must be one of: ${Object.values(ExportFormat).join(", ")}.`,
      });
    }
  }

  // -- parameters (optional object)
  let parameters: Record<string, unknown> | undefined;
  if (raw["parameters"] !== undefined && raw["parameters"] !== null) {
    if (typeof raw["parameters"] !== "object" || Array.isArray(raw["parameters"])) {
      issues.push({ field: "parameters", issue: "parameters must be an object if provided." });
    } else {
      parameters = raw["parameters"] as Record<string, unknown>;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Validation failed.");
  }

  return {
    reportType: reportType!,
    format,
    parameters,
  };
}

export function validateExportIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Export ID parameter must be a non-empty string.", "INVALID_EXPORT_ID");
  }
  return param.trim();
}
