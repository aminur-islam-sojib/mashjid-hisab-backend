// ---------------------------------------------------------------------------
// Expense Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { ExpenseStatus } from "../../../generated/prisma/client.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import { validateCreateExpenseInput } from "./expense.validation.js";
import { createExpense } from "./expense.service.js";

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

