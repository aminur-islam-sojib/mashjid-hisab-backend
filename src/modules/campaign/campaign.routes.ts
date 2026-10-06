// =============================================================================
// Campaign Router — Fundraising Campaign Routing
//
// Route precedence note:
//  • Static sub-paths (/:campaignId/donors, /:campaignId/close) MUST be
//    defined BEFORE the bare /:campaignId route to prevent Express from
//    consuming "donors" or "close" as an id parameter.
//
// Role matrix:
//  POST   /                     → MOSQUE_ADMIN
//  GET    /                     → any ACTIVE member (public-only for MEMBER/STAFF)
//  GET    /:campaignId           → any ACTIVE member (non-public 404 for MEMBER/STAFF)
//  GET    /:campaignId/donors    → MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
//  PATCH  /:campaignId           → MOSQUE_ADMIN
//  POST   /:campaignId/close     → MOSQUE_ADMIN
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  ADMIN_ONLY_ROLES,
  OVERSIGHT_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createCampaignHandler,
  getCampaignsHandler,
  getCampaignByIdHandler,
  getCampaignDonorsHandler,
  updateCampaignHandler,
  closeCampaignHandler,
} from "./campaign.controller.js";

const campaignRouter: Router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Collection routes
// ---------------------------------------------------------------------------

/**
 * POST /api/mosques/:mosqueId/campaigns  |  POST /api/campaigns
 * Access: MOSQUE_ADMIN only.
 *
 * Creates a campaign linked to a Fund.
 */
campaignRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  createCampaignHandler,
);

/**
 * GET /api/mosques/:mosqueId/campaigns  |  GET /api/campaigns
 * Access: Any ACTIVE member.
 *
 * Paginated list. Non-oversight roles see only public campaigns.
 * Filters: status, fundId, isPublic (oversight only), search, page, limit.
 */
campaignRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(),
  getCampaignsHandler,
);

// ---------------------------------------------------------------------------
// Item routes — static sub-paths BEFORE /:campaignId
// ---------------------------------------------------------------------------

/**
 * GET /api/mosques/:mosqueId/campaigns/:campaignId/donors
 * Access: MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER.
 *
 * Aggregated donor list with totals. Anonymous donors are hidden from
 * COMMITTEE_MEMBER; ADMIN and TREAS see all identity data.
 */
campaignRouter.get(
  "/:campaignId/donors",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getCampaignDonorsHandler,
);

/**
 * POST /api/mosques/:mosqueId/campaigns/:campaignId/close
 * Access: MOSQUE_ADMIN only.
 *
 * Stops new donations and freezes the final summary.
 * Already-closed campaigns return 409 CAMPAIGN_ALREADY_CLOSED.
 */
campaignRouter.post(
  "/:campaignId/close",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  closeCampaignHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/campaigns/:campaignId
 * Access: MOSQUE_ADMIN only.
 *
 * Updates title, description, targetAmount, startDate, endDate, isPublic.
 * Changing fundId after donations are linked is blocked (CAMPAIGN_FUND_LOCKED).
 * Closed campaigns are read-only (CAMPAIGN_ALREADY_CLOSED).
 */
campaignRouter.patch(
  "/:campaignId",
  authenticate,
  requireMosqueMembership(...ADMIN_ONLY_ROLES),
  updateCampaignHandler,
);

/**
 * GET /api/mosques/:mosqueId/campaigns/:campaignId
 * Access: Any ACTIVE member.
 *
 * Full detail with live progress. Non-public campaigns return 404 for
 * non-oversight roles (leaking non-existence is safe here by design).
 */
campaignRouter.get(
  "/:campaignId",
  authenticate,
  requireMosqueMembership(),
  getCampaignByIdHandler,
);

export default campaignRouter;

