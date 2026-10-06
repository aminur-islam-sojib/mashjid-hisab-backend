// ---------------------------------------------------------------------------
// Donation Router — Income & Collections Routing
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  COLLECTION_OPERATOR_ROLES,
  OPERATIONAL_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  createDonationHandler,
  getDonationByIdHandler,
  getMosqueDonationsHandler,
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
 * GET /api/mosques/:mosqueId/donations
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Lists donations for a mosque.
 */
donationRouter.get(
  "/",
  authenticate,
  requireMosqueMembership(...OPERATIONAL_ROLES),
  getMosqueDonationsHandler,
);

/**
 * GET /api/mosques/:mosqueId/donations/:donationId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Retrieves a single donation record.
 */
donationRouter.get(
  "/:donationId",
  authenticate,
  requireMosqueMembership(...OPERATIONAL_ROLES),
  getDonationByIdHandler,
);

export default donationRouter;

