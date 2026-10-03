// ---------------------------------------------------------------------------
// User Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { updateMyProfile } from "./user.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const userRouter: Router = Router();

/**
 * PATCH /api/users/me/profile
 * Authenticated — updates personal profile data only (name, avatar, phone, bio, locale, address).
 * Strictly forbids mosqueId and role modifications.
 */
userRouter.patch("/me/profile", authenticate, updateMyProfile);

export default userRouter;
