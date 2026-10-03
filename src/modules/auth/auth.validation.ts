// ---------------------------------------------------------------------------
// Auth — input validation
//
// Strategy: collect ALL field errors before throwing, so the client gets
// every problem in one round-trip (not just the first one it hit).
//
// Throws HttpError.validationError(details[])  → 422
// Throws HttpError.badRequest(...)              → 400 (malformed body)
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";

// ---------------------------------------------------------------------------
// Shared regex
// ---------------------------------------------------------------------------

/** Simple but covers 99% of real addresses — not full RFC-5322 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164-ish: optional leading +, then 7–15 digits */
const PHONE_RE = /^\+?[0-9]{7,15}$/;
/** cuid v1: starts with 'c', followed by 24 alphanumeric chars */
const CUID_RE = /^c[a-z0-9]{24}$/i;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  mosqueId?: string;
  locale?: string;
}

export function validateRegisterInput(body: unknown): RegisterInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- name ------------------------------------------------------------------
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  if (name.length < 2 || name.length > 100) {
    issues.push({ field: "name", issue: "Must be between 2 and 100 characters." });
  }

  // -- email -----------------------------------------------------------------
  const email =
    typeof raw["email"] === "string" ? raw["email"].trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    issues.push({ field: "email", issue: "Must be a valid email address." });
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

  // -- password --------------------------------------------------------------
  const password =
    typeof raw["password"] === "string" ? raw["password"] : "";

  if (password.length < 8) {
    issues.push({ field: "password", issue: "Must be at least 8 characters." });
  } else {
    // Only check composition if length is satisfied — avoids confusing stacked messages
    if (!/[A-Z]/.test(password)) {
      issues.push({ field: "password", issue: "Must contain at least one uppercase letter." });
    }
    if (!/[a-z]/.test(password)) {
      issues.push({ field: "password", issue: "Must contain at least one lowercase letter." });
    }
    if (!/[0-9]/.test(password)) {
      issues.push({ field: "password", issue: "Must contain at least one digit." });
    }
  }

  // -- mosqueId (optional) ---------------------------------------------------
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null && raw["mosqueId"] !== "") {
    const rawMosqueId = String(raw["mosqueId"]).trim();
    if (!CUID_RE.test(rawMosqueId)) {
      issues.push({ field: "mosqueId", issue: "Must be a valid mosque id." });
    } else {
      mosqueId = rawMosqueId;
    }
  }

  // -- locale (optional) -----------------------------------------------------
  const locale =
    typeof raw["locale"] === "string" ? raw["locale"].trim() : "bn";

  // -- Throw all issues at once ----------------------------------------------
  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return { name, email, phone, password, mosqueId, locale };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginInput {
  /** Accepts email address OR phone number — resolved in the service layer */
  identifier: string;
  password: string;
}

export function validateLoginInput(body: unknown): LoginInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- identifier (email or phone) -------------------------------------------
  const identifier =
    typeof raw["identifier"] === "string" ? raw["identifier"].trim() : "";
  if (!identifier) {
    issues.push({
      field: "identifier",
      issue: "Email or phone number is required.",
    });
  }

  // -- password --------------------------------------------------------------
  const password =
    typeof raw["password"] === "string" ? raw["password"].trim() : "";
  if (!password) {
    issues.push({ field: "password", issue: "Password is required." });
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return { identifier, password };
}
