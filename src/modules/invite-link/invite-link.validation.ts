// ---------------------------------------------------------------------------
// Invite Link Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { Role } from "../../../generated/prisma/client.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

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

export interface JoinInviteLinkInput {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  locale?: string;
}

/**
 * Validates request payload for POST /api/public/invite-links/:token/join
 *
 * Rules:
 * - At least one contact method (email or phone) is required.
 * - email: optional valid email string.
 * - phone: optional valid phone string (7-15 digits, optional leading +).
 * - name: optional string (2-100 characters if supplied).
 * - password: optional string (at least 8 characters if supplied).
 * - locale: optional locale tag (e.g. "bn", "en").
 */
export function validateJoinInviteLinkInput(body: unknown): JoinInviteLinkInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: JoinInviteLinkInput = {};

  // -- email (optional) ------------------------------------------------------
  if (raw["email"] !== undefined && raw["email"] !== null && raw["email"] !== "") {
    if (typeof raw["email"] !== "string") {
      issues.push({ field: "email", issue: "Email must be a string." });
    } else {
      const email = raw["email"].trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        issues.push({ field: "email", issue: "Must be a valid email address." });
      } else {
        input.email = email;
      }
    }
  }

  // -- phone (optional) ------------------------------------------------------
  if (raw["phone"] !== undefined && raw["phone"] !== null && raw["phone"] !== "") {
    const rawPhone = String(raw["phone"]).trim();
    if (!PHONE_RE.test(rawPhone)) {
      issues.push({
        field: "phone",
        issue: "Must be a valid phone number (7–15 digits, optional leading +).",
      });
    } else {
      input.phone = rawPhone;
    }
  }

  // At least one contact method must be provided
  if (!input.email && !input.phone) {
    issues.push({
      field: "contact",
      issue: "At least one contact method (email or phone) is required to join.",
    });
  }

  // -- name (optional) -------------------------------------------------------
  if (raw["name"] !== undefined && raw["name"] !== null && raw["name"] !== "") {
    if (typeof raw["name"] !== "string") {
      issues.push({ field: "name", issue: "Name must be a string." });
    } else {
      const name = raw["name"].trim();
      if (name.length < 2 || name.length > 100) {
        issues.push({ field: "name", issue: "Name must be between 2 and 100 characters." });
      } else {
        input.name = name;
      }
    }
  }

  // -- password (optional) ---------------------------------------------------
  if (raw["password"] !== undefined && raw["password"] !== null && raw["password"] !== "") {
    if (typeof raw["password"] !== "string") {
      issues.push({ field: "password", issue: "Password must be a string." });
    } else {
      const password = raw["password"];
      if (password.length < 8) {
        issues.push({ field: "password", issue: "Must be at least 8 characters." });
      } else {
        input.password = password;
      }
    }
  }

  // -- locale (optional) -----------------------------------------------------
  if (raw["locale"] !== undefined && raw["locale"] !== null && raw["locale"] !== "") {
    input.locale = typeof raw["locale"] === "string" ? raw["locale"].trim() : "bn";
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return input;
}


