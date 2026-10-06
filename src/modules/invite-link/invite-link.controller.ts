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
  validateInviteLinkIdParam,
  validateInviteTokenParam,
} from "./invite-link.validation.js";
import {
  createInviteLink,
  getMosqueInviteLinks,
  revokeInviteLink,
  getPublicInviteLinkInfo,
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

/**
 * POST /api/mosques/:mosqueId/invite-links/:id/revoke
 * Access: Authenticated + MOSQUE_ADMIN (ADMIN_ONLY_ROLES)
 *
 * Sets isActive: false (via isArchived: true) without deleting the row.
 * Preserves the audit trail of who joined through it.
 */
export const revokeInviteLinkHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const linkId = validateInviteLinkIdParam(req.params["id"] || req.params["linkId"]);

    const revokedLink = await revokeInviteLink(mosqueId, linkId);

    sendResponse(res, {
      statusCode: 200,
      message: "Invite link revoked successfully.",
      data: revokedLink,
    });
  },
);

export const revokeMosqueInviteLinkHandler = revokeInviteLinkHandler;

/**
 * GET /api/public/invite-links/:token
 * Access: Public (unauthenticated)
 *
 * Validates the token (isActive, not expired, under maxUses, mosque active)
 * and returns just the mosque's name — what the join page shows before the person commits.
 * Returns a generic 404 for invalid/expired/exhausted/revoked tokens (existence-hiding).
 */
export const getPublicInviteLinkInfoHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const token = validateInviteTokenParam(req.params["token"]);

    const info = await getPublicInviteLinkInfo(token);

    sendResponse(res, {
      statusCode: 200,
      message: "Invite link verified successfully.",
      data: info,
    });
  },
);
