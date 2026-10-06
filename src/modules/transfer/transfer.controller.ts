// ---------------------------------------------------------------------------
// Transfer Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateTransferInput,
  validateGetMosqueTransfersQuery,
  validateTransferIdParam,
  validateVoidTransferInput,
} from "./transfer.validation.js";
import {
  createTransfer,
  getMosqueTransfers,
  getTransferById,
  voidTransfer,
} from "./transfer.service.js";

/**
 * POST /api/mosques/:mosqueId/transfers AND POST /api/transfers
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 * Note: Fund-to-fund transfers require MOSQUE_ADMIN role and a reason.
 *
 * Moves money between accounts within one fund or between funds.
 * Creates two linked entries atomically.
 */
export const createTransferHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const input = validateCreateTransferInput(req.body);

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

    const transfer = await createTransfer(mosqueId, input, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    const message = transfer.isFundTransfer
      ? "Fund-to-fund transfer executed successfully."
      : "Account transfer executed successfully.";

    sendResponse(res, {
      statusCode: 201,
      message,
      data: transfer,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/transfers AND GET /api/transfers
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists transfers as linked pairs with pagination and filters.
 */
export const getMosqueTransfersHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const query = validateGetMosqueTransfersQuery(req.query);

    const result = await getMosqueTransfers(mosqueId, query, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transfers retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/transfers/:id AND GET /api/transfers/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Full detail of a transfer linked pair.
 */
export const getTransferByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const transferId = validateTransferIdParam(req.params["id"] || req.params["transferId"]);

    const transfer = await getTransferById(mosqueId, transferId, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transfer retrieved successfully.",
      data: transfer,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/transfers/:id/void AND POST /api/transfers/:id/void
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Requires reason. Reverses both legs together atomically and restores balances.
 */
export const voidTransferHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const transferId = validateTransferIdParam(req.params["id"] || req.params["transferId"]);
    const input = validateVoidTransferInput(req.body);

    const result = await voidTransfer(mosqueId, transferId, input.reason, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transfer voided successfully and both legs reversed.",
      data: result,
    });
  },
);
