// =============================================================================
// me.controller.ts — HTTP Controller for Domain 9: Member Self-Service
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateGetMyDonationsQuery,
  validateGetMyDuesQuery,
  validateGetMyPledgesQuery,
  validateGetMyStatementQuery,
} from "./me.validation.js";
import {
  getMyDonations,
  getMyDues,
  getMyPledges,
  getMyStatement,
} from "./me.service.js";

function resolveMosqueId(req: Request): string {
  const mosqueId =
    req.mosqueId ||
    (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
    (typeof req.query["mosqueId"] === "string"
      ? validateMosqueIdParam(req.query["mosqueId"])
      : undefined) ||
    (typeof (req.body as Record<string, unknown>)?.["mosqueId"] === "string"
      ? validateMosqueIdParam((req.body as Record<string, unknown>)["mosqueId"] as string)
      : undefined);

  if (!mosqueId) {
    throw HttpError.badRequest(
      "Missing target mosqueId parameter or query field.",
      "MISSING_MOSQUE_ID",
    );
  }
  return mosqueId;
}

/**
 * GET /me/donations and GET /mosques/:mosqueId/me/donations
 * Access: Any ACTIVE member
 * The caller's own donations. A family head also sees family donations (?scope=family).
 */
export const getMyDonationsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetMyDonationsQuery(req.query);

    const result = await getMyDonations(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership!.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Personal donations retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /me/dues and GET /mosques/:mosqueId/me/dues
 * Access: Any ACTIVE member
 * Own or family dues with status and what is owed.
 */
export const getMyDuesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetMyDuesQuery(req.query);

    const result = await getMyDues(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership!.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Personal dues retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /me/pledges and GET /mosques/:mosqueId/me/pledges
 * Access: Any ACTIVE member
 * Own pledges and progress.
 */
export const getMyPledgesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetMyPledgesQuery(req.query);

    const result = await getMyPledges(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership!.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Personal pledges retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /me/statement?year= and GET /mosques/:mosqueId/me/statement?year=
 * Access: Any ACTIVE member
 * Annual giving statement (totals per fund) for personal records.
 */
export const getMyStatementHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetMyStatementQuery(req.query);

    const result = await getMyStatement(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership!.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Annual giving statement generated successfully.",
      data: result,
    });
  },
);

