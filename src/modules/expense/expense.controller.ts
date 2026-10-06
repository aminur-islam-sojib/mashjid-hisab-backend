// ---------------------------------------------------------------------------
// Expense Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { ExpenseStatus } from "../../../generated/prisma/client.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateExpenseInput,
  validateGetMosqueExpensesQuery,
  validateExpenseIdParam,
  validateUpdateExpenseInput,
} from "./expense.validation.js";
import {
  createExpense,
  getMosqueExpenses,
  getExpenseById,
  updateExpense,
} from "./expense.service.js";

/**
 * POST /api/mosques/:mosqueId/expenses AND POST /api/expenses
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER (posts); STAFF (PENDING)
 * Above approval limit -> PENDING_APPROVAL and needs ADMIN.
 *
 * Records spending with payee, voucherNo, and attachments (bill photo).
 */
export const createExpenseHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const input = validateCreateExpenseInput(req.body);

    const mosqueId =
      req.mosqueId ||
      (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
      (input.mosqueId ? validateMosqueIdParam(input.mosqueId) : undefined);

    if (!mosqueId) {
      throw HttpError.badRequest(
        "Missing target mosqueId parameter or body field.",
        "MISSING_MOSQUE_ID",
      );
    }

    if (!req.user?.sub) {
      throw HttpError.unauthorized("Authentication required.", "AUTH_UNAUTHORIZED");
    }

    if (!req.membership?.role) {
      throw HttpError.forbidden(
        "Active membership required in the target mosque.",
        "MEMBERSHIP_REQUIRED",
      );
    }

    const expense = await createExpense(mosqueId, input, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    let message = "Expense recorded successfully.";
    if (expense.status === ExpenseStatus.POSTED) {
      message = "Expense recorded and posted successfully.";
    } else if (expense.status === ExpenseStatus.PENDING_APPROVAL) {
      message = "Expense recorded and submitted for Admin approval (exceeds approval limit).";
    } else if (expense.status === ExpenseStatus.PENDING) {
      message = "Expense recorded as pending review.";
    }

    sendResponse(res, {
      statusCode: 201,
      message,
      data: expense,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/expenses AND GET /api/expenses
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Paginated list with the same filters as donations, plus payee.
 */
export const getMosqueExpensesHandler = catchAsync(
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

    const query = validateGetMosqueExpensesQuery(req.query);

    const result = await getMosqueExpenses(mosqueId, query, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Expenses retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/expenses/:id AND GET /api/expenses/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Full detail with attachments and approval trail.
 */
export const getExpenseByIdHandler = catchAsync(
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

    const expenseId = validateExpenseIdParam(req.params["id"] || req.params["expenseId"]);

    const expense = await getExpenseById(mosqueId, expenseId, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Expense details retrieved successfully.",
      data: expense,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/expenses/:id AND PATCH /api/expenses/:id
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Edits only non-financial fields (notes, payee, attachments).
 * Financial fields (amount, fund, account, date, category, voucher) are rejected with TRANSACTION_IMMUTABLE.
 */
export const updateExpenseHandler = catchAsync(
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

    const expenseId = validateExpenseIdParam(req.params["id"] || req.params["expenseId"]);
    const input = validateUpdateExpenseInput(req.body);

    const updated = await updateExpense(mosqueId, expenseId, input, {
      userId: req.user.sub,
      role: req.membership.role,
      membershipId: req.membership.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Expense record updated successfully.",
      data: updated,
    });
  },
);



