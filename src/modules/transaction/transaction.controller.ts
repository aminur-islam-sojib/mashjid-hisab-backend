// ---------------------------------------------------------------------------
// Transaction Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateGetTransactionsQuery,
  validateGetPendingTransactionsQuery,
  validateTransactionIdParam,
  validateRejectTransactionInput,
} from "./transaction.validation.js";
import {
  getTransactions,
  getTransactionById,
  getPendingTransactions,
  approveTransaction,
  rejectTransaction,
} from "./transaction.service.js";

/**
 * GET /api/mosques/:mosqueId/transactions AND GET /api/transactions
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * The master ledger across income, expense, and transfers with cursor pagination.
 */
export const getTransactionsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const query = validateGetTransactionsQuery(req.query);

    const result = await getTransactions(mosqueId, query, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transactions retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/transactions/pending AND GET /api/transactions/pending
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * The approval queue: STAFF entries and over-limit expenses.
 */
export const getPendingTransactionsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const query = validateGetPendingTransactionsQuery(req.query);

    const result = await getPendingTransactions(mosqueId, query, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Pending transactions retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/transactions/:id AND GET /api/transactions/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Single entry with its full history (created, approved, voided, rejected).
 */
export const getTransactionByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const transactionId = validateTransactionIdParam(req.params["id"] || req.params["transactionId"]);

    const transaction = await getTransactionById(mosqueId, transactionId, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transaction retrieved successfully.",
      data: transaction,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/transactions/:id/approve AND POST /api/transactions/:id/approve
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (over-limit expenses: ADMIN only)
 *
 * Moves PENDING to POSTED and assigns receipt/voucher number.
 * Rejects with SELF_APPROVAL_NOT_ALLOWED if approver === creator.
 */
export const approveTransactionHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const transactionId = validateTransactionIdParam(req.params["id"] || req.params["transactionId"]);

    const approved = await approveTransaction(mosqueId, transactionId, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transaction approved and posted successfully.",
      data: approved,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/transactions/:id/reject AND POST /api/transactions/:id/reject
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Requires reason. Marks it REJECTED with no balance effect. Notifies the creator.
 */
export const rejectTransactionHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (typeof req.query["mosqueId"] === "string" ? validateMosqueIdParam(req.query["mosqueId"]) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest("Mosque ID is required.", "MISSING_MOSQUE_ID");
    }

    if (!req.user?.sub || !req.membership?.role) {
      throw HttpError.forbidden("Access denied.", "MEMBERSHIP_REQUIRED");
    }

    const transactionId = validateTransactionIdParam(req.params["id"] || req.params["transactionId"]);
    const input = validateRejectTransactionInput(req.body);

    const result = await rejectTransaction(mosqueId, transactionId, input, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Transaction rejected successfully.",
      data: result,
    });
  },
);

