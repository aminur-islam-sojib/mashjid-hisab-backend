// ---------------------------------------------------------------------------
// Donation Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { DonationStatus } from "../../../generated/prisma/client.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateDonationInput,
  validateDonationIdParam,
  validateGetMosqueDonationsQuery,
} from "./donation.validation.js";
import {
  createDonation,
  getDonationById,
  getMosqueDonations,
} from "./donation.service.js";

/**
 * POST /api/mosques/:mosqueId/donations AND POST /api/donations
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (post immediately) | STAFF (saved as PENDING)
 *
 * Records income for a mosque.
 */
export const createDonationHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const input = validateCreateDonationInput(req.body);

    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (input.mosqueId ? validateMosqueIdParam(input.mosqueId) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest(
        "Missing target mosqueId parameter or body field.",
        "MISSING_MOSQUE_ID",
      );
    }

    if (!req.user?.sub) {
      throw HttpError.unauthorized("Authentication required.", "AUTH_UNAUTHORIZED");
    }

    if (!req.membership?.role) {
      throw HttpError.forbidden(
        "Active membership required in the target mosque.",
        "MEMBERSHIP_REQUIRED",
      );
    }

    const donation = await createDonation(mosqueId, input, {
      userId: req.user.sub,
      role: req.membership.role,
    });

    const message =
      donation.status === DonationStatus.POSTED
        ? "Donation recorded and posted successfully."
        : "Donation recorded as pending review.";

    sendResponse(res, {
      statusCode: 201,
      message,
      data: donation,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/donations/:donationId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Retrieves a single Donation record.
 */
export const getDonationByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const donationId = validateDonationIdParam(req.params["donationId"]);

    const donation = await getDonationById(mosqueId, donationId);

    sendResponse(res, {
      statusCode: 200,
      message: "Donation record retrieved successfully.",
      data: donation,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/donations
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Lists donations for a mosque with filters and pagination.
 */
export const getMosqueDonationsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueDonationsQuery(req.query);

    const result = await getMosqueDonations(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Donations retrieved successfully.",
      data: result,
    });
  },
);
