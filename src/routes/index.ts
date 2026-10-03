// ---------------------------------------------------------------------------
// Root API router — mounts every module router under /api.
// Add new module routers here as the application grows.
// ---------------------------------------------------------------------------

import { Router } from "express";
import authRouter from "../modules/auth/auth.routes.js";

const apiRouter: Router = Router();

apiRouter.use("/auth", authRouter);

// future: apiRouter.use("/mosques", mosqueRouter);
// future: apiRouter.use("/members", memberRouter);

export default apiRouter;
