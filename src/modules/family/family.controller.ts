// ---------------------------------------------------------------------------
// Family Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateFamilyInput,
  validateUpdateFamilyInput,
  validateFamilyIdParam,
  validateTransferFamilyHeadInput,
  validateCreateFamilyMemberInput,
  validateUpdateFamilyMemberInput,
  validateFamilyMemberIdParam,
} from "./family.validation.js";
import {
  createFamily,
  getMosqueFamilies,
  getFamilyById,
  updateFamily,
  transferFamilyHead,
  addFamilyMember,
  updateFamilyMember,
  removeFamilyMember,
} from "./family.service.js";

/**
 * Every handler below runs after requireMosqueMembership(), which populates
 * req.membership — guaranteed present, never re-fetched here.
 */
function requireMembership(req: Request) {
  if (!req.membership) {
    throw HttpError.unauthorized("Mosque membership context is missing.", "AUTH_UNAUTHORIZED");
  }
  return req.membership;
}

/**
 * POST /api/mosques/:mosqueId/families
 * Access: Authenticated, any ACTIVE member
 *
 * Creates a Family with the caller as head.
 */
export const createFamilyHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const membership = requireMembership(req);
    const input = validateCreateFamilyInput(req.body);

    const family = await createFamily(mosqueId, membership, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Family created successfully.",
      data: family,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/families
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Lists every family in the mosque.
 */
export const getMosqueFamiliesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const membership = requireMembership(req);
    const search =
      typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;

    const families = await getMosqueFamilies(mosqueId, membership, { search });

    sendResponse(res, {
      statusCode: 200,
      message: "Families retrieved successfully.",
      data: families,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/families/:familyId
 * Access: Authenticated, any ACTIVE member (own family only unless oversight role)
 */
export const getFamilyByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const membership = requireMembership(req);

    const family = await getFamilyById(mosqueId, familyId, membership);

    sendResponse(res, {
      statusCode: 200,
      message: "Family retrieved successfully.",
      data: family,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/families/:familyId
 * Access: Authenticated, family head or MOSQUE_ADMIN
 */
export const updateFamilyHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const membership = requireMembership(req);
    const input = validateUpdateFamilyInput(req.body);

    const family = await updateFamily(mosqueId, familyId, membership, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Family updated successfully.",
      data: family,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/families/:familyId/transfer-head
 * Access: Authenticated, current family head or MOSQUE_ADMIN
 */
export const transferFamilyHeadHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const membership = requireMembership(req);
    const input = validateTransferFamilyHeadInput(req.body);

    const family = await transferFamilyHead(mosqueId, familyId, membership, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Family headship transferred successfully.",
      data: family,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/families/:familyId/members
 * Access: Authenticated, family head or MOSQUE_ADMIN
 */
export const addFamilyMemberHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const membership = requireMembership(req);
    const input = validateCreateFamilyMemberInput(req.body);

    const member = await addFamilyMember(mosqueId, familyId, membership, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Family member added successfully.",
      data: member,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/families/:familyId/members/:memberId
 * Access: Authenticated, family head or MOSQUE_ADMIN
 */
export const updateFamilyMemberHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const memberId = validateFamilyMemberIdParam(req.params["memberId"]);
    const membership = requireMembership(req);
    const input = validateUpdateFamilyMemberInput(req.body);

    const member = await updateFamilyMember(mosqueId, familyId, memberId, membership, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Family member updated successfully.",
      data: member,
    });
  },
);

/**
 * DELETE /api/mosques/:mosqueId/families/:familyId/members/:memberId
 * Access: Authenticated, family head or MOSQUE_ADMIN
 */
export const removeFamilyMemberHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const familyId = validateFamilyIdParam(req.params["familyId"]);
    const memberId = validateFamilyMemberIdParam(req.params["memberId"]);
    const membership = requireMembership(req);

    await removeFamilyMember(mosqueId, familyId, memberId, membership);

    sendResponse(res, {
      statusCode: 200,
      message: "Family member removed successfully.",
      data: { id: memberId },
    });
  },
);

