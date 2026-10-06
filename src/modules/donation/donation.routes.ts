// ---------------------------------------------------------------------------
// Donation Router — Income & Collections Routing
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  COLLECTION_OPERATOR_ROLES,
  OVERSIGHT_ROLES,
  FINANCIAL_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createDonationHandler,
  getDonationByIdHandler,
  getDonationReceiptHandler,
  getMosqueDonationsHandler,
  voidDonationHandler,
  updateDonationHandler,
} from "./donation.controller.js";

const donationRouter: Router = Router({ mergeParams: true });

/**
 * POST /api/mosques/:mosqueId/donations AND POST /api/donations
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (post immediately) | STAFF (saved as PENDING)
 *
 * Records income.
 */
donationRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...COLLECTION_OPERATOR_ROLES),
  createDonationHandler,
);

/**
 * GET /api/mosques/:mosqueId/donations AND GET /api/donations
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Paginated list of donations. Filters: donor, family, fund, campaign, date range, status, source.
 */
donationRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getMosqueDonationsHandler,
);

/**
 * GET /api/mosques/:mosqueId/donations/:donationId AND GET /api/donations/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER; MEMBER (own or own family only)
 *
 * Full detail with receipt number, attachments, and void info.
 */
donationRouter.get(
  "/:donationId",
  authenticate,
  requireMosqueMembership(),
  getDonationByIdHandler,
);

/**
 * GET /api/mosques/:mosqueId/donations/:donationId/receipt AND GET /api/donations/:id/receipt
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER; MEMBER (own only)
 *
 * Returns receipt data (mosque, donor, amount, fund, receipt no., verification code)
 * for the client to render or print.
 */
donationRouter.get(
  "/:donationId/receipt",
  authenticate,
  requireMosqueMembership(),
  getDonationReceiptHandler,
);

/**
 * PATCH /api/mosques/:mosqueId/donations/:donationId AND PATCH /api/donations/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Edits only non-financial fields (notes, donor name, attachments).
 * Financial fields (amount, fund, account, date) are rejected with TRANSACTION_IMMUTABLE.
 */
donationRouter.patch(
  "/:donationId",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  updateDonationHandler,
);

/**
 * POST /api/mosques/:mosqueId/donations/:donationId/void
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Voids a posted donation entry.
 */
donationRouter.post(
  "/:donationId/void",
  authenticate,
  requireMosqueMembership(...FINANCIAL_OPERATOR_ROLES),
  voidDonationHandler,
);

export default donationRouter;

