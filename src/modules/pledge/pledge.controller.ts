// =============================================================================
// pledge.controller.ts — HTTP Handlers for Domain 6: Pledges
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreatePledgeInput,
  validateGetPledgesQuery,
  validateCancelPledgeInput,
  validatePledgeIdParam,
} from "./pledge.validation.js";
import {
  createPledge,
  getPledges,
  getPledgeById,
  cancelPledge,
} from "./pledge.service.js";

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

/**
 * POST /api/mosques/:mosqueId/pledges and POST /api/pledges
 * Access: MEMBER (for self or own family); ADMIN, TREAS (for anyone)
 */
export const createPledgeHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const input = validateCreatePledgeInput(req.body);

    const pledge = await createPledge(mosqueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 201,
      message: "Pledge commitment recorded successfully.",
      data: pledge,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/pledges and GET /api/pledges
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getPledgesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetPledgesQuery(req.query);

    const result = await getPledges(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Pledges retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/pledges/:id and GET /api/pledges/:id
 * Access: ADMIN, TREAS, COMM; MEMBER (own or own family only)
 */
export const getPledgeByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const pledgeId = validatePledgeIdParam(req.params["id"] || req.params["pledgeId"]);

    const pledge = await getPledgeById(mosqueId, pledgeId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Pledge record retrieved successfully.",
      data: pledge,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/pledges/:id/cancel and POST /api/pledges/:id/cancel
 * Access: Pledger or MOSQUE_ADMIN
 */
export const cancelPledgeHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const pledgeId = validatePledgeIdParam(req.params["id"] || req.params["pledgeId"]);
    const input = validateCancelPledgeInput(req.body);

    const pledge = await cancelPledge(mosqueId, pledgeId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Pledge cancelled successfully. Open balance has been cancelled.",
      data: pledge,
    });
  },
);

