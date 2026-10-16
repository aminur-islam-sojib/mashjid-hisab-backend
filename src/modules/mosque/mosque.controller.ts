// ---------------------------------------------------------------------------
// Mosque Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateCreateMosqueInput,
  validateGetUserMosquesQuery,
  validateMosqueIdParam,
  validateMosqueSlugParam,
  validateUpdateMosqueInput,
  validateRequestMosqueArchiveInput,
} from "./mosque.validation.js";
import {
  createMosque,
  getUserMosques,
  getMosqueMembers,
  getMosqueSettings,
  updateMosque,
  archiveMosque,
  unarchiveMosque,
  requestMosqueArchive,
  cancelMosqueArchiveRequest,
  rejectMosqueArchiveRequest,
  getPendingArchiveRequests,
  getPublicMosqueBySlug,
} from "./mosque.service.js";

/**
 * POST /api/mosques
 * Access: Authenticated
 *
 * Creates the Mosque and in the same atomic transaction creates a Membership
 * for the caller with role: MOSQUE_ADMIN and status: ACTIVE.
 */
export const createMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const input = validateCreateMosqueInput(req.body);

    const result = await createMosque(userId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Mosque created successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques
 * Access: Authenticated
 *
 * Lists every mosque the caller has an ACTIVE Membership in — powers the mosque switcher.
 */
export const getUserMosquesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const currentMosqueId = req.user?.mosqueId ?? null;
    const query = validateGetUserMosquesQuery(req.query);

    const mosques = await getUserMosques(userId, {
      currentMosqueId,
      search: query.search,
      includeArchived: query.includeArchived,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Mosques retrieved successfully.",
      data: mosques,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId
 * Access: Authenticated + any role in that mosque
 *
 * Returns full mosque settings (name, address, timezone, fiscalYearStart).
 * 404s (not 403) if the caller has no ACTIVE membership there — prevents tenant enumeration.
 */
export const getMosqueSettingsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const mosqueId = validateMosqueIdParam(req.params["mosqueId"]);

    const mosqueSettings = await getMosqueSettings(userId, mosqueId);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque settings retrieved successfully.",
      data: mosqueSettings,
    });
  },
);

export {
  getMosqueMembersHandler,
  updateMembershipHandler,
  leaveMosqueHandler,
  removeMemberHandler,
} from "../membership/membership.controller.js";

/**
 * PATCH /api/mosques/:mosqueId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Updates name, address, timezone, and fiscalYearStart.
 * Changing fiscalYearStart mid-year requires explicit confirmation ('confirmFiscalYearChange: true').
 */
export const updateMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const input = validateUpdateMosqueInput(req.body);

    const updatedSettings = await updateMosque(mosqueId, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque settings updated successfully.",
      data: updatedSettings,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/archive
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Soft-deletes the mosque (sets isArchived: true).
 * Blocks if there are unresolved pending invites or active accounts with non-zero balance.
 */
export const archiveMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);

    const archivedMosque = await archiveMosque(mosqueId);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque archived successfully.",
      data: archivedMosque,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/unarchive
 * Access: Authenticated + MOSQUE_ADMIN (allowArchived: true)
 *
 * Restores the archived mosque (sets isArchived: false, archivedAt: null).
 */
export const unarchiveMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);

    const restoredMosque = await unarchiveMosque(mosqueId);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque workspace restored successfully.",
      data: restoredMosque,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/archive-request
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Submits an archive request for the mosque to be reviewed by a Super Admin.
 */
export const requestMosqueArchiveHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const userId = req.user!.sub;
    const { reason } = validateRequestMosqueArchiveInput(req.body);

    const result = await requestMosqueArchive(mosqueId, userId, reason);

    sendResponse(res, {
      statusCode: 200,
      message: result.message,
      data: result,
    });
  },
);

/**
 * DELETE /api/mosques/:mosqueId/archive-request
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Cancels a pending archive request for the mosque.
 */
export const cancelMosqueArchiveRequestHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const userId = req.user!.sub;

    const result = await cancelMosqueArchiveRequest(mosqueId, userId);

    sendResponse(res, {
      statusCode: 200,
      message: result.message,
      data: result,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/archive-request/reject
 * Access: Authenticated + SUPER_ADMIN
 *
 * Rejects/dismisses a pending archive request.
 */
export const rejectMosqueArchiveRequestHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);

    const result = await rejectMosqueArchiveRequest(mosqueId);

    sendResponse(res, {
      statusCode: 200,
      message: result.message,
      data: result,
    });
  },
);

/**
 * GET /api/mosques/super-admin/archive-requests
 * Access: Authenticated + SUPER_ADMIN
 *
 * Lists all mosques with pending archive requests.
 */
export const getPendingArchiveRequestsHandler = catchAsync(
  async (_req: Request, res: Response): Promise<void> => {
    const requests = await getPendingArchiveRequests();

    sendResponse(res, {
      statusCode: 200,
      message: "Pending mosque archive requests retrieved successfully.",
      data: requests,
    });
  },
);

/**
 * GET /api/public/mosques/:slug
 * Access: Public
 *
 * Minimal public record for the transparency page: name, address, donation-progress summary later.
 * No internal IDs, no account numbers, no member list.
 */
export const getPublicMosqueBySlugHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const slug = validateMosqueSlugParam(req.params["slug"]);

    const mosque = await getPublicMosqueBySlug(slug);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque public record retrieved successfully.",
      data: mosque,
    });
  },
);
