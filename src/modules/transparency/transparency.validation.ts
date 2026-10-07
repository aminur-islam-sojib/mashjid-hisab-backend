// =============================================================================
// Transparency Module — Input Validation
//
// Strictly validates public inputs without exposing internals.
// Follows manual parsing patterns standard across the codebase.
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";

export interface ParsedMonthQuery {
  monthStr: string;
  year: number;
  month: number; // 1-12
  startDate: Date;
  endDate: Date;
}

/**
 * Validates a mosque slug URL parameter.
 */
export function validateSlugParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Mosque slug parameter is required.", "INVALID_SLUG");
  }

  const slug = param.trim().toLowerCase();
  if (slug.length > 100) {
    throw HttpError.badRequest("Mosque slug is too long.", "INVALID_SLUG");
  }

  return slug;
}

/**
 * Validates a campaignId URL parameter.
 */
export function validateCampaignIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Campaign ID parameter is required.", "INVALID_CAMPAIGN_ID");
  }

  const campaignId = param.trim();
  if (campaignId.length > 50) {
    throw HttpError.badRequest("Campaign ID is invalid.", "INVALID_CAMPAIGN_ID");
  }

  return campaignId;
}

/**
 * Validates the optional ?month= query parameter (format: YYYY-MM).
 * Defaults to current month if omitted or empty.
 */
export function validateTransparencyMonthQuery(rawMonth: unknown): ParsedMonthQuery {
  let monthStr: string;

  if (rawMonth === undefined || rawMonth === null || rawMonth === "") {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    monthStr = `${y}-${m}`;
  } else if (typeof rawMonth === "string") {
    monthStr = rawMonth.trim();
  } else {
    throw HttpError.badRequest(
      "The 'month' query parameter must be a string formatted as 'YYYY-MM'.",
      "INVALID_MONTH_FORMAT",
    );
  }

  const match = monthStr.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match || !match[1] || !match[2]) {
    throw HttpError.badRequest(
      "The 'month' query parameter must follow the 'YYYY-MM' format (e.g., '2026-10').",
      "INVALID_MONTH_FORMAT",
    );
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  // UTC start and end boundaries for the month
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  return {
    monthStr,
    year,
    month,
    startDate,
    endDate,
  };
}

/**
 * Validates a receipt verification code or receipt number parameter.
 */
export function validateReceiptVerificationCodeParam(code: unknown): string {
  if (typeof code !== "string" || !code.trim()) {
    throw HttpError.badRequest(
      "Receipt verification code is required.",
      "INVALID_VERIFICATION_CODE",
    );
  }

  const trimmed = code.trim();
  if (trimmed.length < 3 || trimmed.length > 100) {
    throw HttpError.badRequest(
      "Receipt verification code is invalid.",
      "INVALID_VERIFICATION_CODE",
    );
  }

  return trimmed;
}

export interface DonationsFeedQuery {
  page: number;
  limit: number;
}

/**
 * Validates query parameters for the public donations feed.
 */
export function validateDonationsFeedQuery(query: unknown): DonationsFeedQuery {
  if (!query || typeof query !== "object") {
    return { page: 1, limit: 20 };
  }

  const raw = query as Record<string, unknown>;
  let page = 1;
  let limit = 20;

  if (raw["page"] !== undefined && raw["page"] !== "") {
    const p = parseInt(String(raw["page"]), 10);
    if (isNaN(p) || p < 1) {
      throw HttpError.badRequest(
        "Page must be a positive integer greater than or equal to 1.",
        "INVALID_PAGE",
      );
    }
    page = p;
  }

  if (raw["limit"] !== undefined && raw["limit"] !== "") {
    const l = parseInt(String(raw["limit"]), 10);
    if (isNaN(l) || l < 1 || l > 100) {
      throw HttpError.badRequest(
        "Limit must be an integer between 1 and 100.",
        "INVALID_LIMIT",
      );
    }
    limit = l;
  }

  return { page, limit };
}

/**
 * Calculates UTC date range for a given mosque fiscal year start month.
 *
 * E.g., if fiscalYearStartMonth is 7 (July) and referenceDate is Oct 2026:
 * FY starts July 1, 2026 00:00:00 UTC and ends July 1, 2027 00:00:00 UTC.
 */
export function getFiscalYearDateRange(
  fiscalYearStartMonth: number = 7,
  referenceDate: Date = new Date(),
): { startDate: Date; endDate: Date } {
  const currentYear = referenceDate.getUTCFullYear();
  const currentMonth = referenceDate.getUTCMonth() + 1; // 1-12

  let fyStartYear = currentYear;
  if (currentMonth < fiscalYearStartMonth) {
    fyStartYear = currentYear - 1;
  }

  const startDate = new Date(Date.UTC(fyStartYear, fiscalYearStartMonth - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(fyStartYear + 1, fiscalYearStartMonth - 1, 1, 0, 0, 0, 0));

  return { startDate, endDate };
}
