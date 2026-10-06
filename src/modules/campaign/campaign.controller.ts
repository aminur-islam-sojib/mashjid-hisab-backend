// =============================================================================
// Campaign Controller — HTTP Adapter Layer
//
// Thin HTTP-to-service adapters following the project's controller conventions:
//  • catchAsync wraps every handler — no try/catch boilerplate.
//  • Mosque ID resolution: URL param → req.mosqueId (set by middleware) → body.
//  • req.user and req.membership are guaranteed non-null by the upstream
//    requireMosqueMembership middleware.
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateCampaignInput,
  validateUpdateCampaignInput,
  validateCloseCampaignInput,
  validateGetCampaignsQuery,
  validateCampaignIdParam,
} from "./campaign.validation.js";
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  getCampaignDonors,
  updateCampaign,
  closeCampaign,
} from "./campaign.service.js";

// ---------------------------------------------------------------------------
// Shared mosque ID resolver used by every handler in this controller.
// Priority: URL param (/:mosqueId) → req.mosqueId (set by middleware) → body.
// ---------------------------------------------------------------------------
function resolveMosqueId(req: Request): string {
  const mosqueId =
    req.mosqueId ||
    (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
    (typeof (req.body as Record<string, unknown>)?.["mosqueId"] === "string"
      ? validateMosqueIdParam((req.body as Record<string, unknown>)["mosqueId"] as string)
      : undefined) ||
    (typeof req.query["mosqueId"] === "string"
      ? validateMosqueIdParam(req.query["mosqueId"])
      : undefined);

  if (!mosqueId) {
    throw HttpError.badRequest(
      "Missing target mosqueId parameter or body field.",
      "MISSING_MOSQUE_ID",
    );
  }
  return mosqueId;
}

// ---------------------------------------------------------------------------
// POST /api/mosques/:mosqueId/campaigns  |  POST /api/campaigns
// ---------------------------------------------------------------------------

/**
 * Creates a new fundraising campaign.
 * Access: MOSQUE_ADMIN only.
 */
export const createCampaignHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const input = validateCreateCampaignInput(req.body);
    const mosqueId = resolveMosqueId(req);

    const campaign = await createCampaign(mosqueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
    });

    sendResponse(res, {
      statusCode: 201,
      message: "Campaign created successfully.",
      data: campaign,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/mosques/:mosqueId/campaigns  |  GET /api/campaigns
// ---------------------------------------------------------------------------

/**
 * Lists campaigns for the mosque with filters and pagination.
 * Access: Any ACTIVE member. Non-oversight roles see only public campaigns.
 */
export const getCampaignsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetCampaignsQuery(req.query);

    const result = await getCampaigns(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Campaigns retrieved successfully.",
      data: result,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/mosques/:mosqueId/campaigns/:campaignId  |  GET /api/campaigns/:id
// ---------------------------------------------------------------------------

/**
 * Full campaign detail with live progress.
 * Access: Any ACTIVE member. Non-oversight roles are blocked (404) from non-public campaigns.
 */
export const getCampaignByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const campaignId = validateCampaignIdParam(
      req.params["campaignId"] || req.params["id"],
    );

    const campaign = await getCampaignById(mosqueId, campaignId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Campaign retrieved successfully.",
      data: campaign,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/mosques/:mosqueId/campaigns/:campaignId/donors
// ---------------------------------------------------------------------------

/**
 * Aggregated donor list with totals for a campaign.
 * Access: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER.
 * Anonymous donors are hidden from COMMITTEE_MEMBER but visible to ADMIN/TREAS.
 */
export const getCampaignDonorsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const campaignId = validateCampaignIdParam(
      req.params["campaignId"] || req.params["id"],
    );

    // Parse optional pagination from query
    const page = req.query["page"] ? Number(req.query["page"]) : undefined;
    const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;

    const result = await getCampaignDonors(
      mosqueId,
      campaignId,
      {
        userId: req.user!.sub,
        role: req.membership!.role,
        membershipId: req.membership?.id,
      },
      { page, limit },
    );

    sendResponse(res, {
      statusCode: 200,
      message: "Campaign donor list retrieved successfully.",
      data: result,
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/mosques/:mosqueId/campaigns/:campaignId
// ---------------------------------------------------------------------------

/**
 * Updates campaign metadata (title, description, target, dates, visibility).
 * Access: MOSQUE_ADMIN only.
 * Changing the fund after donations are linked is blocked (CAMPAIGN_FUND_LOCKED).
 */
export const updateCampaignHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const campaignId = validateCampaignIdParam(
      req.params["campaignId"] || req.params["id"],
    );
    const input = validateUpdateCampaignInput(req.body);

    const campaign = await updateCampaign(mosqueId, campaignId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Campaign updated successfully.",
      data: campaign,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/mosques/:mosqueId/campaigns/:campaignId/close
// ---------------------------------------------------------------------------

/**
 * Closes a campaign, stopping new donations and freezing the final summary.
 * Access: MOSQUE_ADMIN only.
 * Already-closed campaigns return 409 CAMPAIGN_ALREADY_CLOSED.
 */
export const closeCampaignHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const campaignId = validateCampaignIdParam(
      req.params["campaignId"] || req.params["id"],
    );
    const input = validateCloseCampaignInput(req.body);

    const campaign = await closeCampaign(mosqueId, campaignId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Campaign closed successfully. No further donations will be accepted.",
      data: campaign,
    });
  },
);

