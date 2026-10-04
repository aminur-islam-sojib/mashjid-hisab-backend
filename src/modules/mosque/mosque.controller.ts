// ---------------------------------------------------------------------------
// Mosque Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateCreateMosqueInput,
  validateGetUserMosquesQuery,
  validateMosqueIdParam,
} from "./mosque.validation.js";
import {
  createMosque,
  getUserMosques,
  getMosqueSettings,
} from "./mosque.service.js";

/**
 * POST /api/mosques
 * Access: Authenticated
 *
 * Creates the Mosque and in the same atomic transaction creates a Membership
 * for the caller with role: MOSQUE_ADMIN and status: ACTIVE.
 */
export const createMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const input = validateCreateMosqueInput(req.body);

    const result = await createMosque(userId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Mosque created successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques
 * Access: Authenticated
 *
 * Lists every mosque the caller has an ACTIVE Membership in — powers the mosque switcher.
 */
export const getUserMosquesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const currentMosqueId = req.user?.mosqueId ?? null;
    const query = validateGetUserMosquesQuery(req.query);

    const mosques = await getUserMosques(userId, {
      currentMosqueId,
      search: query.search,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Mosques retrieved successfully.",
      data: mosques,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId
 * Access: Authenticated + any role in that mosque
 *
 * Returns full mosque settings (name, address, timezone, fiscalYearStart).
 * 404s (not 403) if the caller has no ACTIVE membership there — prevents tenant enumeration.
 */
export const getMosqueSettingsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const mosqueId = validateMosqueIdParam(req.params["mosqueId"]);

    const mosqueSettings = await getMosqueSettings(userId, mosqueId);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque settings retrieved successfully.",
      data: mosqueSettings,
    });
  },
);
