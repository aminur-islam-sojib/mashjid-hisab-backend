// ---------------------------------------------------------------------------
// Mosque Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  validateCreateMosqueInput,
  validateGetUserMosquesQuery,
  validateGetMosqueMembersQuery,
  validateMosqueIdParam,
  validateMosqueSlugParam,
  validateUpdateMosqueInput,
} from "./mosque.validation.js";
import {
  createMosque,
  getUserMosques,
  getMosqueMembers,
  getMosqueSettings,
  updateMosque,
  archiveMosque,
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

/**
 * GET /api/mosques/:mosqueId/members
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists all Memberships for the mosque with user name/role/status — the admin's people-management screen.
 */
export const getMosqueMembersHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueMembersQuery(req.query);

    const members = await getMosqueMembers(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque members retrieved successfully.",
      data: members,
    });
  },
);

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
