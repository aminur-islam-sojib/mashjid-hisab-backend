// =============================================================================
// Transparency Controller — HTTP Handlers for Unauthenticated Public Endpoints
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateSlugParam,
  validateCampaignIdParam,
  validateReceiptVerificationCodeParam,
  validateDonationsFeedQuery,
} from "./transparency.validation.js";
import {
  getPublicMosqueSummary,
  getPublicMosqueDonationsFeed,
  getPublicMosqueExpenseCategorySummary,
  getPublicCampaigns,
  getPublicCampaignDetails,
  getPublicMosqueTransparency,
  verifyDonationReceipt,
} from "./transparency.service.js";

/**
 * GET /api/public/mosques/:slug/summary
 * Access: Public (gated by mosque.isTransparencyPageEnabled)
 *
 * Returns fiscal-year-to-date totals per Fund:
 * name, type, isRestricted, totalCollected, totalDisbursed, currentBalance.
 */
export const getPublicMosqueSummaryHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const data = await getPublicMosqueSummary(slug);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque transparency summary retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/mosques/:slug/donations
 * Access: Public (gated by mosque.isTransparencyPageEnabled)
 *
 * Paginated, newest-first feed of individual donations.
 * Excludes voided originals and reversals. Redacts donor names when anonymous.
 */
export const getPublicMosqueDonationsFeedHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const query = validateDonationsFeedQuery(req.query);
    const data = await getPublicMosqueDonationsFeed(slug, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Public donations feed retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/mosques/:slug/expenses/summary
 * Access: Public (gated by mosque.isTransparencyPageEnabled)
 *
 * Expense totals grouped by Category (not itemized) for current fiscal year.
 */
export const getPublicMosqueExpenseCategorySummaryHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const data = await getPublicMosqueExpenseCategorySummary(slug);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque expense category summary retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/mosques/:slug/campaigns
 * Access: Public (gated by mosque.isTransparencyPageEnabled)
 *
 * Lists public fundraising campaigns with goal, raised, and pledged amounts.
 */
export const getPublicCampaignsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const data = await getPublicCampaigns(slug);

    sendResponse(res, {
      statusCode: 200,
      message: "Public campaigns retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/mosques/:slug/campaigns/:campaignId
 * Access: Public
 *
 * Detailed view of one campaign's progress. Anonymous-flagged donors never appear.
 */
export const getPublicCampaignDetailsHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const campaignId = validateCampaignIdParam(req.params["campaignId"]);
    const data = await getPublicCampaignDetails(slug, campaignId);

    sendResponse(res, {
      statusCode: 200,
      message: "Campaign details retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/mosques/:slug/transparency?month=
 * Access: Public (only if transparency is enabled for the mosque; otherwise 404)
 *
 * Monthly totals of income and expense by fund and category. Totals only, never individual transactions.
 */
export const getPublicMosqueTransparencyHandler = catchAsync(
  async (req: Request, res: Response) => {
    const slug = validateSlugParam(req.params["slug"]);
    const monthQuery = typeof req.query["month"] === "string" ? req.query["month"] : undefined;
    const data = await getPublicMosqueTransparency(slug, monthQuery);

    sendResponse(res, {
      statusCode: 200,
      message: "Transparency report retrieved successfully.",
      data,
    });
  },
);

/**
 * GET /api/public/receipts/:verificationCode
 * Access: Public (Rate-limited)
 *
 * Confirms receipt authenticity: returns mosque, date, amount, and fund, with zero donor details.
 */
export const verifyDonationReceiptHandler = catchAsync(
  async (req: Request, res: Response) => {
    const code = validateReceiptVerificationCodeParam(req.params["verificationCode"]);
    const data = await verifyDonationReceipt(code);

    sendResponse(res, {
      statusCode: 200,
      message: "Receipt verified successfully.",
      data,
    });
  },
);
