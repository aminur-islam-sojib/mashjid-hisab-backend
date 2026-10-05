// ---------------------------------------------------------------------------
// Membership Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateGetMosqueMembersQuery,
  validateMembershipIdParam,
  validateUpdateMembershipInput,
} from "./membership.validation.js";
import {
  getMosqueMembers,
  updateMembership,
  removeMember,
  leaveMosque,
} from "./membership.service.js";

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
 * PATCH /api/mosques/:mosqueId/members/:membershipId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Changes a member's role or status (e.g. promote to TREASURER, SUSPENDED).
 * Rejects with LAST_ADMIN_PROTECTED if this would demote the mosque's only MOSQUE_ADMIN.
 */
export const updateMembershipHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const membershipId = validateMembershipIdParam(req.params["membershipId"]);
    const input = validateUpdateMembershipInput(req.body);

    const updated = await updateMembership(mosqueId, membershipId, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Membership updated successfully.",
      data: updated,
    });
  },
);

/**
 * DELETE /api/mosques/:mosqueId/members/me
 * Access: Authenticated (self)
 *
 * Lets a member leave voluntarily.
 * Rejects with LAST_ADMIN_PROTECTED if a lone MOSQUE_ADMIN attempts to leave.
 */
export const leaveMosqueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);

    const result = await leaveMosque(mosqueId, userId);

    sendResponse(res, {
      statusCode: 200,
      message: "You have left the mosque successfully.",
      data: result,
    });
  },
);

/**
 * DELETE /api/mosques/:mosqueId/members/:membershipId
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Removes a member from the mosque (deletes the Membership row).
 * Rejects with LAST_ADMIN_PROTECTED if this would remove the mosque's only MOSQUE_ADMIN.
 */
export const removeMemberHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const membershipId = validateMembershipIdParam(req.params["membershipId"]);

    const result = await removeMember(mosqueId, membershipId);

    sendResponse(res, {
      statusCode: 200,
      message: "Member removed from mosque successfully.",
      data: result,
    });
  },
);
