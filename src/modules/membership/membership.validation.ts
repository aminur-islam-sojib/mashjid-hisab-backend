// ---------------------------------------------------------------------------
// Membership Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { Role, MembershipStatus } from "../../../generated/prisma/client.js";

/**
 * Mosque-scoped membership roles.
 * Excludes platform-level SUPER_ADMIN.
 */
export const ALLOWED_MEMBERSHIP_ROLES: readonly Role[] = [
  Role.MOSQUE_ADMIN,
  Role.TREASURER,
  Role.COMMITTEE_MEMBER,
  Role.STAFF,
  Role.MEMBER,
] as const;

export interface GetMosqueMembersQuery {
  role?: Role;
  status?: MembershipStatus;
  search?: string;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/members
 */
export function validateGetMosqueMembersQuery(query: unknown): GetMosqueMembersQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueMembersQuery = {};

  if (raw["role"] !== undefined && raw["role"] !== null && raw["role"] !== "") {
    if (typeof raw["role"] !== "string") {
      throw HttpError.badRequest("Role filter must be a string.", "INVALID_ROLE");
    }
    const roleUpper = raw["role"].trim().toUpperCase();
    if (!Object.values(Role).includes(roleUpper as Role)) {
      throw HttpError.badRequest(
        `Invalid role '${raw["role"]}'. Allowed roles: ${Object.values(Role).join(", ")}.`,
        "INVALID_ROLE",
      );
    }
    result.role = roleUpper as Role;
  }

  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("Status filter must be a string.", "INVALID_STATUS");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(MembershipStatus).includes(statusUpper as MembershipStatus)) {
      throw HttpError.badRequest(
        `Invalid status '${raw["status"]}'. Allowed statuses: ${Object.values(MembershipStatus).join(", ")}.`,
        "INVALID_STATUS",
      );
    }
    result.status = statusUpper as MembershipStatus;
  }

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
 * Validates route parameter :membershipId
 */
export function validateMembershipIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest(
      "Membership identifier is required.",
      "INVALID_MEMBERSHIP_ID",
    );
  }
  return param.trim();
}

export interface UpdateMembershipInput {
  role?: Role;
  status?: MembershipStatus;
}

/**
 * Validates request payload for PATCH /api/mosques/:mosqueId/members/:membershipId
 *
 * Rules:
 * - At least one of `role` or `status` must be provided.
 * - `role`: Must be one of ALLOWED_MEMBERSHIP_ROLES (rejects platform SUPER_ADMIN).
 * - `status`: Must be a valid MembershipStatus.
 */
export function validateUpdateMembershipInput(body: unknown): UpdateMembershipInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: UpdateMembershipInput = {};
  let hasUpdateFields = false;

  // -- role (optional) -------------------------------------------------------
  if (raw["role"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["role"] !== "string" || !raw["role"].trim()) {
      issues.push({ field: "role", issue: "Role cannot be empty." });
    } else {
      const roleUpper = raw["role"].trim().toUpperCase();
      if (roleUpper === Role.SUPER_ADMIN) {
        issues.push({
          field: "role",
          issue: "SUPER_ADMIN is a platform-level role and cannot be assigned to a mosque membership.",
        });
      } else if (!ALLOWED_MEMBERSHIP_ROLES.includes(roleUpper as Role)) {
        issues.push({
          field: "role",
          issue: `Invalid role '${raw["role"]}'. Allowed membership roles: ${ALLOWED_MEMBERSHIP_ROLES.join(", ")}.`,
        });
      } else {
        input.role = roleUpper as Role;
      }
    }
  }

  // -- status (optional) -----------------------------------------------------
  if (raw["status"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["status"] !== "string" || !raw["status"].trim()) {
      issues.push({ field: "status", issue: "Status cannot be empty." });
    } else {
      const statusUpper = raw["status"].trim().toUpperCase();
      if (!Object.values(MembershipStatus).includes(statusUpper as MembershipStatus)) {
        issues.push({
          field: "status",
          issue: `Invalid status '${raw["status"]}'. Allowed statuses: ${Object.values(MembershipStatus).join(", ")}.`,
        });
      } else {
        input.status = statusUpper as MembershipStatus;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasUpdateFields) {
    throw HttpError.badRequest(
      "At least one field (role or status) must be provided to update membership.",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  return input;
}
