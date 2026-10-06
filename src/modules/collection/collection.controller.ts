// =============================================================================
// collection.controller.ts — HTTP Controller for Domain 8: Collection Sessions
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateCollectionSessionInput,
  validateVerifyCollectionSessionInput,
  validateGetCollectionsQuery,
  validateCollectionIdParam,
} from "./collection.validation.js";
import {
  createCollectionSession,
  verifyCollectionSession,
  getCollections,
  getCollectionById,
} from "./collection.service.js";

// ---------------------------------------------------------------------------
// Shared mosque ID resolver used by every handler in this controller.
// Priority: URL param (/:mosqueId) → req.mosqueId (set by middleware) → body/query.
// ---------------------------------------------------------------------------
function resolveMosqueId(req: Request): string {
  const mosqueId =
    req.mosqueId ||
    (req.params["mosqueId"] ? validateMosqueIdParam(req.params["mosqueId"]) : undefined) ||
    (typeof (req.body as Record<string, unknown>)?.["mosqueId"] === "string"
      ? validateMosqueIdParam((req.body as Record<string, unknown>)["mosqueId"] as string)
      : undefined) ||
    (typeof req.query["mosqueId"] === "string"
      ? validateMosqueIdParam(req.query["mosqueId"])
      : undefined);

  if (!mosqueId) {
    throw HttpError.badRequest(
      "Missing target mosqueId parameter or body field.",
      "MISSING_MOSQUE_ID",
    );
  }
  return mosqueId;
}

/**
 * POST /api/mosques/:mosqueId/collections and POST /api/collections
 * Access: ADMIN, TREAS, STAFF
 * Starts a counting session: occasion, date, counted totalAmount, notes. Status is OPEN.
 */
export const createCollectionSessionHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const input = validateCreateCollectionSessionInput(req.body);

    const session = await createCollectionSession(mosqueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 201,
      message: "Collection counting session started successfully.",
      data: session,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/collections/:id/verify and POST /api/collections/:id/verify
 * Access: ADMIN, TREAS (a second person, not the counter)
 * Confirms the count. Posts one anonymous income entry to chosen fund and account.
 */
export const verifyCollectionSessionHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const collectionId = validateCollectionIdParam(req.params["id"] || req.params["collectionId"]);
    const input = validateVerifyCollectionSessionInput(req.body);

    const session = await verifyCollectionSession(mosqueId, collectionId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Collection count verified and income entry posted successfully.",
      data: session,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/collections and GET /api/collections
 * Access: ADMIN, TREAS, COMM
 * History of counts with who counted and who verified.
 */
export const getCollectionsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetCollectionsQuery(req.query);

    const result = await getCollections(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Collection sessions retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/collections/:id and GET /api/collections/:id
 * Access: ADMIN, TREAS, COMM
 * Single collection session detail.
 */
export const getCollectionByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const collectionId = validateCollectionIdParam(req.params["id"] || req.params["collectionId"]);

    const session = await getCollectionById(mosqueId, collectionId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Collection session retrieved successfully.",
      data: session,
    });
  },
);

