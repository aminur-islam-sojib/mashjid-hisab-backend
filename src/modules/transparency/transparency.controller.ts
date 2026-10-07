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
} from "./transparency.validation.js";
import {
  getPublicCampaigns,
  getPublicCampaignDetails,
  getPublicMosqueTransparency,
  verifyDonationReceipt,
} from "./transparency.service.js";

/**
 * GET /api/public/mosques/:slug/campaigns
 * Access: Public
 *
 * Lists public fundraising campaigns with live progress. No donor names, no internal IDs.
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
 * Access: Public (only if publicTransparency is enabled for the mosque; otherwise 404)
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
