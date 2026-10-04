// ---------------------------------------------------------------------------
// Mosque Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateCreateMosqueInput } from "./mosque.validation.js";
import { createMosque } from "./mosque.service.js";

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
