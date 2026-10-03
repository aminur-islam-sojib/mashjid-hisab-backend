// ---------------------------------------------------------------------------
// User module — input validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";

export interface UpdateProfileInput {
  name?: string;
  avatarUrl?: string | null;
  phone?: string | null;
  bio?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  locale?: string;
}

const PHONE_RE = /^\+?[0-9]{7,15}$/;

export function validateUpdateProfileInput(body: unknown): UpdateProfileInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  // Strict Tenancy / Role Guard: Never accept mosqueId or role in profile updates!
  if (raw["mosqueId"] !== undefined || raw["role"] !== undefined) {
    throw HttpError.badRequest(
      "mosqueId and role cannot be modified via profile endpoints. Use membership endpoints instead.",
      "FORBIDDEN_FIELD",
    );
  }

  const issues: ValidationIssue[] = [];
  const input: UpdateProfileInput = {};

  let fieldCount = 0;

  // -- name (optional) -------------------------------------------------------
  if (raw["name"] !== undefined) {
    fieldCount++;
    if (typeof raw["name"] !== "string" || raw["name"].trim().length < 2 || raw["name"].trim().length > 100) {
      issues.push({ field: "name", issue: "name must be between 2 and 100 characters." });
    } else {
      input.name = raw["name"].trim();
    }
  }

  // -- phone (optional) ------------------------------------------------------
  if (raw["phone"] !== undefined) {
    fieldCount++;
    if (raw["phone"] === null || raw["phone"] === "") {
      input.phone = null;
    } else if (typeof raw["phone"] === "string") {
      const trimmedPhone = raw["phone"].trim();
      if (!PHONE_RE.test(trimmedPhone)) {
        issues.push({
          field: "phone",
          issue: "phone must be a valid number (7–15 digits, optional leading +).",
        });
      } else {
        input.phone = trimmedPhone;
      }
    } else {
      issues.push({ field: "phone", issue: "phone must be a string or null." });
    }
  }

  // -- avatarUrl (optional) --------------------------------------------------
  if (raw["avatarUrl"] !== undefined) {
    fieldCount++;
    if (raw["avatarUrl"] === null || raw["avatarUrl"] === "") {
      input.avatarUrl = null;
    } else if (typeof raw["avatarUrl"] === "string") {
      const trimmed = raw["avatarUrl"].trim();
      if (trimmed.length > 500) {
        issues.push({ field: "avatarUrl", issue: "avatarUrl cannot exceed 500 characters." });
      } else {
        input.avatarUrl = trimmed;
      }
    } else {
      issues.push({ field: "avatarUrl", issue: "avatarUrl must be a string or null." });
    }
  }

  // -- bio (optional) --------------------------------------------------------
  if (raw["bio"] !== undefined) {
    fieldCount++;
    if (raw["bio"] === null || raw["bio"] === "") {
      input.bio = null;
    } else if (typeof raw["bio"] === "string") {
      const trimmed = raw["bio"].trim();
      if (trimmed.length > 500) {
        issues.push({ field: "bio", issue: "bio cannot exceed 500 characters." });
      } else {
        input.bio = trimmed;
      }
    } else {
      issues.push({ field: "bio", issue: "bio must be a string or null." });
    }
  }

  // -- address (optional) ----------------------------------------------------
  if (raw["address"] !== undefined) {
    fieldCount++;
    if (raw["address"] === null || raw["address"] === "") {
      input.address = null;
    } else if (typeof raw["address"] === "string") {
      const trimmed = raw["address"].trim();
      if (trimmed.length > 255) {
        issues.push({ field: "address", issue: "address cannot exceed 255 characters." });
      } else {
        input.address = trimmed;
      }
    } else {
      issues.push({ field: "address", issue: "address must be a string or null." });
    }
  }

  // -- dateOfBirth (optional) ------------------------------------------------
  if (raw["dateOfBirth"] !== undefined) {
    fieldCount++;
    if (raw["dateOfBirth"] === null || raw["dateOfBirth"] === "") {
      input.dateOfBirth = null;
    } else if (typeof raw["dateOfBirth"] === "string") {
      const parsedDate = new Date(raw["dateOfBirth"]);
      if (Number.isNaN(parsedDate.getTime())) {
        issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid ISO date." });
      } else {
        input.dateOfBirth = parsedDate.toISOString();
      }
    } else {
      issues.push({ field: "dateOfBirth", issue: "dateOfBirth must be a valid ISO date string or null." });
    }
  }

  // -- locale (optional) -----------------------------------------------------
  if (raw["locale"] !== undefined) {
    fieldCount++;
    if (typeof raw["locale"] !== "string" || !raw["locale"].trim()) {
      issues.push({ field: "locale", issue: "locale must be a non-empty string." });
    } else {
      input.locale = raw["locale"].trim();
    }
  }

  if (fieldCount === 0) {
    throw HttpError.badRequest("At least one field must be provided to update profile.");
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return input;
}
