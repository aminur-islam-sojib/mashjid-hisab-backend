// ---------------------------------------------------------------------------
// Account Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateAccountInput,
  validateAccountIdParam,
  validateGetMosqueAccountsQuery,
  validateUpdateAccountInput,
} from "./account.validation.js";
import {
  createAccount,
  getAccountById,
  getMosqueAccounts,
  updateAccount,
} from "./account.service.js";

/**
 * POST /api/mosques/:mosqueId/accounts
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Creates an Account (name, type, accountNumber, openingBalance).
 */
export const createAccountHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const input = validateCreateAccountInput(req.body);

    const account = await createAccount(mosqueId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Account created successfully.",
      data: account,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/accounts
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists active Accounts. Pass ?includeArchived=true for the settings screen.
 * Sensitive information (accountNumber) is included.
 */
export const getMosqueAccountsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueAccountsQuery(req.query);

    const accounts = await getMosqueAccounts(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Accounts retrieved successfully.",
      data: accounts,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/accounts/:accountId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Retrieves a single Account by its ID.
 */
export const getAccountByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const accountId = validateAccountIdParam(req.params["accountId"]);

    const account = await getAccountById(mosqueId, accountId);

    sendResponse(res, {
      statusCode: 200,
      message: "Account retrieved successfully.",
      data: account,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/accounts/:accountId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Updates name/type/accountNumber.
 * Never updates openingBalance after the account has any transactions.
 */
export const updateAccountHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const accountId = validateAccountIdParam(req.params["accountId"]);
    const input = validateUpdateAccountInput(req.body);

    const account = await updateAccount(mosqueId, accountId, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Account updated successfully.",
      data: account,
    });
  },
);

