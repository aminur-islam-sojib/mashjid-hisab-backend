// ---------------------------------------------------------------------------
// User Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import {
  updateMyProfile,
  updateUserStatusHandler,
} from "./user.controller.js";
import {
  authenticate,
  requireSuperAdmin,
} from "../../middlewares/auth.middleware.js";

const userRouter: Router = Router();

/**
 * PATCH /api/users/me/profile
 * Authenticated — updates personal profile data only (name, avatar, phone, bio, locale, address).
 * Strictly forbids mosqueId and role modifications.
 */
userRouter.patch("/me/profile", authenticate, updateMyProfile);

/**
 * PATCH /api/users/:userId/status
 * Super Admin only — modifies platform user status (ACTIVE, INACTIVE, BLOCKED).
 * Re-verifies live Super Admin role on every request; instantly invalidates sessions upon block/deactivation.
 */
userRouter.patch(
  "/:userId/status",
  authenticate,
  requireSuperAdmin,
  updateUserStatusHandler,
);

export default userRouter;
