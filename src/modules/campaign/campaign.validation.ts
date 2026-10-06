// =============================================================================
// Campaign Module — Input Validation
//
// All validators follow the same convention as the rest of the codebase:
//  • Manual parse (no 3rd-party schema library) so error codes stay consistent.
//  • Collect all issues before throwing so the client gets one shot at fixing.
//  • HttpError.validationError() for field-level errors, HttpError.badRequest()
//    for structural / type errors.
// =============================================================================

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { CampaignStatus } from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Parses a BigInt from string | number | bigint. Returns undefined if the
 * value is absent, null-ish, or unparseable.  Pushes to issues[] on error.
 */
function parseBigIntField(
  raw: unknown,
  field: string,
  required: boolean,
  issues: ValidationIssue[],
): bigint | undefined {
  if (raw === undefined || raw === null || raw === "") {
    if (required) issues.push({ field, issue: `${field} is required.` });
    return undefined;
  }

  try {
    if (typeof raw === "bigint") {
      if (raw <= 0n) {
        issues.push({ field, issue: `${field} must be a positive integer in minor units (poisha).` });
        return undefined;
      }
      return raw;
    }

    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
        issues.push({ field, issue: `${field} must be a positive integer in minor units (poisha).` });
        return undefined;
      }
      return BigInt(raw);
    }

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!/^[0-9]+$/.test(trimmed)) {
        issues.push({ field, issue: `${field} must be a positive integer in minor units (poisha).` });
        return undefined;
      }
      const val = BigInt(trimmed);
      if (val <= 0n) {
        issues.push({ field, issue: `${field} must be a positive integer in minor units (poisha).` });
        return undefined;
      }
      return val;
    }
  } catch {
    // fall through
  }

  issues.push({ field, issue: `${field} must be a valid number or numeric string.` });
  return undefined;
}

/**
 * Parses an ISO-8601 date string / timestamp into a Date object.
 * Pushes to issues[] on error.
 */
function parseDateField(
  raw: unknown,
  field: string,
  required: boolean,
  issues: ValidationIssue[],
): Date | undefined {
  if (raw === undefined || raw === null || raw === "") {
    if (required) issues.push({ field, issue: `${field} is required.` });
    return undefined;
  }

  if (typeof raw === "string" || typeof raw === "number" || raw instanceof Date) {
    const d = new Date(raw as string | number | Date);
    if (isNaN(d.getTime())) {
      issues.push({ field, issue: `${field}: invalid date format. Expected a valid ISO-8601 date string.` });
      return undefined;
    }
    return d;
  }

  issues.push({ field, issue: `${field} must be a valid date string or timestamp.` });
  return undefined;
}

/**
 * Parses a non-empty trimmed string. Returns null when the caller explicitly
 * sends null/empty (allows clearing an optional field).
 */
function parseStringField(
  raw: unknown,
  field: string,
  { required = false, maxLen = 255 }: { required?: boolean; maxLen?: number } = {},
  issues: ValidationIssue[],
): string | null | undefined {
  if (raw === undefined) return undefined; // not supplied — caller omitted it

  if (raw === null || raw === "") return null; // explicit clear

  if (typeof raw !== "string") {
    issues.push({ field, issue: `${field} must be a string.` });
    return undefined;
  }

  const trimmed = raw.trim();
  if (required && !trimmed) {
    issues.push({ field, issue: `${field} is required and cannot be blank.` });
    return undefined;
  }

  if (trimmed.length > maxLen) {
    issues.push({ field, issue: `${field} cannot exceed ${maxLen} characters.` });
    return undefined;
  }

  return trimmed || null;
}

// ---------------------------------------------------------------------------
// 1.  Create Campaign
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  fundId: string;
  title: string;
  description?: string | null;
  targetAmount?: bigint | null;
  startDate: Date;
  endDate?: Date | null;
  isPublic: boolean;
  mosqueId?: string;
}

/**
 * Validates POST /api/mosques/:mosqueId/campaigns request body.
 *
 * Rules:
 *  - fundId:       required, non-empty string.
 *  - title:        required, 1–200 chars.
 *  - description:  optional, max 2 000 chars.
 *  - targetAmount: optional, strictly positive BigInt in minor units (poisha).
 *  - startDate:    required, valid ISO date.
 *  - endDate:      optional, valid ISO date. If provided, must be >= startDate.
 *  - isPublic:     optional boolean, defaults to true.
 *  - mosqueId:     optional (root-route body field).
 */
export function validateCreateCampaignInput(body: unknown): CreateCampaignInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- fundId (required) -----------------------------------------------------
  let fundId = "";
  if (!raw["fundId"] || typeof raw["fundId"] !== "string" || !String(raw["fundId"]).trim()) {
    issues.push({ field: "fundId", issue: "Fund ID is required and must be a non-empty string." });
  } else {
    fundId = String(raw["fundId"]).trim();
  }

  // -- title (required, 1–200 chars) ----------------------------------------
  let title = "";
  const rawTitle = raw["title"];
  if (!rawTitle || typeof rawTitle !== "string" || !String(rawTitle).trim()) {
    issues.push({ field: "title", issue: "Campaign title is required." });
  } else {
    const t = String(rawTitle).trim();
    if (t.length > 200) {
      issues.push({ field: "title", issue: "Campaign title cannot exceed 200 characters." });
    } else {
      title = t;
    }
  }

  // -- description (optional, max 2 000 chars) --------------------------------
  const description = parseStringField(raw["description"], "description", { maxLen: 2000 }, issues);

  // -- targetAmount (optional, strictly positive BigInt) ---------------------
  const targetAmount = raw["targetAmount"] !== undefined && raw["targetAmount"] !== null
    ? parseBigIntField(raw["targetAmount"], "targetAmount", false, issues)
    : undefined;

  // -- startDate (required) --------------------------------------------------
  const startDate = parseDateField(raw["startDate"], "startDate", true, issues);

  // -- endDate (optional) ----------------------------------------------------
  const endDate = raw["endDate"] !== undefined
    ? parseDateField(raw["endDate"], "endDate", false, issues)
    : undefined;

  // -- isPublic (optional, default true) ------------------------------------
  let isPublic = true;
  if (raw["isPublic"] !== undefined && raw["isPublic"] !== null) {
    if (typeof raw["isPublic"] === "boolean") {
      isPublic = raw["isPublic"];
    } else if (raw["isPublic"] === "true") {
      isPublic = true;
    } else if (raw["isPublic"] === "false") {
      isPublic = false;
    } else {
      issues.push({ field: "isPublic", issue: "isPublic must be a boolean." });
    }
  }

  // -- mosqueId (optional, root-route body field) ----------------------------
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null && raw["mosqueId"] !== "") {
    if (typeof raw["mosqueId"] !== "string" || !String(raw["mosqueId"]).trim()) {
      issues.push({ field: "mosqueId", issue: "Mosque ID must be a non-empty string." });
    } else {
      mosqueId = String(raw["mosqueId"]).trim();
    }
  }

  if (issues.length > 0) throw HttpError.validationError(issues);

  // Cross-field validation (only after individual fields are clean)
  if (startDate && endDate && endDate < startDate) {
    throw HttpError.badRequest(
      "endDate must be on or after startDate.",
      "INVALID_DATE_RANGE",
    );
  }

  return {
    fundId,
    title,
    description: description ?? null,
    targetAmount: targetAmount ?? null,
    startDate: startDate!,
    endDate: endDate ?? null,
    isPublic,
    mosqueId,
  };
}

// ---------------------------------------------------------------------------
// 2.  Update Campaign (PATCH)
// ---------------------------------------------------------------------------

export interface UpdateCampaignInput {
  title?: string;
  description?: string | null;
  targetAmount?: bigint | null;
  startDate?: Date;
  endDate?: Date | null;
  isPublic?: boolean;
  // fundId is intentionally excluded — changing it is blocked at service layer
  // if donations already exist.
  fundId?: string;
}

const IMMUTABLE_CLOSED_CAMPAIGN_FIELDS = ["status", "closedAt"] as const;

/**
 * Validates PATCH /api/mosques/:mosqueId/campaigns/:campaignId request body.
 *
 * Rules:
 *  - At least one field must be provided.
 *  - status and closedAt are read-only; send them and get a 400.
 *  - All provided fields follow the same rules as create.
 *  - fundId CAN be sent (the service layer checks for linked donations and
 *    blocks if any are present with error CAMPAIGN_FUND_LOCKED).
 */
export function validateUpdateCampaignInput(body: unknown): UpdateCampaignInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  // Reject attempts to directly set read-only lifecycle fields
  for (const field of IMMUTABLE_CLOSED_CAMPAIGN_FIELDS) {
    if (raw[field] !== undefined) {
      throw HttpError.badRequest(
        `'${field}' is a read-only lifecycle field and cannot be set directly. Use POST /campaigns/:id/close to close a campaign.`,
        "CAMPAIGN_FIELD_IMMUTABLE",
      );
    }
  }

  const issues: ValidationIssue[] = [];
  const result: UpdateCampaignInput = {};
  let hasFields = false;

  // -- title (optional) -------------------------------------------------------
  if (raw["title"] !== undefined) {
    hasFields = true;
    if (!raw["title"] || typeof raw["title"] !== "string" || !String(raw["title"]).trim()) {
      issues.push({ field: "title", issue: "Campaign title must be a non-empty string." });
    } else {
      const t = String(raw["title"]).trim();
      if (t.length > 200) {
        issues.push({ field: "title", issue: "Campaign title cannot exceed 200 characters." });
      } else {
        result.title = t;
      }
    }
  }

  // -- description (optional) ------------------------------------------------
  if (raw["description"] !== undefined) {
    hasFields = true;
    const d = parseStringField(raw["description"], "description", { maxLen: 2000 }, issues);
    if (d !== undefined) result.description = d;
  }

  // -- targetAmount (optional) -----------------------------------------------
  if (raw["targetAmount"] !== undefined) {
    hasFields = true;
    if (raw["targetAmount"] === null) {
      result.targetAmount = null;
    } else {
      const ta = parseBigIntField(raw["targetAmount"], "targetAmount", false, issues);
      if (ta !== undefined) result.targetAmount = ta;
    }
  }

  // -- startDate (optional) --------------------------------------------------
  if (raw["startDate"] !== undefined) {
    hasFields = true;
    const sd = parseDateField(raw["startDate"], "startDate", false, issues);
    if (sd !== undefined) result.startDate = sd;
  }

  // -- endDate (optional) ----------------------------------------------------
  if (raw["endDate"] !== undefined) {
    hasFields = true;
    if (raw["endDate"] === null) {
      result.endDate = null;
    } else {
      const ed = parseDateField(raw["endDate"], "endDate", false, issues);
      if (ed !== undefined) result.endDate = ed;
    }
  }

  // -- isPublic (optional) ---------------------------------------------------
  if (raw["isPublic"] !== undefined && raw["isPublic"] !== null) {
    hasFields = true;
    if (typeof raw["isPublic"] === "boolean") {
      result.isPublic = raw["isPublic"];
    } else if (raw["isPublic"] === "true") {
      result.isPublic = true;
    } else if (raw["isPublic"] === "false") {
      result.isPublic = false;
    } else {
      issues.push({ field: "isPublic", issue: "isPublic must be a boolean." });
    }
  }

  // -- fundId (optional; service layer enforces the CAMPAIGN_FUND_LOCKED guard)
  if (raw["fundId"] !== undefined && raw["fundId"] !== null && raw["fundId"] !== "") {
    hasFields = true;
    if (typeof raw["fundId"] !== "string" || !String(raw["fundId"]).trim()) {
      issues.push({ field: "fundId", issue: "Fund ID must be a non-empty string." });
    } else {
      result.fundId = String(raw["fundId"]).trim();
    }
  }

  if (issues.length > 0) throw HttpError.validationError(issues);

  if (!hasFields) {
    throw HttpError.badRequest(
      "At least one field must be provided to update (title, description, targetAmount, startDate, endDate, isPublic, fundId).",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  // Cross-field date validation (can only do this after both are parsed)
  if (result.startDate && result.endDate && result.endDate < result.startDate) {
    throw HttpError.badRequest("endDate must be on or after startDate.", "INVALID_DATE_RANGE");
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3.  Close Campaign
// ---------------------------------------------------------------------------

export interface CloseCampaignInput {
  reason?: string | null;
}

/**
 * Validates POST /api/mosques/:mosqueId/campaigns/:id/close request body.
 *
 * Rules:
 *  - reason: optional string, max 500 chars.
 */
export function validateCloseCampaignInput(body: unknown): CloseCampaignInput {
  if (!body || typeof body !== "object") {
    // Close can be called with an empty or absent body — that is fine.
    return { reason: null };
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let reason: string | null = null;
  if (raw["reason"] !== undefined && raw["reason"] !== null && raw["reason"] !== "") {
    if (typeof raw["reason"] !== "string") {
      issues.push({ field: "reason", issue: "reason must be a string." });
    } else {
      const r = raw["reason"].trim();
      if (r.length > 500) {
        issues.push({ field: "reason", issue: "reason cannot exceed 500 characters." });
      } else {
        reason = r || null;
      }
    }
  }

  if (issues.length > 0) throw HttpError.validationError(issues);

  return { reason };
}

// ---------------------------------------------------------------------------
// 4.  Query / List Campaigns
// ---------------------------------------------------------------------------

export interface GetCampaignsQueryInput {
  status?: CampaignStatus;
  fundId?: string;
  isPublic?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/campaigns.
 */
export function validateGetCampaignsQuery(query: unknown): GetCampaignsQueryInput {
  if (!query || typeof query !== "object") return {};

  const raw = query as Record<string, unknown>;
  const result: GetCampaignsQueryInput = {};

  // -- status filter
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("status filter must be a string.");
    }
    const su = raw["status"].trim().toUpperCase();
    if (!Object.values(CampaignStatus).includes(su as CampaignStatus)) {
      throw HttpError.badRequest(
        `Invalid campaign status '${raw["status"]}'. Allowed: ${Object.values(CampaignStatus).join(", ")}.`,
        "INVALID_STATUS",
      );
    }
    result.status = su as CampaignStatus;
  }

  // -- fundId filter
  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    result.fundId = raw["fundId"].trim();
  }

  // -- isPublic filter
  if (raw["isPublic"] !== undefined && raw["isPublic"] !== null) {
    if (raw["isPublic"] === "true" || raw["isPublic"] === true) {
      result.isPublic = true;
    } else if (raw["isPublic"] === "false" || raw["isPublic"] === false) {
      result.isPublic = false;
    }
  }

  // -- search (text search on title / description)
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    result.search = raw["search"].trim();
  }

  // -- pagination
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

// ---------------------------------------------------------------------------
// 5.  Route parameter validators
// ---------------------------------------------------------------------------

/**
 * Validates route parameter :campaignId
 */
export function validateCampaignIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Campaign identifier is required.", "INVALID_CAMPAIGN_ID");
  }
  return param.trim();
}

