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

// ---------------------------------------------------------------------------
// Invitation Validation
// ---------------------------------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[0-9]{7,15}$/;

export interface CreateMembershipInviteInput {
  mosqueId: string;
  email?: string;
  phone?: string;
  role: Role;
}

/**
 * Validates payload for POST /api/memberships/invite
 *
 * Rules:
 * - mosqueId: required (from body or route parameter fallback)
 * - email / phone: at least one contact channel must be provided and valid
 * - role: optional, defaults to Role.MEMBER, must be in ALLOWED_MEMBERSHIP_ROLES
 */
export function validateCreateMembershipInviteInput(
  body: unknown,
  fallbackMosqueId?: string,
): CreateMembershipInviteInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- mosqueId --------------------------------------------------------------
  const rawMosqueId = raw["mosqueId"] ?? fallbackMosqueId;
  let mosqueId = "";
  if (typeof rawMosqueId !== "string" || !rawMosqueId.trim()) {
    issues.push({
      field: "mosqueId",
      issue: "Target mosque identifier (mosqueId) is required.",
    });
  } else {
    mosqueId = rawMosqueId.trim();
  }

  // -- email (optional) ------------------------------------------------------
  let email: string | undefined;
  if (raw["email"] !== undefined && raw["email"] !== null && raw["email"] !== "") {
    if (typeof raw["email"] !== "string") {
      issues.push({ field: "email", issue: "Email must be a valid string." });
    } else {
      const trimmedEmail = raw["email"].trim().toLowerCase();
      if (!EMAIL_RE.test(trimmedEmail)) {
        issues.push({ field: "email", issue: "Must be a valid email address." });
      } else {
        email = trimmedEmail;
      }
    }
  }

  // -- phone (optional) ------------------------------------------------------
  let phone: string | undefined;
  if (raw["phone"] !== undefined && raw["phone"] !== null && raw["phone"] !== "") {
    const rawPhone = String(raw["phone"]).trim();
    if (!PHONE_RE.test(rawPhone)) {
      issues.push({
        field: "phone",
        issue: "Must be a valid phone number (7–15 digits, optional leading +).",
      });
    } else {
      phone = rawPhone;
    }
  }

  // At least one contact method must be provided
  if (!email && !phone) {
    issues.push({
      field: "email",
      issue: "At least one contact method (email or phone) is required to invite a member.",
    });
  }

  // -- role (optional, defaults to MEMBER) -----------------------------------
  let role: Role = Role.MEMBER;
  if (raw["role"] !== undefined && raw["role"] !== null && raw["role"] !== "") {
    if (typeof raw["role"] !== "string") {
      issues.push({ field: "role", issue: "Role must be a string." });
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
        role = roleUpper as Role;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    mosqueId,
    email,
    phone,
    role,
  };
}

/**
 * Validates route parameter :id for invitations
 */
export function validateInviteIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest(
      "Invitation identifier is required.",
      "INVALID_INVITE_ID",
    );
  }
  return param.trim();
}

export interface AcceptMembershipInviteInput {
  token?: string;
}

/**
 * Validates payload for POST /api/memberships/invites/:id/accept
 */
export function validateAcceptMembershipInviteInput(
  body: unknown,
): AcceptMembershipInviteInput {
  if (!body || typeof body !== "object") {
    return {};
  }
  const raw = body as Record<string, unknown>;
  const input: AcceptMembershipInviteInput = {};

  if (raw["token"] !== undefined && raw["token"] !== null && raw["token"] !== "") {
    if (typeof raw["token"] !== "string" || !raw["token"].trim()) {
      throw HttpError.badRequest("Token must be a non-empty string.", "INVALID_TOKEN");
    }
    input.token = raw["token"].trim();
  }

  return input;
}

// ---------------------------------------------------------------------------
// Admin Direct-Create Member Validation
// ---------------------------------------------------------------------------

export interface DirectCreateMemberInput {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  role?: Role;
  familyMemberId?: string;
}

/**
 * Validates payload for POST /api/mosques/:mosqueId/members/direct
 *
 * Rules:
 * - familyMemberId: optional string.
 * - name: required if familyMemberId is omitted; optional if familyMemberId is provided (inherits family member's name).
 * - email: optional valid email address.
 * - phone: optional valid phone number (7-15 digits, optional leading +).
 * - contact: at least one of email, phone, or familyMemberId must be provided.
 * - password: optional string. If provided, must be >= 8 chars, 1 uppercase, 1 lowercase, 1 digit.
 *   If omitted, system will generate a secure temporary password.
 * - role: optional Role, defaults to Role.MEMBER, must be in ALLOWED_MEMBERSHIP_ROLES.
 */
export function validateDirectCreateMemberInput(
  body: unknown,
): DirectCreateMemberInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- familyMemberId (optional) ---------------------------------------------
  let familyMemberId: string | undefined;
  if (
    raw["familyMemberId"] !== undefined &&
    raw["familyMemberId"] !== null &&
    raw["familyMemberId"] !== ""
  ) {
    if (typeof raw["familyMemberId"] !== "string" || !raw["familyMemberId"].trim()) {
      issues.push({
        field: "familyMemberId",
        issue: "Family member identifier must be a non-empty string.",
      });
    } else {
      familyMemberId = raw["familyMemberId"].trim();
    }
  }

  // -- name ------------------------------------------------------------------
  let name: string | undefined;
  if (raw["name"] !== undefined && raw["name"] !== null && raw["name"] !== "") {
    if (typeof raw["name"] !== "string") {
      issues.push({ field: "name", issue: "Name must be a string." });
    } else {
      const trimmedName = raw["name"].trim();
      if (trimmedName.length < 2 || trimmedName.length > 100) {
        issues.push({
          field: "name",
          issue: "Name must be between 2 and 100 characters.",
        });
      } else {
        name = trimmedName;
      }
    }
  } else if (!familyMemberId) {
    issues.push({
      field: "name",
      issue: "Name is required when familyMemberId is not provided.",
    });
  }

  // -- email (optional) ------------------------------------------------------
  let email: string | undefined;
  if (raw["email"] !== undefined && raw["email"] !== null && raw["email"] !== "") {
    if (typeof raw["email"] !== "string") {
      issues.push({ field: "email", issue: "Email must be a valid string." });
    } else {
      const trimmedEmail = raw["email"].trim().toLowerCase();
      if (!EMAIL_RE.test(trimmedEmail)) {
        issues.push({ field: "email", issue: "Must be a valid email address." });
      } else {
        email = trimmedEmail;
      }
    }
  }

  // -- phone (optional) ------------------------------------------------------
  let phone: string | undefined;
  if (raw["phone"] !== undefined && raw["phone"] !== null && raw["phone"] !== "") {
    const rawPhone = String(raw["phone"]).trim();
    if (!PHONE_RE.test(rawPhone)) {
      issues.push({
        field: "phone",
        issue: "Must be a valid phone number (7–15 digits, optional leading +).",
      });
    } else {
      phone = rawPhone;
    }
  }

  // At least one contact method or a familyMemberId must be provided
  if (!email && !phone && !familyMemberId) {
    issues.push({
      field: "email",
      issue: "At least one contact method (email or phone) is required to create a member account.",
    });
  }

  // -- password (optional) ---------------------------------------------------
  let password: string | undefined;
  if (raw["password"] !== undefined && raw["password"] !== null && raw["password"] !== "") {
    if (typeof raw["password"] !== "string") {
      issues.push({ field: "password", issue: "Password must be a string." });
    } else {
      const rawPassword = raw["password"];
      if (rawPassword.length < 8) {
        issues.push({
          field: "password",
          issue: "Must be at least 8 characters.",
        });
      } else {
        if (!/[A-Z]/.test(rawPassword)) {
          issues.push({
            field: "password",
            issue: "Must contain at least one uppercase letter.",
          });
        }
        if (!/[a-z]/.test(rawPassword)) {
          issues.push({
            field: "password",
            issue: "Must contain at least one lowercase letter.",
          });
        }
        if (!/[0-9]/.test(rawPassword)) {
          issues.push({
            field: "password",
            issue: "Must contain at least one digit.",
          });
        }
      }
      password = rawPassword;
    }
  }

  // -- role (optional, defaults to MEMBER) -----------------------------------
  let role: Role = Role.MEMBER;
  if (raw["role"] !== undefined && raw["role"] !== null && raw["role"] !== "") {
    if (typeof raw["role"] !== "string") {
      issues.push({ field: "role", issue: "Role must be a string." });
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
        role = roleUpper as Role;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    name,
    email,
    phone,
    password,
    role,
    familyMemberId,
  };
}

