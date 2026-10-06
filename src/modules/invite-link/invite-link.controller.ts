// ---------------------------------------------------------------------------
// Invite Link Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateInviteLinkInput,
  validateGetMosqueInviteLinksQuery,
} from "./invite-link.validation.js";
import {
  createInviteLink,
  getMosqueInviteLinks,
} from "./invite-link.service.js";

/**
 * POST /api/mosques/:mosqueId/invite-links
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Generates a MosqueInviteLink (role default MEMBER, optional maxUses, optional expiresAt).
 * Returns the raw token once — client builds the share URL/QR from it. Only the hash is stored.
 */
export const createInviteLinkHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const callerUserId = req.user?.sub;
    const input = validateCreateInviteLinkInput(req.body);

    const result = await createInviteLink(mosqueId, callerUserId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Mosque invite link generated successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/invite-links
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Lists links with useCount and live isActive status.
 */
export const getMosqueInviteLinksHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueInviteLinksQuery(req.query);

    const inviteLinks = await getMosqueInviteLinks(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Mosque invite links retrieved successfully.",
      data: inviteLinks,
    });
  },
);


