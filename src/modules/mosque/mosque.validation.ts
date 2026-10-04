// ---------------------------------------------------------------------------
// Mosque Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { isValidSlug } from "../../utils/slug.js";

export interface CreateMosqueInput {
  name: string;
  slug?: string;
  address?: string | null;
  timezone?: string;
  fiscalYearStart?: number;
}

export interface GetUserMosquesQuery {
  search?: string;
}

/**
 * Validates query parameters for GET /api/mosques
 */
export function validateGetUserMosquesQuery(query: unknown): GetUserMosquesQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetUserMosquesQuery = {};

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

/**
 * Validates route parameter :mosqueId
 */
export function validateMosqueIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Mosque identifier is required.", "INVALID_MOSQUE_ID");
  }
  return param.trim();
}

/**
 * Validates route parameter :slug for public mosque endpoints.
 */
export function validateMosqueSlugParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Mosque slug is required.", "INVALID_MOSQUE_SLUG");
  }
  const slug = param.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    throw HttpError.badRequest(
      "Slug must be 3-60 lowercase alphanumeric characters and hyphens (e.g. 'baitul-aman').",
      "INVALID_MOSQUE_SLUG",
    );
  }
  return slug;
}

/**
 * Validates IANA timezone strings using native V8 Intl support.
 */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates payload for POST /api/mosques
 * Collects all field validation issues to return a clear, comprehensive 422 error.
 */
export function validateCreateMosqueInput(body: unknown): CreateMosqueInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: CreateMosqueInput = {
    name: "",
  };

  // -- name (required) -------------------------------------------------------
  if (typeof raw["name"] !== "string" || !raw["name"].trim()) {
    issues.push({ field: "name", issue: "Mosque name is required." });
  } else {
    const trimmedName = raw["name"].trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      issues.push({
        field: "name",
        issue: "Mosque name must be between 2 and 100 characters.",
      });
    } else {
      input.name = trimmedName;
    }
  }

  // -- slug (optional) -------------------------------------------------------
  if (raw["slug"] !== undefined && raw["slug"] !== null && raw["slug"] !== "") {
    if (typeof raw["slug"] !== "string") {
      issues.push({ field: "slug", issue: "Slug must be a string." });
    } else {
      const trimmedSlug = raw["slug"].trim().toLowerCase();
      if (!isValidSlug(trimmedSlug)) {
        issues.push({
          field: "slug",
          issue:
            "Slug must be 3-60 lowercase alphanumeric characters and hyphens (e.g. 'baitul-aman').",
        });
      } else {
        input.slug = trimmedSlug;
      }
    }
  }

  // -- address (optional) ----------------------------------------------------
  if (raw["address"] !== undefined) {
    if (raw["address"] === null || raw["address"] === "") {
      input.address = null;
    } else if (typeof raw["address"] === "string") {
      const trimmedAddress = raw["address"].trim();
      if (trimmedAddress.length > 255) {
        issues.push({
          field: "address",
          issue: "Address cannot exceed 255 characters.",
        });
      } else {
        input.address = trimmedAddress;
      }
    } else {
      issues.push({ field: "address", issue: "Address must be a string or null." });
    }
  }

  // -- timezone (optional) ---------------------------------------------------
  if (raw["timezone"] !== undefined && raw["timezone"] !== null && raw["timezone"] !== "") {
    if (typeof raw["timezone"] !== "string") {
      issues.push({ field: "timezone", issue: "Timezone must be a string." });
    } else {
      const trimmedTz = raw["timezone"].trim();
      if (!isValidTimezone(trimmedTz)) {
        issues.push({
          field: "timezone",
          issue: `Invalid IANA timezone identifier: '${trimmedTz}' (e.g. 'Asia/Dhaka', 'UTC').`,
        });
      } else {
        input.timezone = trimmedTz;
      }
    }
  }

  // -- fiscalYearStart (optional, 1-12) --------------------------------------
  if (raw["fiscalYearStart"] !== undefined && raw["fiscalYearStart"] !== null) {
    const month = Number(raw["fiscalYearStart"]);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      issues.push({
        field: "fiscalYearStart",
        issue: "Fiscal year start must be an integer month number between 1 (January) and 12 (December).",
      });
    } else {
      input.fiscalYearStart = month;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return input;
}

export interface UpdateMosqueInput {
  name?: string;
  address?: string | null;
  timezone?: string;
  fiscalYearStart?: number;
  confirmFiscalYearChange?: boolean;
}

/**
 * Validates payload for PATCH /api/mosques/:mosqueId
 * Enforces partial updates and checks constraints for each provided field.
 */
export function validateUpdateMosqueInput(body: unknown): UpdateMosqueInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: UpdateMosqueInput = {};
  let hasUpdateFields = false;

  // -- name (optional) -------------------------------------------------------
  if (raw["name"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["name"] !== "string" || !raw["name"].trim()) {
      issues.push({ field: "name", issue: "Mosque name cannot be empty." });
    } else {
      const trimmedName = raw["name"].trim();
      if (trimmedName.length < 2 || trimmedName.length > 100) {
        issues.push({
          field: "name",
          issue: "Mosque name must be between 2 and 100 characters.",
        });
      } else {
        input.name = trimmedName;
      }
    }
  }

  // -- address (optional) ----------------------------------------------------
  if (raw["address"] !== undefined) {
    hasUpdateFields = true;
    if (raw["address"] === null || raw["address"] === "") {
      input.address = null;
    } else if (typeof raw["address"] === "string") {
      const trimmedAddress = raw["address"].trim();
      if (trimmedAddress.length > 255) {
        issues.push({
          field: "address",
          issue: "Address cannot exceed 255 characters.",
        });
      } else {
        input.address = trimmedAddress;
      }
    } else {
      issues.push({ field: "address", issue: "Address must be a string or null." });
    }
  }

  // -- timezone (optional) ---------------------------------------------------
  if (raw["timezone"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["timezone"] !== "string" || !raw["timezone"].trim()) {
      issues.push({ field: "timezone", issue: "Timezone cannot be empty." });
    } else {
      const trimmedTz = raw["timezone"].trim();
      if (!isValidTimezone(trimmedTz)) {
        issues.push({
          field: "timezone",
          issue: `Invalid IANA timezone identifier: '${trimmedTz}' (e.g. 'Asia/Dhaka', 'UTC').`,
        });
      } else {
        input.timezone = trimmedTz;
      }
    }
  }

  // -- fiscalYearStart (optional, 1-12) ---------------------------------------
  if (raw["fiscalYearStart"] !== undefined) {
    hasUpdateFields = true;
    const month = Number(raw["fiscalYearStart"]);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      issues.push({
        field: "fiscalYearStart",
        issue: "Fiscal year start must be an integer month number between 1 (January) and 12 (December).",
      });
    } else {
      input.fiscalYearStart = month;
    }
  }

  // -- confirmFiscalYearChange (optional boolean) ----------------------------
  if (raw["confirmFiscalYearChange"] !== undefined || raw["confirm"] !== undefined) {
    const confirmVal = raw["confirmFiscalYearChange"] ?? raw["confirm"];
    input.confirmFiscalYearChange = Boolean(confirmVal);
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasUpdateFields) {
    throw HttpError.badRequest(
      "At least one field must be provided to update (name, address, timezone, or fiscalYearStart).",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  return input;
}
