// ---------------------------------------------------------------------------
// Invite Link Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { Role } from "../../../generated/prisma/client.js";

export interface CreateInviteLinkInput {
  role?: Role;
  maxUses?: number | null;
  expiresAt?: Date | null;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/invite-links
 *
 * Rules:
 * - role: optional Role, defaults to Role.MEMBER. Cannot be SUPER_ADMIN.
 * - maxUses: optional positive integer (>= 1) or null for unlimited uses.
 * - expiresAt: optional future date (must be > Date.now()) or null for no expiry.
 */
export function validateCreateInviteLinkInput(body: unknown): CreateInviteLinkInput {
  if (!body || typeof body !== "object") {
    return { role: Role.MEMBER, maxUses: null, expiresAt: null };
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: CreateInviteLinkInput = { role: Role.MEMBER, maxUses: null, expiresAt: null };

  // -- role (optional, defaults to MEMBER) ------------------------------------
  if (raw["role"] !== undefined && raw["role"] !== null && raw["role"] !== "") {
    if (typeof raw["role"] !== "string") {
      issues.push({ field: "role", issue: "Role must be a string." });
    } else {
      const roleUpper = raw["role"].trim().toUpperCase();
      if (roleUpper === Role.SUPER_ADMIN) {
        issues.push({
          field: "role",
          issue: "SUPER_ADMIN is a platform-level role and cannot be assigned to a mosque invite link.",
        });
      } else if (!Object.values(Role).includes(roleUpper as Role)) {
        issues.push({
          field: "role",
          issue: `Invalid role '${raw["role"]}'. Allowed: ${Object.values(Role).filter((r) => r !== Role.SUPER_ADMIN).join(", ")}.`,
        });
      } else {
        input.role = roleUpper as Role;
      }
    }
  }

  // -- maxUses (optional, positive integer) -----------------------------------
  if (raw["maxUses"] !== undefined && raw["maxUses"] !== null && raw["maxUses"] !== "") {
    const num = Number(raw["maxUses"]);
    if (!Number.isInteger(num) || num < 1) {
      issues.push({
        field: "maxUses",
        issue: "maxUses must be an integer greater than or equal to 1.",
      });
    } else if (num > 1_000_000) {
      issues.push({
        field: "maxUses",
        issue: "maxUses cannot exceed 1,000,000.",
      });
    } else {
      input.maxUses = num;
    }
  }

  // -- expiresAt (optional, future date) --------------------------------------
  if (raw["expiresAt"] !== undefined && raw["expiresAt"] !== null && raw["expiresAt"] !== "") {
    if (typeof raw["expiresAt"] !== "string" && !(raw["expiresAt"] instanceof Date)) {
      issues.push({
        field: "expiresAt",
        issue: "expiresAt must be a valid date string (e.g. ISO 8601).",
      });
    } else {
      const parsed = new Date(raw["expiresAt"] as string);
      if (Number.isNaN(parsed.getTime())) {
        issues.push({
          field: "expiresAt",
          issue: "expiresAt must be a valid date.",
        });
      } else if (parsed.getTime() <= Date.now()) {
        issues.push({
          field: "expiresAt",
          issue: "expiresAt must be a future date and time.",
        });
      } else {
        input.expiresAt = parsed;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return input;
}

export function validateInviteLinkIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Invite link identifier is required.", "INVALID_INVITE_LINK_ID");
  }
  return param.trim();
}

/**
 * Validates route parameter :token for public invite link endpoint.
 * Generic 404 error if missing or invalid string to maintain existence-hiding posture.
 */
export function validateInviteTokenParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.notFound("Invite link not found or has expired.", "INVITE_LINK_NOT_FOUND");
  }
  return param.trim();
}

export interface GetMosqueInviteLinksQuery {
  role?: Role;
  includeArchived?: boolean;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/invite-links
 *
 * Supported filters:
 * - ?role= (e.g. MEMBER, STAFF, TREASURER, etc.)
 * - ?includeArchived= (true/false)
 */
export function validateGetMosqueInviteLinksQuery(
  query: unknown,
): GetMosqueInviteLinksQuery {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueInviteLinksQuery = {};

  if (raw["role"] !== undefined && raw["role"] !== null && raw["role"] !== "") {
    if (typeof raw["role"] !== "string") {
      throw HttpError.badRequest("Role filter must be a string.", "INVALID_ROLE_FILTER");
    }
    const roleUpper = raw["role"].trim().toUpperCase();
    if (!Object.values(Role).includes(roleUpper as Role)) {
      throw HttpError.badRequest(
        `Invalid role filter '${raw["role"]}'. Allowed: ${Object.values(Role).join(", ")}.`,
        "INVALID_ROLE_FILTER",
      );
    }
    result.role = roleUpper as Role;
  }

  if (raw["includeArchived"] !== undefined) {
    result.includeArchived =
      raw["includeArchived"] === true ||
      raw["includeArchived"] === "true" ||
      raw["includeArchived"] === "1";
  }

  return result;
}


