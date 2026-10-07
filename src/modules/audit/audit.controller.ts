// =============================================================================
// audit.controller.ts — Express Controllers for Financial Audit Logs
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateAuditLogQueryInput } from "./audit.validation.js";
import { getAuditLogs } from "./audit.service.js";

/**
 * GET /audit-logs
 * Access: ADMIN
 *
 * Who did what and when for every money action (create, approve, void, waive, close period).
 * Filters: actor, entity, date, action.
 */
export const getAuditLogsHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId!;
    const query = validateAuditLogQueryInput(req.query);
    const result = await getAuditLogs(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Audit logs retrieved successfully.",
      data: result,
    });
  },
);
