// ---------------------------------------------------------------------------
// Family Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { FamilyRelation } from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

export interface CreateFamilyInput {
  name: string;
  address?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/families
 *
 * Rules:
 * - name: required string, 2-100 chars after trimming
 * - address: optional string, max 200 chars
 */
export function validateCreateFamilyInput(body: unknown): CreateFamilyInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name (required) --------------------------------------------------------
  let name = "";
  if (raw["name"] === undefined || raw["name"] === null || raw["name"] === "") {
    issues.push({ field: "name", issue: "Family name is required." });
  } else if (typeof raw["name"] !== "string") {
    issues.push({ field: "name", issue: "Family name must be a string." });
  } else {
    name = raw["name"].trim();
    if (name.length < 2) {
      issues.push({
        field: "name",
        issue: "Family name must be at least 2 characters long.",
      });
    } else if (name.length > 100) {
      issues.push({
        field: "name",
        issue: "Family name cannot exceed 100 characters.",
      });
    }
  }

  // -- address (optional) ------------------------------------------------------
  let address: string | undefined;
  if (raw["address"] !== undefined && raw["address"] !== null) {
    if (typeof raw["address"] !== "string") {
      issues.push({ field: "address", issue: "Address must be a string." });
    } else {
      const trimmed = raw["address"].trim();
      if (trimmed.length > 200) {
        issues.push({
          field: "address",
          issue: "Address cannot exceed 200 characters.",
        });
      } else {
        address = trimmed || undefined;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return { name, address };
}

export interface UpdateFamilyInput {
  name?: string;
  address?: string | null;
}

/**
 * Validates request payload for PATCH /api/mosques/:mosqueId/families/:familyId
 *
 * Rules:
 * - At least one field must be provided.
 * - name: optional string, 2-100 chars.
 * - address: optional string (max 200 chars) or null to clear.
 */
export function validateUpdateFamilyInput(body: unknown): UpdateFamilyInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: UpdateFamilyInput = {};
  let hasUpdateFields = false;

  if (raw["name"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["name"] !== "string" || !raw["name"].trim()) {
      issues.push({ field: "name", issue: "Family name cannot be empty." });
    } else {
      const trimmed = raw["name"].trim();
      if (trimmed.length < 2) {
        issues.push({
          field: "name",
          issue: "Family name must be at least 2 characters long.",
        });
      } else if (trimmed.length > 100) {
        issues.push({
          field: "name",
          issue: "Family name cannot exceed 100 characters.",
        });
      } else {
        input.name = trimmed;
      }
    }
  }

  if (raw["address"] !== undefined) {
    hasUpdateFields = true;
    if (raw["address"] === null || raw["address"] === "") {
      input.address = null;
    } else if (typeof raw["address"] !== "string") {
      issues.push({ field: "address", issue: "Address must be a string or null." });
    } else {
      const trimmed = raw["address"].trim();
      if (trimmed.length > 200) {
        issues.push({
          field: "address",
          issue: "Address cannot exceed 200 characters.",
        });
      } else {
        input.address = trimmed || null;
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasUpdateFields) {
    throw HttpError.badRequest(
      "At least one field must be provided to update (name or address).",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  return input;
}

export function validateFamilyIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Family identifier is required.", "INVALID_FAMILY_ID");
  }
  return param.trim();
}

// ---------------------------------------------------------------------------
// Transfer head
// ---------------------------------------------------------------------------

export interface TransferFamilyHeadInput {
  newHeadMembershipId: string;
  confirm: boolean;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/families/:familyId/transfer-head
 *
 * Rules:
 * - newHeadMembershipId: required non-empty string.
 * - confirm: required boolean, must be explicitly true — headship transfer
 *   changes who logs in and manages this household, so it is never implicit.
 */
export function validateTransferFamilyHeadInput(body: unknown): TransferFamilyHeadInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  let newHeadMembershipId = "";
  if (
    raw["newHeadMembershipId"] === undefined ||
    raw["newHeadMembershipId"] === null ||
    typeof raw["newHeadMembershipId"] !== "string" ||
    !raw["newHeadMembershipId"].trim()
  ) {
    issues.push({
      field: "newHeadMembershipId",
      issue: "newHeadMembershipId is required.",
    });
  } else {
    newHeadMembershipId = raw["newHeadMembershipId"].trim();
  }

  const confirm = raw["confirm"] === true;
  if (!confirm) {
    issues.push({
      field: "confirm",
      issue: "Set confirm: true to transfer family headship to another member.",
    });
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return { newHeadMembershipId, confirm };
}

// ---------------------------------------------------------------------------
// FamilyMember
// ---------------------------------------------------------------------------

const MAX_FAMILY_MEMBER_STRING = 100;

export interface CreateFamilyMemberInput {
  name: string;
  relation: FamilyRelation;
  dateOfBirth?: Date;
  gender?: string;
  phone?: string;
  occupation?: string;
  bloodGroup?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/families/:familyId/members
 *
 * Rules:
 * - name: required string, 2-100 chars.
 * - relation: required, must be a valid FamilyRelation.
 * - dateOfBirth, gender, phone, occupation, bloodGroup: all optional.
 */
export function validateCreateFamilyMemberInput(body: unknown): CreateFamilyMemberInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name (required) ---------------------------------------------------------
  let name = "";
  if (raw["name"] === undefined || raw["name"] === null || raw["name"] === "") {
    issues.push({ field: "name", issue: "Member name is required." });
  } else if (typeof raw["name"] !== "string") {
    issues.push({ field: "name", issue: "Member name must be a string." });
  } else {
    name = raw["name"].trim();
    if (name.length < 2) {
      issues.push({ field: "name", issue: "Member name must be at least 2 characters long." });
    } else if (name.length > MAX_FAMILY_MEMBER_STRING) {
      issues.push({ field: "name", issue: "Member name cannot exceed 100 characters." });
    }
  }

  // -- relation (required) -----------------------------------------------------
  let relation: FamilyRelation = FamilyRelation.OTHER;
  if (raw["relation"] === undefined || raw["relation"] === null || raw["relation"] === "") {
    issues.push({ field: "relation", issue: "Relation is required." });
  } else if (typeof raw["relation"] !== "string") {
    issues.push({ field: "relation", issue: "Relation must be a string." });
  } else {
    const relUpper = raw["relation"].trim().toUpperCase();
    if (!Object.values(FamilyRelation).includes(relUpper as FamilyRelation)) {
      issues.push({
        field: "relation",
        issue: `Invalid relation '${raw["relation"]}'. Allowed: ${Object.values(FamilyRelation).join(", ")}.`,
      });
    } else {
      relation = relUpper as FamilyRelation;
    }
  }

  const input: CreateFamilyMemberInput = { name, relation };

  // -- dateOfBirth (optional) --------------------------------------------------
  if (raw["dateOfBirth"] !== undefined && raw["dateOfBirth"] !== null && raw["dateOfBirth"] !== "") {
    if (typeof raw["dateOfBirth"] !== "string" && !(raw["dateOfBirth"] instanceof Date)) {
      issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid date string." });
    } else {
      const parsed = new Date(raw["dateOfBirth"] as string);
      if (Number.isNaN(parsed.getTime())) {
        issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid date." });
      } else if (parsed.getTime() > Date.now()) {
        issues.push({ field: "dateOfBirth", issue: "dateOfBirth cannot be in the future." });
      } else {
        input.dateOfBirth = parsed;
      }
    }
  }

  // -- gender / phone / occupation / bloodGroup (all optional strings) --------
  for (const field of ["gender", "phone", "occupation", "bloodGroup"] as const) {
    const value = raw[field];
    if (value !== undefined && value !== null && value !== "") {
      if (typeof value !== "string") {
        issues.push({ field, issue: `${field} must be a string.` });
      } else {
        const trimmed = value.trim();
        if (trimmed.length > MAX_FAMILY_MEMBER_STRING) {
          issues.push({ field, issue: `${field} cannot exceed 100 characters.` });
        } else {
          input[field] = trimmed;
        }
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return input;
}

export interface UpdateFamilyMemberInput {
  name?: string;
  relation?: FamilyRelation;
  dateOfBirth?: Date | null;
  gender?: string | null;
  phone?: string | null;
  occupation?: string | null;
  bloodGroup?: string | null;
}

/**
 * Validates request payload for PATCH .../families/:familyId/members/:memberId
 * Same field rules as create, but every field is optional, explicit null
 * clears the field, and at least one field must be present.
 */
export function validateUpdateFamilyMemberInput(body: unknown): UpdateFamilyMemberInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: UpdateFamilyMemberInput = {};
  let hasUpdateFields = false;

  if (raw["name"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["name"] !== "string" || !raw["name"].trim()) {
      issues.push({ field: "name", issue: "Member name cannot be empty." });
    } else {
      const trimmed = raw["name"].trim();
      if (trimmed.length < 2 || trimmed.length > MAX_FAMILY_MEMBER_STRING) {
        issues.push({ field: "name", issue: "Member name must be 2-100 characters." });
      } else {
        input.name = trimmed;
      }
    }
  }

  if (raw["relation"] !== undefined) {
    hasUpdateFields = true;
    if (typeof raw["relation"] !== "string") {
      issues.push({ field: "relation", issue: "Relation must be a string." });
    } else {
      const relUpper = raw["relation"].trim().toUpperCase();
      if (!Object.values(FamilyRelation).includes(relUpper as FamilyRelation)) {
        issues.push({
          field: "relation",
          issue: `Invalid relation '${raw["relation"]}'. Allowed: ${Object.values(FamilyRelation).join(", ")}.`,
        });
      } else {
        input.relation = relUpper as FamilyRelation;
      }
    }
  }

  if (raw["dateOfBirth"] !== undefined) {
    hasUpdateFields = true;
    if (raw["dateOfBirth"] === null || raw["dateOfBirth"] === "") {
      input.dateOfBirth = null;
    } else if (typeof raw["dateOfBirth"] !== "string" && !(raw["dateOfBirth"] instanceof Date)) {
      issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid date string or null." });
    } else {
      const parsed = new Date(raw["dateOfBirth"] as string);
      if (Number.isNaN(parsed.getTime())) {
        issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid date." });
      } else if (parsed.getTime() > Date.now()) {
        issues.push({ field: "dateOfBirth", issue: "dateOfBirth cannot be in the future." });
      } else {
        input.dateOfBirth = parsed;
      }
    }
  }

  for (const field of ["gender", "phone", "occupation", "bloodGroup"] as const) {
    if (raw[field] !== undefined) {
      hasUpdateFields = true;
      const value = raw[field];
      if (value === null || value === "") {
        input[field] = null;
      } else if (typeof value !== "string") {
        issues.push({ field, issue: `${field} must be a string or null.` });
      } else {
        const trimmed = value.trim();
        if (trimmed.length > MAX_FAMILY_MEMBER_STRING) {
          issues.push({ field, issue: `${field} cannot exceed 100 characters.` });
        } else {
          input[field] = trimmed;
        }
      }
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasUpdateFields) {
    throw HttpError.badRequest(
      "At least one field must be provided to update.",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  return input;
}

export function validateFamilyMemberIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest(
      "Family member identifier is required.",
      "INVALID_FAMILY_MEMBER_ID",
    );
  }
  return param.trim();
}

