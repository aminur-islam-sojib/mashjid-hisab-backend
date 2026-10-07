// =============================================================================
// Transparency Router — Public Transparency & Verification Routes
// =============================================================================

import { Router } from "express";
import { createRateLimiter } from "../../middlewares/rateLimiter.middleware.js";
import {
  getPublicCampaignsHandler,
  getPublicCampaignDetailsHandler,
  getPublicMosqueTransparencyHandler,
  verifyDonationReceiptHandler,
} from "./transparency.controller.js";

// ---------------------------------------------------------------------------
// Public Receipt Verification Router
// Mounted at /api/public/receipts
// ---------------------------------------------------------------------------
const publicReceiptRouter: Router = Router();

// Rate limit: 30 verification checks per minute per IP to protect against enumeration attacks
const receiptVerificationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many receipt verification requests. Please try again after one minute.",
});

/**
 * GET /api/public/receipts/:verificationCode
 * Access: Public (Rate-limited)
 *
 * Verifies authenticity of a donation receipt.
 */
publicReceiptRouter.get(
  "/:verificationCode",
  receiptVerificationRateLimiter,
  verifyDonationReceiptHandler,
);

// ---------------------------------------------------------------------------
// Public Mosque Transparency Extension Router
// Mounted under /api/public/mosques
// ---------------------------------------------------------------------------
const publicTransparencyRouter: Router = Router();

/**
 * GET /api/public/mosques/:slug/campaigns
 * Access: Public
 *
 * Lists all public campaigns with target and raised totals.
 */
publicTransparencyRouter.get("/:slug/campaigns", getPublicCampaignsHandler);

/**
 * GET /api/public/mosques/:slug/campaigns/:campaignId
 * Access: Public
 *
 * One campaign's progress. Anonymous-flagged donors are never shown.
 */
publicTransparencyRouter.get(
  "/:slug/campaigns/:campaignId",
  getPublicCampaignDetailsHandler,
);

/**
 * GET /api/public/mosques/:slug/transparency?month=
 * Access: Public (Gated by mosque.publicTransparency = true)
 *
 * Monthly totals of income and expense by fund and category. Totals only.
 */
publicTransparencyRouter.get(
  "/:slug/transparency",
  getPublicMosqueTransparencyHandler,
);

export {
  publicReceiptRouter,
  publicTransparencyRouter,
};

