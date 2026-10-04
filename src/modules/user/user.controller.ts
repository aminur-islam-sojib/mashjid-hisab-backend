// ---------------------------------------------------------------------------
// User Controller — thin HTTP adapter
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateUpdateProfileInput,
  validateUpdateUserStatusInput,
} from "./user.validation.js";
import { updateUserProfile, updateUserStatus } from "./user.service.js";
import { HttpError } from "../../errors/HttpError.js";

// ---------------------------------------------------------------------------
// PATCH /api/users/me/profile — 200 OK (Authenticated)
// Updates Profile fields only (name, avatar, phone, bio, locale, etc.)
// Never accepts mosqueId or role.
// ---------------------------------------------------------------------------
export const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const input = validateUpdateProfileInput(req.body);

  const updatedUser = await updateUserProfile(userId, input);

  sendResponse(res, {
    statusCode: 200,
    message: "Profile updated successfully.",
    data: {
      user: updatedUser,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:userId/status — 200 OK (Super Admin only)
// Updates target user's platform status (ACTIVE, INACTIVE, BLOCKED).
// Immediately invalidates sessions if deactivated or blocked.
// ---------------------------------------------------------------------------
export const updateUserStatusHandler = catchAsync(
  async (req: Request, res: Response) => {
    const callerUserId = req.user!.sub;
    const targetUserId = req.params["userId"] || req.params["id"];

    if (!targetUserId || typeof targetUserId !== "string") {
      throw HttpError.badRequest(
        "Route parameter userId is required.",
        "INVALID_USER_ID",
      );
    }

    const input = validateUpdateUserStatusInput(req.body);
    const updatedUser = await updateUserStatus(callerUserId, targetUserId, input);

    sendResponse(res, {
      statusCode: 200,
      message: `User status updated to ${input.status} successfully.`,
      data: {
        user: updatedUser,
      },
    });
  },
);

