// =============================================================================
// me.validation.ts — Validation for Domain 9: Member Self-Service
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";
import { DueStatus, PledgeStatus } from "../../../generated/prisma/client.js";

export interface ValidationIssue {
  field: string;
  issue: string;
}

export type SelfServiceScope = "self" | "family";

export interface GetMyDonationsQueryInput {
  scope: SelfServiceScope;
  page?: number;
  limit?: number;
  year?: number;
  fundId?: string;
}

export interface GetMyDuesQueryInput {
  scope?: "self" | "family" | "all";
  status?: DueStatus;
  period?: string;
  page?: number;
  limit?: number;
}

export interface GetMyPledgesQueryInput {
  scope?: SelfServiceScope;
  status?: PledgeStatus;
  page?: number;
  limit?: number;
}

export interface GetMyStatementQueryInput {
  year: number;
  scope: SelfServiceScope;
}

/**
 * Validates GET /me/donations query
 */
export function validateGetMyDonationsQuery(query: unknown): GetMyDonationsQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // scope: "self" | "family" (default: "self")
  let scope: SelfServiceScope = "self";
  if (raw["scope"] !== undefined && raw["scope"] !== null && raw["scope"] !== "") {
    const s = String(raw["scope"]).toLowerCase();
    if (s === "self" || s === "family") {
      scope = s as SelfServiceScope;
    } else {
      issues.push({ field: "scope", issue: "Scope must be either 'self' or 'family'." });
    }
  }

  // page: positive integer
  let page: number | undefined;
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      issues.push({ field: "page", issue: "Page must be a positive integer >= 1." });
    } else {
      page = p;
    }
  }

  // limit: integer 1..100
  let limit: number | undefined;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      issues.push({ field: "limit", issue: "Limit must be an integer between 1 and 100." });
    } else {
      limit = l;
    }
  }

  // year: 4-digit year
  let year: number | undefined;
  if (raw["year"] !== undefined && raw["year"] !== null && raw["year"] !== "") {
    const y = Number(raw["year"]);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      issues.push({ field: "year", issue: "Year must be a valid 4-digit calendar year (e.g. 2026)." });
    } else {
      year = y;
    }
  }

  // fundId: optional string
  let fundId: string | undefined;
  if (typeof raw["fundId"] === "string" && raw["fundId"].trim()) {
    fundId = raw["fundId"].trim();
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    scope,
    page,
    limit,
    year,
    fundId,
  };
}

/**
 * Validates GET /me/dues query
 */
export function validateGetMyDuesQuery(query: unknown): GetMyDuesQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let scope: "self" | "family" | "all" | undefined;
  if (raw["scope"] !== undefined && raw["scope"] !== null && raw["scope"] !== "") {
    const s = String(raw["scope"]).toLowerCase();
    if (s === "self" || s === "family" || s === "all") {
      scope = s as "self" | "family" | "all";
    } else {
      issues.push({ field: "scope", issue: "Scope must be 'self', 'family', or 'all'." });
    }
  }

  let status: DueStatus | undefined;
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    const s = String(raw["status"]).toUpperCase();
    if (Object.values(DueStatus).includes(s as DueStatus)) {
      status = s as DueStatus;
    } else {
      issues.push({
        field: "status",
        issue: `Invalid status. Must be one of: ${Object.values(DueStatus).join(", ")}.`,
      });
    }
  }

  let period: string | undefined;
  if (raw["period"] !== undefined && raw["period"] !== null && raw["period"] !== "") {
    const p = String(raw["period"]).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) {
      issues.push({ field: "period", issue: "Period must be in YYYY-MM format (e.g. 2026-05)." });
    } else {
      period = p;
    }
  }

  let page: number | undefined;
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      issues.push({ field: "page", issue: "Page must be a positive integer >= 1." });
    } else {
      page = p;
    }
  }

  let limit: number | undefined;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      issues.push({ field: "limit", issue: "Limit must be an integer between 1 and 100." });
    } else {
      limit = l;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    scope,
    status,
    period,
    page,
    limit,
  };
}

/**
 * Validates GET /me/pledges query
 */
export function validateGetMyPledgesQuery(query: unknown): GetMyPledgesQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let scope: SelfServiceScope = "self";
  if (raw["scope"] !== undefined && raw["scope"] !== null && raw["scope"] !== "") {
    const s = String(raw["scope"]).toLowerCase();
    if (s === "self" || s === "family") {
      scope = s as SelfServiceScope;
    } else {
      issues.push({ field: "scope", issue: "Scope must be either 'self' or 'family'." });
    }
  }

  let status: PledgeStatus | undefined;
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    const s = String(raw["status"]).toUpperCase();
    if (Object.values(PledgeStatus).includes(s as PledgeStatus)) {
      status = s as PledgeStatus;
    } else {
      issues.push({
        field: "status",
        issue: `Invalid status. Must be one of: ${Object.values(PledgeStatus).join(", ")}.`,
      });
    }
  }

  let page: number | undefined;
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      issues.push({ field: "page", issue: "Page must be a positive integer >= 1." });
    } else {
      page = p;
    }
  }

  let limit: number | undefined;
  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      issues.push({ field: "limit", issue: "Limit must be an integer between 1 and 100." });
    } else {
      limit = l;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    scope,
    status,
    page,
    limit,
  };
}

/**
 * Validates GET /me/statement query
 */
export function validateGetMyStatementQuery(query: unknown): GetMyStatementQueryInput {
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let year = new Date().getFullYear();
  if (raw["year"] !== undefined && raw["year"] !== null && raw["year"] !== "") {
    const y = Number(raw["year"]);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      issues.push({ field: "year", issue: "Year must be a valid 4-digit calendar year (e.g. 2026)." });
    } else {
      year = y;
    }
  }

  let scope: SelfServiceScope = "self";
  if (raw["scope"] !== undefined && raw["scope"] !== null && raw["scope"] !== "") {
    const s = String(raw["scope"]).toLowerCase();
    if (s === "self" || s === "family") {
      scope = s as SelfServiceScope;
    } else {
      issues.push({ field: "scope", issue: "Scope must be either 'self' or 'family'." });
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    year,
    scope,
  };
}

