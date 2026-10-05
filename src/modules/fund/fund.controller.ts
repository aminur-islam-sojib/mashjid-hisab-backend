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
  validateFundIdParam,
  validateUpdateFundInput,
} from "./fund.validation.js";
import {
  createFund,
  getMosqueFunds,
  getFundById,
  updateFund,
  archiveFund,
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

/**
 * GET /api/mosques/:mosqueId/funds/:fundId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Retrieves a single Fund by its ID.
 */
export const getFundByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const fundId = validateFundIdParam(req.params["fundId"]);

    const fund = await getFundById(mosqueId, fundId);

    sendResponse(res, {
      statusCode: 200,
      message: "Fund retrieved successfully.",
      data: fund,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/funds/:fundId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Updates name/description/isRestricted.
 * Flipping isRestricted on a Fund that already has transactions requires explicit confirmation.
 */
export const updateFundHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const fundId = validateFundIdParam(req.params["fundId"]);
    const input = validateUpdateFundInput(req.body);

    const fund = await updateFund(mosqueId, fundId, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Fund updated successfully.",
      data: fund,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/funds/:fundId/archive
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Soft-deletes the fund (sets isArchived: true).
 * Blocks if the fund has a non-zero balance.
 */
export const archiveFundHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const fundId = validateFundIdParam(req.params["fundId"]);

    const fund = await archiveFund(mosqueId, fundId);

    sendResponse(res, {
      statusCode: 200,
      message: "Fund archived successfully.",
      data: fund,
    });
  },
);


