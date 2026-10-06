// ---------------------------------------------------------------------------
// Root API router — mounts every module router under /api.
// Add new module routers here as the application grows.
// ---------------------------------------------------------------------------

import { Router } from "express";
import authRouter from "../modules/auth/auth.routes.js";
import userRouter from "../modules/user/user.routes.js";
import mosqueRouter, {
  publicMosqueRouter,
} from "../modules/mosque/mosque.routes.js";
import membershipRouter from "../modules/membership/membership.routes.js";
import donationRouter from "../modules/donation/donation.routes.js";
import expenseRouter from "../modules/expense/expense.routes.js";
import transferRouter from "../modules/transfer/transfer.routes.js";
import transactionRouter from "../modules/transaction/transaction.routes.js";
import campaignRouter from "../modules/campaign/campaign.routes.js";
import pledgeRouter from "../modules/pledge/pledge.routes.js";
import { chandaPlanRouter, dueRouter } from "../modules/chanda/chanda.routes.js";
import { publicInviteLinkRouter } from "../modules/invite-link/invite-link.routes.js";

const apiRouter: Router = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/mosques", mosqueRouter);
apiRouter.use("/memberships", membershipRouter);
apiRouter.use("/donations", donationRouter);
apiRouter.use("/expenses", expenseRouter);
apiRouter.use("/transfers", transferRouter);
apiRouter.use("/transactions", transactionRouter);
apiRouter.use("/campaigns", campaignRouter);
apiRouter.use("/pledges", pledgeRouter);
apiRouter.use("/chanda-plans", chandaPlanRouter);
apiRouter.use("/dues", dueRouter);

// Public routes (transparency, public mosque profile, donation summaries, invite links)
const publicRouter: Router = Router();
publicRouter.use("/mosques", publicMosqueRouter);
publicRouter.use("/invite-links", publicInviteLinkRouter);
apiRouter.use("/public", publicRouter);

export default apiRouter;
