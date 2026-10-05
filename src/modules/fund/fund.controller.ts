// ---------------------------------------------------------------------------
// Fund Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateFundInput,
  validateGetMosqueFundsQuery,
} from "./fund.validation.js";
import {
  createFund,
  getMosqueFunds,
} from "./fund.service.js";

/**
 * POST /api/mosques/:mosqueId/funds
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Creates a Fund (name, type, isRestricted).
 */
export const createFundHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const input = validateCreateFundInput(req.body);

    const fund = await createFund(mosqueId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Fund created successfully.",
      data: fund,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/funds
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists active Funds. Pass ?includeArchived=true for the settings screen.
 */
export const getMosqueFundsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueFundsQuery(req.query);

    const funds = await getMosqueFunds(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Funds retrieved successfully.",
      data: funds,
    });
  },
);
