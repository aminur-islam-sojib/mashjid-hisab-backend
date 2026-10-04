// ---------------------------------------------------------------------------
// Mosque Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateCreateMosqueInput,
  validateGetUserMosquesQuery,
} from "./mosque.validation.js";
import { createMosque, getUserMosques } from "./mosque.service.js";

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
