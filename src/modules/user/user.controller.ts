// ---------------------------------------------------------------------------
// User Controller — thin HTTP adapter
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateUpdateProfileInput } from "./user.validation.js";
import { updateUserProfile } from "./user.service.js";

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
