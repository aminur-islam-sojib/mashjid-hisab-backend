// ---------------------------------------------------------------------------
// Mosque Router
// ---------------------------------------------------------------------------

import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireMosqueMembership } from "../../middlewares/mosque.middleware.js";
import { Role } from "../../../generated/prisma/client.js";
import membershipRouter from "../membership/membership.routes.js";
import fundRouter from "../fund/fund.routes.js";
import accountRouter from "../account/account.routes.js";
import categoryRouter from "../category/category.routes.js";
import familyRouter from "../family/family.routes.js";
import inviteLinkRouter from "../invite-link/invite-link.routes.js";
import donationRouter from "../donation/donation.routes.js";
import expenseRouter from "../expense/expense.routes.js";
import transferRouter from "../transfer/transfer.routes.js";
import transactionRouter from "../transaction/transaction.routes.js";
import campaignRouter from "../campaign/campaign.routes.js";
import pledgeRouter from "../pledge/pledge.routes.js";
import { chandaPlanRouter, dueRouter } from "../chanda/chanda.routes.js";
import collectionRouter from "../collection/collection.routes.js";
import meRouter from "../me/me.routes.js";
import { reportRouter, periodRouter } from "../report/report.routes.js";
import attachmentRouter from "../attachment/attachment.routes.js";
import auditRouter from "../audit/audit.routes.js";
import { publicTransparencyRouter } from "../transparency/transparency.routes.js";
import {
  createMosqueHandler,
  getUserMosquesHandler,
  getMosqueSettingsHandler,
  updateMosqueHandler,
  archiveMosqueHandler,
  getPublicMosqueBySlugHandler,
} from "./mosque.controller.js";

const mosqueRouter: Router = Router();

/**
 * GET /api/mosques
 * Access: Authenticated
 *
 * Lists every mosque the caller has an ACTIVE Membership in — powers the mosque switcher.
 */
mosqueRouter.get("/", authenticate, getUserMosquesHandler);


/**
 * /api/mosques/:mosqueId/members
 * Delegated to Membership Router (members listing, role/status updates, etc.)
 */
mosqueRouter.use("/:mosqueId/members", membershipRouter);

/**
 * /api/mosques/:mosqueId/funds
 * Delegated to Fund Router (fund listing, fund creation, etc.)
 */
mosqueRouter.use("/:mosqueId/funds", fundRouter);

/**
 * /api/mosques/:mosqueId/accounts
 * Delegated to Account Router (account creation, details, etc.)
 */
mosqueRouter.use("/:mosqueId/accounts", accountRouter);

/**
 * /api/mosques/:mosqueId/categories
 * Delegated to Category Router (category creation, details, etc.)
 */
mosqueRouter.use("/:mosqueId/categories", categoryRouter);

/**
 * /api/mosques/:mosqueId/families
 * Delegated to Family Router (household creation, members, headship transfer, etc.)
 */
mosqueRouter.use("/:mosqueId/families", familyRouter);

/**
 * /api/mosques/:mosqueId/invite-links
 * Delegated to Invite Link Router (admin-managed invite links generation, listing, etc.)
 */
mosqueRouter.use("/:mosqueId/invite-links", inviteLinkRouter);

/**
 * /api/mosques/:mosqueId/donations
 * Delegated to Donation Router (donation recording, listing, etc.)
 */
mosqueRouter.use("/:mosqueId/donations", donationRouter);

/**
 * /api/mosques/:mosqueId/expenses
 * Delegated to Expense Router (disbursements, approvals, etc.)
 */
mosqueRouter.use("/:mosqueId/expenses", expenseRouter);

/**
 * /api/mosques/:mosqueId/transfers
 * Delegated to Transfer Router (account & fund transfers)
 */
mosqueRouter.use("/:mosqueId/transfers", transferRouter);

/**
 * /api/mosques/:mosqueId/transactions
 * Delegated to Transaction Router (unified ledger & approvals)
 */
mosqueRouter.use("/:mosqueId/transactions", transactionRouter);

/**
 * /api/mosques/:mosqueId/campaigns
 * Delegated to Campaign Router (fundraising campaigns)
 */
mosqueRouter.use("/:mosqueId/campaigns", campaignRouter);

/**
 * /api/mosques/:mosqueId/pledges
 * Delegated to Pledge Router (member commitments)
 */
mosqueRouter.use("/:mosqueId/pledges", pledgeRouter);

/**
 * /api/mosques/:mosqueId/chanda-plans
 * Delegated to Chanda Plan Router (recurring chanda plans)
 */
mosqueRouter.use("/:mosqueId/chanda-plans", chandaPlanRouter);

/**
 * /api/mosques/:mosqueId/dues
 * Delegated to Due Router (monthly chanda dues & collections)
 */
mosqueRouter.use("/:mosqueId/dues", dueRouter);

/**
 * /api/mosques/:mosqueId/collections
 * Delegated to Collection Router (counting sessions & box collections)
 */
mosqueRouter.use("/:mosqueId/collections", collectionRouter);

/**
 * /api/mosques/:mosqueId/me
 * Delegated to Member Self-Service Router (donations, dues, pledges, annual statements)
 */
mosqueRouter.use("/:mosqueId/me", meRouter);

/**
 * /api/mosques/:mosqueId/reports
 * Delegated to Report Router (dashboard, balances, statements, donors, exports)
 */
mosqueRouter.use("/:mosqueId/reports", reportRouter);

/**
 * /api/mosques/:mosqueId/periods
 * Delegated to Period Router (accounting period lock & reopen)
 */
mosqueRouter.use("/:mosqueId/periods", periodRouter);

/**
 * /api/mosques/:mosqueId/attachments
 * Delegated to Attachment Router (upload, view, signed download links)
 */
mosqueRouter.use("/:mosqueId/attachments", attachmentRouter);

/**
 * /api/mosques/:mosqueId/audit-logs
 * Delegated to Audit Router (compliance audit logs)
 */
mosqueRouter.use("/:mosqueId/audit-logs", auditRouter);

/**
 * GET /api/mosques/:mosqueId
 * Access: Authenticated + any role in that mosque
 *
 * Full mosque settings (name, address, timezone, fiscalYearStart).
 * 404s (not 403) if the caller has no Membership there — don't reveal the mosque exists.
 */
mosqueRouter.get(
  "/:mosqueId",
  authenticate,
  requireMosqueMembership(),
  getMosqueSettingsHandler,
);

/**
 * PATCH /api/mosques/:mosqueId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Updates name/address/timezone/fiscalYearStart.
 * Changing fiscalYearStart mid-year requires explicit confirmation ('confirmFiscalYearChange: true').
 */
mosqueRouter.patch(
  "/:mosqueId",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  updateMosqueHandler,
);

/**
 * POST /api/mosques/:mosqueId/archive
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Soft-deletes the mosque (sets isArchived: true).
 * Blocks if there are unresolved pending invites or active accounts with non-zero balance.
 */
mosqueRouter.post(
  "/:mosqueId/archive",
  authenticate,
  requireMosqueMembership(Role.MOSQUE_ADMIN),
  archiveMosqueHandler,
);

/**
 * POST /api/mosques
 * Access: Authenticated
 *
 * Creates the Mosque, then in the same database transaction creates a Membership
 * for the caller with role: MOSQUE_ADMIN, status: ACTIVE.
 * This is the only way a new tenant comes into existence.
 */
mosqueRouter.post("/", authenticate, createMosqueHandler);

// ---------------------------------------------------------------------------
// Public Mosque Router — Unauthenticated Public Record Endpoints
// ---------------------------------------------------------------------------
const publicMosqueRouter: Router = Router();

// Mount public transparency and campaign sub-routes
publicMosqueRouter.use("/", publicTransparencyRouter);

/**
 * GET /api/public/mosques/:slug
 * Access: Public
 *
 * Minimal public record for the transparency page: name, address, donation-progress summary later.
 * No internal IDs, no account numbers, no member list.
 */
publicMosqueRouter.get("/:slug", getPublicMosqueBySlugHandler);

export { publicMosqueRouter };
export default mosqueRouter;
