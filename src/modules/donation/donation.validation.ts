// ---------------------------------------------------------------------------
// Donation Module — Input Validation
// ---------------------------------------------------------------------------

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { DonationSource, DonationStatus } from "../../../generated/prisma/client.js";

export interface CreateDonationInput {
  amount: bigint;
  accountId: string;
  fundId: string;
  categoryId: string;
  date: Date;
  memberId?: string | null;
  familyId?: string | null;
  donorName?: string | null;
  donorPhone?: string | null;
  donorEmail?: string | null;
  isAnonymousPublic: boolean;
  campaignId?: string | null;
  dueId?: string | null;
  pledgeId?: string | null;
  source: DonationSource;
  notes?: string | null;
  attachments?: string[];
  mosqueId?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates request payload for POST /api/mosques/:mosqueId/donations and POST /api/donations
 *
 * Rules:
 * - amount: strictly positive integer in minor units (poisha), bigint > 0
 * - accountId: required string (CUID of physical account)
 * - fundId: required string (CUID of accounting fund)
 * - categoryId: required string (CUID of income category)
 * - date: required valid date (ISO-8601 string or Date)
 * - donor: optional memberId, familyId, or free-text (donorName, donorPhone, donorEmail)
 * - isAnonymousPublic: optional boolean, defaults to false
 * - campaignId, dueId, pledgeId: optional strings
 * - source: optional DonationSource enum (CASH_BOX, MEMBER, ONLINE, BANK), defaults to MEMBER
 * - notes: optional string, max 500 chars
 */
export function validateCreateDonationInput(body: unknown): CreateDonationInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units) ----------------
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Donation amount is required." });
  } else {
    try {
      const rawAmount = raw["amount"];
      if (typeof rawAmount === "bigint") {
        if (rawAmount <= 0n) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = rawAmount;
        }
      } else if (typeof rawAmount === "number") {
        if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = BigInt(rawAmount);
        }
      } else if (typeof rawAmount === "string") {
        const trimmed = rawAmount.trim();
        // Check for integer pattern only (no decimal point or exponents)
        if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          issues.push({
            field: "amount",
            issue: "Amount must be a positive integer in minor units (poisha).",
          });
        } else {
          amount = BigInt(trimmed);
        }
      } else {
        issues.push({
          field: "amount",
          issue: "Amount must be a valid number or numeric string.",
        });
      }
    } catch {
      issues.push({
        field: "amount",
        issue: "Amount must be a positive integer in minor units (poisha).",
      });
    }
  }

  // -- accountId (required) ---------------------------------------------------
  let accountId = "";
  if (raw["accountId"] === undefined || raw["accountId"] === null || raw["accountId"] === "") {
    issues.push({ field: "accountId", issue: "Account ID is required." });
  } else if (typeof raw["accountId"] !== "string" || !raw["accountId"].trim()) {
    issues.push({ field: "accountId", issue: "Account ID must be a non-empty string." });
  } else {
    accountId = raw["accountId"].trim();
  }

  // -- fundId (required) ------------------------------------------------------
  let fundId = "";
  if (raw["fundId"] === undefined || raw["fundId"] === null || raw["fundId"] === "") {
    issues.push({ field: "fundId", issue: "Fund ID is required." });
  } else if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
    issues.push({ field: "fundId", issue: "Fund ID must be a non-empty string." });
  } else {
    fundId = raw["fundId"].trim();
  }

  // -- categoryId (required) --------------------------------------------------
  let categoryId = "";
  if (raw["categoryId"] === undefined || raw["categoryId"] === null || raw["categoryId"] === "") {
    issues.push({ field: "categoryId", issue: "Category ID is required." });
  } else if (typeof raw["categoryId"] !== "string" || !raw["categoryId"].trim()) {
    issues.push({ field: "categoryId", issue: "Category ID must be a non-empty string." });
  } else {
    categoryId = raw["categoryId"].trim();
  }

  // -- date (required) --------------------------------------------------------
  let date: Date = new Date();
  if (raw["date"] === undefined || raw["date"] === null || raw["date"] === "") {
    issues.push({ field: "date", issue: "Donation date is required." });
  } else if (typeof raw["date"] === "string" || typeof raw["date"] === "number" || raw["date"] instanceof Date) {
    const parsedDate = new Date(raw["date"]);
    if (isNaN(parsedDate.getTime())) {
      issues.push({ field: "date", issue: "Invalid date format. Expected a valid ISO-8601 date string." });
    } else {
      date = parsedDate;
    }
  } else {
    issues.push({ field: "date", issue: "Date must be a valid date string or timestamp." });
  }

  // -- memberId (optional) ----------------------------------------------------
  let memberId: string | null = null;
  if (raw["memberId"] !== undefined && raw["memberId"] !== null && raw["memberId"] !== "") {
    if (typeof raw["memberId"] !== "string" || !raw["memberId"].trim()) {
      issues.push({ field: "memberId", issue: "Member ID must be a string." });
    } else {
      memberId = raw["memberId"].trim();
    }
  }

  // -- familyId (optional) ----------------------------------------------------
  let familyId: string | null = null;
  if (raw["familyId"] !== undefined && raw["familyId"] !== null && raw["familyId"] !== "") {
    if (typeof raw["familyId"] !== "string" || !raw["familyId"].trim()) {
      issues.push({ field: "familyId", issue: "Family ID must be a string." });
    } else {
      familyId = raw["familyId"].trim();
    }
  }

  // -- donorName (optional) ---------------------------------------------------
  let donorName: string | null = null;
  if (raw["donorName"] !== undefined && raw["donorName"] !== null && raw["donorName"] !== "") {
    if (typeof raw["donorName"] !== "string") {
      issues.push({ field: "donorName", issue: "Donor name must be a string." });
    } else {
      const trimmed = raw["donorName"].trim();
      if (trimmed.length > 100) {
        issues.push({ field: "donorName", issue: "Donor name cannot exceed 100 characters." });
      } else {
        donorName = trimmed || null;
      }
    }
  }

  // -- donorPhone (optional) --------------------------------------------------
  let donorPhone: string | null = null;
  if (raw["donorPhone"] !== undefined && raw["donorPhone"] !== null && raw["donorPhone"] !== "") {
    if (typeof raw["donorPhone"] !== "string") {
      issues.push({ field: "donorPhone", issue: "Donor phone must be a string." });
    } else {
      const trimmed = raw["donorPhone"].trim();
      if (trimmed.length > 30) {
        issues.push({ field: "donorPhone", issue: "Donor phone cannot exceed 30 characters." });
      } else {
        donorPhone = trimmed || null;
      }
    }
  }

  // -- donorEmail (optional) --------------------------------------------------
  let donorEmail: string | null = null;
  if (raw["donorEmail"] !== undefined && raw["donorEmail"] !== null && raw["donorEmail"] !== "") {
    if (typeof raw["donorEmail"] !== "string") {
      issues.push({ field: "donorEmail", issue: "Donor email must be a string." });
    } else {
      const trimmed = raw["donorEmail"].trim().toLowerCase();
      if (!EMAIL_REGEX.test(trimmed)) {
        issues.push({ field: "donorEmail", issue: "Invalid donor email address format." });
      } else {
        donorEmail = trimmed;
      }
    }
  }

  // -- isAnonymousPublic (optional) -------------------------------------------
  let isAnonymousPublic = false;
  if (raw["isAnonymousPublic"] !== undefined && raw["isAnonymousPublic"] !== null) {
    if (typeof raw["isAnonymousPublic"] === "boolean") {
      isAnonymousPublic = raw["isAnonymousPublic"];
    } else if (raw["isAnonymousPublic"] === "true") {
      isAnonymousPublic = true;
    } else if (raw["isAnonymousPublic"] === "false") {
      isAnonymousPublic = false;
    } else {
      issues.push({ field: "isAnonymousPublic", issue: "isAnonymousPublic must be a boolean." });
    }
  }

  // -- campaignId (optional) --------------------------------------------------
  let campaignId: string | null = null;
  if (raw["campaignId"] !== undefined && raw["campaignId"] !== null && raw["campaignId"] !== "") {
    if (typeof raw["campaignId"] !== "string") {
      issues.push({ field: "campaignId", issue: "Campaign ID must be a string." });
    } else {
      campaignId = raw["campaignId"].trim() || null;
    }
  }

  // -- dueId (optional) -------------------------------------------------------
  let dueId: string | null = null;
  if (raw["dueId"] !== undefined && raw["dueId"] !== null && raw["dueId"] !== "") {
    if (typeof raw["dueId"] !== "string") {
      issues.push({ field: "dueId", issue: "Due ID must be a string." });
    } else {
      dueId = raw["dueId"].trim() || null;
    }
  }

  // -- pledgeId (optional) ----------------------------------------------------
  let pledgeId: string | null = null;
  if (raw["pledgeId"] !== undefined && raw["pledgeId"] !== null && raw["pledgeId"] !== "") {
    if (typeof raw["pledgeId"] !== "string") {
      issues.push({ field: "pledgeId", issue: "Pledge ID must be a string." });
    } else {
      pledgeId = raw["pledgeId"].trim() || null;
    }
  }

  // -- source (optional, default MEMBER) --------------------------------------
  let source: DonationSource = DonationSource.MEMBER;
  if (raw["source"] !== undefined && raw["source"] !== null && raw["source"] !== "") {
    if (typeof raw["source"] !== "string") {
      issues.push({ field: "source", issue: "Source must be a string." });
    } else {
      const sourceUpper = raw["source"].trim().toUpperCase();
      if (!Object.values(DonationSource).includes(sourceUpper as DonationSource)) {
        issues.push({
          field: "source",
          issue: `Invalid donation source '${raw["source"]}'. Allowed sources: ${Object.values(DonationSource).join(", ")}.`,
        });
      } else {
        source = sourceUpper as DonationSource;
      }
    }
  }

  // -- notes (optional) -------------------------------------------------------
  let notes: string | null = null;
  if (raw["notes"] !== undefined && raw["notes"] !== null && raw["notes"] !== "") {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      const trimmedNotes = raw["notes"].trim();
      if (trimmedNotes.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        notes = trimmedNotes || null;
      }
    }
  }

  // -- attachments (optional array of strings) --------------------------------
  let attachments: string[] = [];
  if (raw["attachments"] !== undefined && raw["attachments"] !== null) {
    if (!Array.isArray(raw["attachments"])) {
      issues.push({ field: "attachments", issue: "Attachments must be an array of string URLs." });
    } else {
      for (let i = 0; i < raw["attachments"].length; i++) {
        const item = raw["attachments"][i];
        if (typeof item !== "string" || !item.trim()) {
          issues.push({ field: `attachments[${i}]`, issue: "Attachment item must be a non-empty string." });
        } else {
          attachments.push(item.trim());
        }
      }
    }
  }

  // -- mosqueId (optional in body for root route) -----------------------------
  let mosqueId: string | undefined;
  if (raw["mosqueId"] !== undefined && raw["mosqueId"] !== null && raw["mosqueId"] !== "") {
    if (typeof raw["mosqueId"] !== "string" || !raw["mosqueId"].trim()) {
      issues.push({ field: "mosqueId", issue: "Mosque ID must be a non-empty string." });
    } else {
      mosqueId = raw["mosqueId"].trim();
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  return {
    amount,
    accountId,
    fundId,
    categoryId,
    date,
    memberId,
    familyId,
    donorName,
    donorPhone,
    donorEmail,
    isAnonymousPublic,
    campaignId,
    dueId,
    pledgeId,
    source,
    notes,
    attachments,
    mosqueId,
  };
}

/**
 * Validates route parameter :donationId
 */
export function validateDonationIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Donation identifier is required.", "INVALID_DONATION_ID");
  }
  return param.trim();
}

export interface GetMosqueDonationsQueryInput {
  donor?: string;
  family?: string;
  fund?: string;
  campaign?: string;
  startDate?: Date;
  endDate?: Date;
  status?: DonationStatus;
  source?: DonationSource;
  accountId?: string;
  categoryId?: string;
  memberId?: string;
  familyId?: string;
  fundId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/donations
 *
 * Supports filters:
 * - donor: text search (donorName/phone/email) or memberId
 * - family (familyId): CUID of family household
 * - fund (fundId): CUID of fund
 * - campaign (campaignId): campaign ID
 * - date range: startDate/endDate, fromDate/toDate, from/to
 * - status: PENDING, POSTED, REJECTED, VOIDED
 * - source: CASH_BOX, MEMBER, ONLINE, BANK
 * - pagination: page, limit
 */
export function validateGetMosqueDonationsQuery(query: unknown): GetMosqueDonationsQueryInput {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetMosqueDonationsQueryInput = {};

  // -- donor (memberId or donor name/phone/email search)
  const donorVal = raw["donor"] ?? raw["memberId"];
  if (typeof donorVal === "string" && donorVal.trim()) {
    result.donor = donorVal.trim();
    result.memberId = donorVal.trim();
  }

  // -- family (familyId)
  const familyVal = raw["family"] ?? raw["familyId"];
  if (typeof familyVal === "string" && familyVal.trim()) {
    result.family = familyVal.trim();
    result.familyId = familyVal.trim();
  }

  // -- fund (fundId)
  const fundVal = raw["fund"] ?? raw["fundId"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    result.fund = fundVal.trim();
    result.fundId = fundVal.trim();
  }

  // -- campaign (campaignId)
  const campaignVal = raw["campaign"] ?? raw["campaignId"];
  if (typeof campaignVal === "string" && campaignVal.trim()) {
    result.campaign = campaignVal.trim();
  }

  // -- status filter
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("Status filter must be a string.");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(DonationStatus).includes(statusUpper as DonationStatus)) {
      throw HttpError.badRequest(
        `Invalid donation status '${raw["status"]}'. Allowed: ${Object.values(DonationStatus).join(", ")}.`,
      );
    }
    result.status = statusUpper as DonationStatus;
  }

  // -- source filter
  if (raw["source"] !== undefined && raw["source"] !== null && raw["source"] !== "") {
    if (typeof raw["source"] !== "string") {
      throw HttpError.badRequest("Source filter must be a string.");
    }
    const sourceUpper = raw["source"].trim().toUpperCase();
    if (!Object.values(DonationSource).includes(sourceUpper as DonationSource)) {
      throw HttpError.badRequest(
        `Invalid donation source '${raw["source"]}'. Allowed: ${Object.values(DonationSource).join(", ")}.`,
      );
    }
    result.source = sourceUpper as DonationSource;
  }

  // -- accountId filter
  if (typeof raw["accountId"] === "string" && raw["accountId"].trim()) {
    result.accountId = raw["accountId"].trim();
  }

  // -- categoryId filter
  if (typeof raw["categoryId"] === "string" && raw["categoryId"].trim()) {
    result.categoryId = raw["categoryId"].trim();
  }

  // -- date range (startDate / endDate / from / to / fromDate / toDate)
  const rawStart = raw["startDate"] ?? raw["fromDate"] ?? raw["from"];
  if (rawStart !== undefined && rawStart !== null && rawStart !== "") {
    const d = new Date(rawStart as string | number);
    if (isNaN(d.getTime())) {
      throw HttpError.badRequest("Invalid startDate/from format. Expected valid date.");
    }
    result.startDate = d;
  }

  const rawEnd = raw["endDate"] ?? raw["toDate"] ?? raw["to"];
  if (rawEnd !== undefined && rawEnd !== null && rawEnd !== "") {
    const d = new Date(rawEnd as string | number);
    if (isNaN(d.getTime())) {
      throw HttpError.badRequest("Invalid endDate/to format. Expected valid date.");
    }
    result.endDate = d;
  }

  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    result.search = raw["search"].trim();
  }

  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      throw HttpError.badRequest("page must be a positive integer.");
    }
    result.page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1) {
      throw HttpError.badRequest("limit must be a positive integer.");
    }
    result.limit = l;
  }

  return result;
}

export interface VoidDonationInput {
  reason: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/donations/:donationId/void
 */
export function validateVoidDonationInput(body: unknown): VoidDonationInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw["reason"] !== "string" || !raw["reason"].trim()) {
    throw HttpError.badRequest("Void reason is required.", "MISSING_VOID_REASON");
  }
  const reason = raw["reason"].trim();
  if (reason.length > 500) {
    throw HttpError.badRequest("Void reason cannot exceed 500 characters.", "INVALID_VOID_REASON");
  }
  return { reason };
}

export interface UpdateDonationInput {
  notes?: string | null;
  donorName?: string | null;
  donorPhone?: string | null;
  donorEmail?: string | null;
  attachments?: string[];
  isAnonymousPublic?: boolean;
}

const IMMUTABLE_FINANCIAL_FIELDS = [
  "amount",
  "fundId",
  "fund",
  "accountId",
  "account",
  "categoryId",
  "category",
  "date",
  "receiptNumber",
  "status",
] as const;

/**
 * Validates request payload for PATCH /api/mosques/:mosqueId/donations/:donationId
 *
 * Rules:
 *  - Only non-financial fields are editable: notes, donorName, donorPhone, donorEmail, attachments, isAnonymousPublic.
 *  - Financial fields (amount, fund, account, category, date, receiptNumber, status) are strictly rejected
 *    with 400 Bad Request and error code 'TRANSACTION_IMMUTABLE'.
 *  - At least one field must be provided.
 */
export function validateUpdateDonationInput(body: unknown): UpdateDonationInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  // 1. Strict immutability check
  for (const field of IMMUTABLE_FINANCIAL_FIELDS) {
    if (raw[field] !== undefined) {
      throw HttpError.badRequest(
        "Financial fields (amount, fund, account, date, category) cannot be modified on recorded donations. Void and recreate the entry if a financial correction is needed.",
        "TRANSACTION_IMMUTABLE",
      );
    }
  }

  const issues: ValidationIssue[] = [];
  const result: UpdateDonationInput = {};
  let hasFields = false;

  // -- notes / note
  const notesVal = raw["notes"] ?? raw["note"];
  if (notesVal !== undefined) {
    hasFields = true;
    if (notesVal === null || notesVal === "") {
      result.notes = null;
    } else if (typeof notesVal !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string or null." });
    } else {
      const trimmed = notesVal.trim();
      if (trimmed.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        result.notes = trimmed || null;
      }
    }
  }

  // -- donorName / donor_name / name
  const donorNameVal = raw["donorName"] ?? raw["donor_name"] ?? raw["name"];
  if (donorNameVal !== undefined) {
    hasFields = true;
    if (donorNameVal === null || donorNameVal === "") {
      result.donorName = null;
    } else if (typeof donorNameVal !== "string") {
      issues.push({ field: "donorName", issue: "Donor name must be a string or null." });
    } else {
      const trimmed = donorNameVal.trim();
      if (trimmed.length > 100) {
        issues.push({ field: "donorName", issue: "Donor name cannot exceed 100 characters." });
      } else {
        result.donorName = trimmed || null;
      }
    }
  }

  // -- donorPhone
  if (raw["donorPhone"] !== undefined) {
    hasFields = true;
    if (raw["donorPhone"] === null || raw["donorPhone"] === "") {
      result.donorPhone = null;
    } else if (typeof raw["donorPhone"] !== "string") {
      issues.push({ field: "donorPhone", issue: "Donor phone must be a string or null." });
    } else {
      const trimmed = raw["donorPhone"].trim();
      if (trimmed.length > 30) {
        issues.push({ field: "donorPhone", issue: "Donor phone cannot exceed 30 characters." });
      } else {
        result.donorPhone = trimmed || null;
      }
    }
  }

  // -- donorEmail
  if (raw["donorEmail"] !== undefined) {
    hasFields = true;
    if (raw["donorEmail"] === null || raw["donorEmail"] === "") {
      result.donorEmail = null;
    } else if (typeof raw["donorEmail"] !== "string") {
      issues.push({ field: "donorEmail", issue: "Donor email must be a string or null." });
    } else {
      const trimmed = raw["donorEmail"].trim().toLowerCase();
      if (!EMAIL_REGEX.test(trimmed)) {
        issues.push({ field: "donorEmail", issue: "Invalid donor email address format." });
      } else {
        result.donorEmail = trimmed;
      }
    }
  }

  // -- attachments
  if (raw["attachments"] !== undefined) {
    hasFields = true;
    if (!Array.isArray(raw["attachments"])) {
      issues.push({ field: "attachments", issue: "Attachments must be an array of string URLs." });
    } else {
      const cleaned: string[] = [];
      for (let i = 0; i < raw["attachments"].length; i++) {
        const item = raw["attachments"][i];
        if (typeof item !== "string" || !item.trim()) {
          issues.push({ field: `attachments[${i}]`, issue: "Attachment item must be a non-empty string." });
        } else {
          cleaned.push(item.trim());
        }
      }
      result.attachments = cleaned;
    }
  }

  // -- isAnonymousPublic
  if (raw["isAnonymousPublic"] !== undefined) {
    hasFields = true;
    if (typeof raw["isAnonymousPublic"] === "boolean") {
      result.isAnonymousPublic = raw["isAnonymousPublic"];
    } else if (raw["isAnonymousPublic"] === "true") {
      result.isAnonymousPublic = true;
    } else if (raw["isAnonymousPublic"] === "false") {
      result.isAnonymousPublic = false;
    } else {
      issues.push({ field: "isAnonymousPublic", issue: "isAnonymousPublic must be a boolean." });
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues);
  }

  if (!hasFields) {
    throw HttpError.badRequest(
      "At least one non-financial field must be provided to update (notes, donorName, donorPhone, donorEmail, attachments, isAnonymousPublic).",
      "EMPTY_UPDATE_PAYLOAD",
    );
  }

  return result;
}


