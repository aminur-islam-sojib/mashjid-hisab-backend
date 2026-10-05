// ---------------------------------------------------------------------------
// Fund Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { FundType } from "../../../generated/prisma/client.js";

export interface CreateFundInput {
  name: string;
  type: FundType;
  isRestricted: boolean;
  description?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/funds
 *
 * Rules:
 * - name: required string, 2-100 chars after trimming
 * - type: optional, defaults to GENERAL, must be a valid FundType
 * - isRestricted: optional, defaults to false (or true for ZAKAT/WAQF if not explicitly provided)
 * - description: optional string, max 500 chars
 */
export function validateCreateFundInput(body: unknown): CreateFundInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name (required) -------------------------------------------------------
  let name = "";
  if (raw["name"] === undefined || raw["name"] === null || raw["name"] === "") {
    issues.push({ field: "name", issue: "Fund name is required." });
  } else if (typeof raw["name"] !== "string") {
    issues.push({ field: "name", issue: "Fund name must be a string." });
  } else {
    name = raw["name"].trim();
    if (name.length < 2) {
      issues.push({
        field: "name",
        issue: "Fund name must be at least 2 characters long.",
      });
    } else if (name.length > 100) {
      issues.push({
        field: "name",
        issue: "Fund name cannot exceed 100 characters.",
      });
    }
  }

  // -- type (optional, default GENERAL) --------------------------------------
  let type: FundType = FundType.GENERAL;
  if (raw["type"] !== undefined && raw["type"] !== null && raw["type"] !== "") {
    if (typeof raw["type"] !== "string") {
      issues.push({ field: "type", issue: "Fund type must be a string." });
    } else {
      const typeUpper = raw["type"].trim().toUpperCase();
      if (!Object.values(FundType).includes(typeUpper as FundType)) {
        issues.push({
          field: "type",
          issue: `Invalid fund type '${raw["type"]}'. Allowed types: ${Object.values(FundType).join(", ")}.`,
        });
      } else {
        type = typeUpper as FundType;
      }
    }
  }

  // -- isRestricted (optional) -----------------------------------------------
  let isRestricted = type === FundType.ZAKAT || type === FundType.WAQF;
  if (raw["isRestricted"] !== undefined && raw["isRestricted"] !== null) {
    if (typeof raw["isRestricted"] === "boolean") {
      isRestricted = raw["isRestricted"];
    } else if (raw["isRestricted"] === "true") {
      isRestricted = true;
    } else if (raw["isRestricted"] === "false") {
      isRestricted = false;
    } else {
      issues.push({
        field: "isRestricted",
        issue: "isRestricted must be a boolean (true or false).",
      });
    }
  }

  // -- description (optional) ------------------------------------------------
  let description: string | undefined;
  if (raw["description"] !== undefined && raw["description"] !== null) {
    if (typeof raw["description"] !== "string") {
      issues.push({
        field: "description",
        issue: "Description must be a string.",
      });
    } else {
      const trimmed = raw["description"].trim();
      if (trimmed.length > 500) {
        issues.push({
          field: "description",
          issue: "Description cannot exceed 500 characters.",
        });
      } else {
        description = trimmed || undefined;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    name,
    type,
    isRestricted,
    description,
  };
}

export interface GetMosqueFundsQuery {
  includeArchived?: boolean;
  type?: FundType;
  isRestricted?: boolean;
  search?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/funds
 */
export function validateGetMosqueFundsQuery(query: unknown): GetMosqueFundsQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueFundsQuery = {};

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
      throw HttpError.badRequest("Fund type filter must be a string.");
    }
    const typeUpper = raw["type"].trim().toUpperCase();
    if (!Object.values(FundType).includes(typeUpper as FundType)) {
      throw HttpError.badRequest(
        `Invalid fund type filter '${raw["type"]}'. Allowed types: ${Object.values(FundType).join(", ")}.`,
        "INVALID_FUND_TYPE",
      );
    }
    result.type = typeUpper as FundType;
  }

  // -- isRestricted (optional) -----------------------------------------------
  if (
    raw["isRestricted"] !== undefined &&
    raw["isRestricted"] !== null &&
    raw["isRestricted"] !== ""
  ) {
    if (
      raw["isRestricted"] === true ||
      raw["isRestricted"] === "true" ||
      raw["isRestricted"] === "1"
    ) {
      result.isRestricted = true;
    } else if (
      raw["isRestricted"] === false ||
      raw["isRestricted"] === "false" ||
      raw["isRestricted"] === "0"
    ) {
      result.isRestricted = false;
    } else {
      throw HttpError.badRequest(
        "Query parameter 'isRestricted' must be a boolean (true/false).",
        "INVALID_QUERY_PARAM",
      );
    }
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
