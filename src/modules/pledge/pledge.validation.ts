// =============================================================================
// pledge.validation.ts — Input Validation for Domain 6: Pledges
// =============================================================================

import { HttpError, type ValidationIssue } from "../../errors/HttpError.js";
import { PledgeStatus } from "../../../generated/prisma/client.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreatePledgeInput {
  amount: bigint;
  fundId?: string | null;
  campaignId?: string | null;
  dueDate: Date;
  installments?: number | null;
  memberId?: string | null;
  familyId?: string | null;
  donorName?: string | null;
  donorPhone?: string | null;
  donorEmail?: string | null;
  notes?: string | null;
  mosqueId?: string;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/pledges and POST /api/pledges
 */
export function validateCreatePledgeInput(body: unknown): CreatePledgeInput {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: ValidationIssue[] = [];

  // -- amount (required, strictly positive BigInt minor units) ----------------
  let amount = 0n;
  if (raw["amount"] === undefined || raw["amount"] === null || raw["amount"] === "") {
    issues.push({ field: "amount", issue: "Pledge amount is required." });
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

  // -- fundId and campaignId (at least one is required) ----------------------
  let fundId: string | null = null;
  if (raw["fundId"] !== undefined && raw["fundId"] !== null && raw["fundId"] !== "") {
    if (typeof raw["fundId"] !== "string" || !raw["fundId"].trim()) {
      issues.push({ field: "fundId", issue: "Fund ID must be a non-empty string." });
    } else {
      fundId = raw["fundId"].trim();
    }
  }

  let campaignId: string | null = null;
  if (raw["campaignId"] !== undefined && raw["campaignId"] !== null && raw["campaignId"] !== "") {
    if (typeof raw["campaignId"] !== "string" || !raw["campaignId"].trim()) {
      issues.push({ field: "campaignId", issue: "Campaign ID must be a non-empty string." });
    } else {
      campaignId = raw["campaignId"].trim();
    }
  }

  if (!fundId && !campaignId) {
    issues.push({
      field: "fundId",
      issue: "Either fundId or campaignId must be provided.",
    });
  }

  // -- dueDate (required) -----------------------------------------------------
  let dueDate: Date = new Date();
  if (raw["dueDate"] === undefined || raw["dueDate"] === null || raw["dueDate"] === "") {
    issues.push({ field: "dueDate", issue: "Due date is required." });
  } else if (
    typeof raw["dueDate"] === "string" ||
    typeof raw["dueDate"] === "number" ||
    raw["dueDate"] instanceof Date
  ) {
    const parsedDate = new Date(raw["dueDate"] as string | number | Date);
    if (isNaN(parsedDate.getTime())) {
      issues.push({
        field: "dueDate",
        issue: "Invalid dueDate format. Expected a valid ISO-8601 date string.",
      });
    } else {
      dueDate = parsedDate;
    }
  } else {
    issues.push({
      field: "dueDate",
      issue: "dueDate must be a valid date string or timestamp.",
    });
  }

  // -- installments (optional, positive integer) ------------------------------
  let installments: number | null = null;
  if (raw["installments"] !== undefined && raw["installments"] !== null && raw["installments"] !== "") {
    const num = Number(raw["installments"]);
    if (!Number.isInteger(num) || num < 1 || num > 360) {
      issues.push({
        field: "installments",
        issue: "Installments must be a positive integer between 1 and 360.",
      });
    } else {
      installments = num;
    }
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

  // -- notes (optional) -------------------------------------------------------
  let notes: string | null = null;
  if (raw["notes"] !== undefined && raw["notes"] !== null && raw["notes"] !== "") {
    if (typeof raw["notes"] !== "string") {
      issues.push({ field: "notes", issue: "Notes must be a string." });
    } else {
      const trimmed = raw["notes"].trim();
      if (trimmed.length > 500) {
        issues.push({ field: "notes", issue: "Notes cannot exceed 500 characters." });
      } else {
        notes = trimmed || null;
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
    fundId,
    campaignId,
    dueDate,
    installments,
    memberId,
    familyId,
    donorName,
    donorPhone,
    donorEmail,
    notes,
    mosqueId,
  };
}

export interface GetPledgesQueryInput {
  status?: PledgeStatus;
  fundId?: string;
  campaignId?: string;
  memberId?: string;
  familyId?: string;
  donor?: string;
  search?: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  page?: number;
  limit?: number;
}

/**
 * Validates query parameters for GET /api/mosques/:mosqueId/pledges
 */
export function validateGetPledgesQuery(query: unknown): GetPledgesQueryInput {
  if (!query || typeof query !== "object") return {};
  const raw = query as Record<string, unknown>;
  const result: GetPledgesQueryInput = {};

  // -- status
  if (raw["status"] !== undefined && raw["status"] !== null && raw["status"] !== "") {
    if (typeof raw["status"] !== "string") {
      throw HttpError.badRequest("status filter must be a string.");
    }
    const statusUpper = raw["status"].trim().toUpperCase();
    if (!Object.values(PledgeStatus).includes(statusUpper as PledgeStatus)) {
      throw HttpError.badRequest(
        `Invalid pledge status '${raw["status"]}'. Allowed: ${Object.values(PledgeStatus).join(", ")}.`,
        "INVALID_STATUS",
      );
    }
    result.status = statusUpper as PledgeStatus;
  }

  // -- fundId
  const fundVal = raw["fundId"] ?? raw["fund"];
  if (typeof fundVal === "string" && fundVal.trim()) {
    result.fundId = fundVal.trim();
  }

  // -- campaignId
  const campaignVal = raw["campaignId"] ?? raw["campaign"];
  if (typeof campaignVal === "string" && campaignVal.trim()) {
    result.campaignId = campaignVal.trim();
  }

  // -- memberId
  const memberVal = raw["memberId"] ?? raw["member"];
  if (typeof memberVal === "string" && memberVal.trim()) {
    result.memberId = memberVal.trim();
  }

  // -- familyId
  const familyVal = raw["familyId"] ?? raw["family"];
  if (typeof familyVal === "string" && familyVal.trim()) {
    result.familyId = familyVal.trim();
  }

  // -- donor (search text)
  if (typeof raw["donor"] === "string" && raw["donor"].trim()) {
    result.donor = raw["donor"].trim();
  }

  // -- search
  if (typeof raw["search"] === "string" && raw["search"].trim()) {
    result.search = raw["search"].trim();
  }

  // -- date range
  const rawDueFrom = raw["dueDateFrom"] ?? raw["startDate"] ?? raw["from"];
  if (rawDueFrom !== undefined && rawDueFrom !== null && rawDueFrom !== "") {
    const d = new Date(rawDueFrom as string | number);
    if (isNaN(d.getTime())) {
      throw HttpError.badRequest("Invalid dueDateFrom format. Expected valid date.");
    }
    result.dueDateFrom = d;
  }

  const rawDueTo = raw["dueDateTo"] ?? raw["endDate"] ?? raw["to"];
  if (rawDueTo !== undefined && rawDueTo !== null && rawDueTo !== "") {
    const d = new Date(rawDueTo as string | number);
    if (isNaN(d.getTime())) {
      throw HttpError.badRequest("Invalid dueDateTo format. Expected valid date.");
    }
    result.dueDateTo = d;
  }

  // -- pagination
  if (raw["page"] !== undefined && raw["page"] !== null && raw["page"] !== "") {
    const p = Number(raw["page"]);
    if (!Number.isInteger(p) || p < 1) {
      throw HttpError.badRequest("page must be a positive integer.");
    }
    result.page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== null && raw["limit"] !== "") {
    const l = Number(raw["limit"]);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      throw HttpError.badRequest("limit must be a positive integer between 1 and 100.");
    }
    result.limit = l;
  }

  return result;
}

export interface CancelPledgeInput {
  reason?: string | null;
}

/**
 * Validates request payload for POST /api/mosques/:mosqueId/pledges/:id/cancel
 */
export function validateCancelPledgeInput(body: unknown): CancelPledgeInput {
  if (!body || typeof body !== "object") {
    return { reason: null };
  }

  const raw = body as Record<string, unknown>;
  let reason: string | null = null;

  if (raw["reason"] !== undefined && raw["reason"] !== null && raw["reason"] !== "") {
    if (typeof raw["reason"] !== "string") {
      throw HttpError.badRequest("Cancellation reason must be a string.");
    }
    const trimmed = raw["reason"].trim();
    if (trimmed.length > 500) {
      throw HttpError.badRequest("Cancellation reason cannot exceed 500 characters.");
    }
    reason = trimmed || null;
  }

  return { reason };
}

/**
 * Validates route parameter :id or :pledgeId
 */
export function validatePledgeIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Pledge identifier is required.", "INVALID_PLEDGE_ID");
  }
  return param.trim();
}
