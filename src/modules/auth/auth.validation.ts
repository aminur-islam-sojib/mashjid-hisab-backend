// ---------------------------------------------------------------------------
// Register — request/response validation schemas.
//
// We use plain TypeScript + manual validation here to keep zero extra
// dependencies (no Zod, Joi, etc.). Add Zod if the team agrees — the
// validateRequest middleware shape below stays the same.
//
// Rules encoded here:
//  • email        — valid email format, lowercased
//  • phone        — optional, E.164-ish format check
//  • password     — ≥8 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit
//  • name         — 2–100 chars, trimmed
//  • mosqueId     — optional cuid string
//  • locale       — optional, defaults to "bn"
// ---------------------------------------------------------------------------

import { HttpError } from "../../errors/HttpError.js";

export interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  mosqueId?: string;
  locale?: string;
}

// Simple but intentional: not RFC-5322 complete — covers 99% of real addresses
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164-ish: optional +, then 7–15 digits
const PHONE_RE = /^\+?[0-9]{7,15}$/;
// cuid: starts with 'c', followed by 24 alphanumeric chars
const CUID_RE = /^c[a-z0-9]{24}$/i;

export function validateRegisterInput(body: unknown): RegisterInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  // -- name ------------------------------------------------------------------
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  if (name.length < 2 || name.length > 100) {
    throw HttpError.badRequest("name must be between 2 and 100 characters");
  }

  // -- email -----------------------------------------------------------------
  const email =
    typeof raw["email"] === "string" ? raw["email"].trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    throw HttpError.badRequest("A valid email address is required");
  }

  // -- phone (optional) ------------------------------------------------------
  let phone: string | undefined;
  if (raw["phone"] !== undefined && raw["phone"] !== null && raw["phone"] !== "") {
    const rawPhone = String(raw["phone"]).trim();
    if (!PHONE_RE.test(rawPhone)) {
      throw HttpError.badRequest(
        "phone must be a valid number (7–15 digits, optional leading +)",
      );
    }
    phone = rawPhone;
  }

  // -- password --------------------------------------------------------------
  const password =
    typeof raw["password"] === "string" ? raw["password"] : "";

  if (password.length < 8) {
    throw HttpError.badRequest("password must be at least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    throw HttpError.badRequest("password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    throw HttpError.badRequest("password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw HttpError.badRequest("password must contain at least one digit");
  }

  // -- mosqueId (optional) ---------------------------------------------------
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null && raw["mosqueId"] !== "") {
    const rawMosqueId = String(raw["mosqueId"]).trim();
    if (!CUID_RE.test(rawMosqueId)) {
      throw HttpError.badRequest("mosqueId is not a valid id");
    }
    mosqueId = rawMosqueId;
  }

  // -- locale (optional) -----------------------------------------------------
  const locale =
    typeof raw["locale"] === "string" ? raw["locale"].trim() : "bn";

  return { name, email, phone, password, mosqueId, locale };
}
