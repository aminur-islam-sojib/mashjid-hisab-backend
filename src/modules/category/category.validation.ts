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
