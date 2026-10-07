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
