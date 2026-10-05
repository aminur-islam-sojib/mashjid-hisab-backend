// ---------------------------------------------------------------------------
// Category Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { CategoryType } from "../../../generated/prisma/client.js";

export interface CreateCategoryInput {
  name: string;
  type: CategoryType;
  fundId?: string | null;
}

/**
 * Validates route parameter :categoryId
 */
export function validateCategoryIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Category identifier is required.", "INVALID_CATEGORY_ID");
  }
  return param.trim();
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/categories
 *
 * Rules:
 * - name: required string, 2-100 characters after trimming
 * - type: required CategoryType (INCOME | EXPENSE)
 * - fundId: optional string (CUID of the fund) or null to allow use across any fund
 */
export function validateCreateCategoryInput(body: unknown): CreateCategoryInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name (required) -------------------------------------------------------
  let name = "";
  if (raw["name"] === undefined || raw["name"] === null || raw["name"] === "") {
    issues.push({ field: "name", issue: "Category name is required." });
  } else if (typeof raw["name"] !== "string") {
    issues.push({ field: "name", issue: "Category name must be a string." });
  } else {
    name = raw["name"].trim();
    if (name.length < 2) {
      issues.push({
        field: "name",
        issue: "Category name must be at least 2 characters long.",
      });
    } else if (name.length > 100) {
      issues.push({
        field: "name",
        issue: "Category name cannot exceed 100 characters.",
      });
    }
  }

  // -- type (required) -------------------------------------------------------
  let type: CategoryType = CategoryType.INCOME;
  if (raw["type"] === undefined || raw["type"] === null || raw["type"] === "") {
    issues.push({ field: "type", issue: "Category type is required." });
  } else if (typeof raw["type"] !== "string") {
    issues.push({ field: "type", issue: "Category type must be a string." });
  } else {
    const typeUpper = raw["type"].trim().toUpperCase();
    if (!Object.values(CategoryType).includes(typeUpper as CategoryType)) {
      issues.push({
        field: "type",
        issue: `Invalid category type '${raw["type"]}'. Allowed types: ${Object.values(CategoryType).join(", ")}.`,
      });
    } else {
      type = typeUpper as CategoryType;
    }
  }

  // -- fundId (optional) -----------------------------------------------------
  let fundId: string | null = null;
  if (raw["fundId"] !== undefined && raw["fundId"] !== null) {
    if (typeof raw["fundId"] !== "string") {
      issues.push({
        field: "fundId",
        issue: "Fund identifier must be a string.",
      });
    } else {
      const trimmedFundId = raw["fundId"].trim();
      fundId = trimmedFundId || null;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    name,
    type,
    fundId,
  };
}

export interface GetMosqueCategoriesQuery {
  includeArchived?: boolean;
  type?: CategoryType;
  fundId?: string | null;
  search?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/categories
 *
 * Rules:
 * - includeArchived: optional boolean (true/false)
 * - type: optional CategoryType (INCOME | EXPENSE)
 * - fundId: optional string (specific fund CUID or 'null'/'none'/'unrestricted')
 * - search: optional string (max 100 chars)
 */
export function validateGetMosqueCategoriesQuery(query: unknown): GetMosqueCategoriesQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueCategoriesQuery = {};

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
      throw HttpError.badRequest("Category type filter must be a string.");
    }
    const typeUpper = raw["type"].trim().toUpperCase();
    if (!Object.values(CategoryType).includes(typeUpper as CategoryType)) {
      throw HttpError.badRequest(
        `Invalid category type filter '${raw["type"]}'. Allowed types: ${Object.values(CategoryType).join(", ")}.`,
        "INVALID_CATEGORY_TYPE",
      );
    }
    result.type = typeUpper as CategoryType;
  }

  // -- fundId (optional) -----------------------------------------------------
  if (raw["fundId"] !== undefined && raw["fundId"] !== null && raw["fundId"] !== "") {
    if (typeof raw["fundId"] !== "string") {
      throw HttpError.badRequest("fundId filter must be a string.");
    }
    const trimmed = raw["fundId"].trim();
    if (
      trimmed.toLowerCase() === "null" ||
      trimmed.toLowerCase() === "none" ||
      trimmed.toLowerCase() === "unrestricted"
    ) {
      result.fundId = null;
    } else {
      result.fundId = trimmed;
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
