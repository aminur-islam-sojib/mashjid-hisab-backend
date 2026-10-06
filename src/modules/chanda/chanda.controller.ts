// =============================================================================
// chanda.controller.ts — HTTP Controller for Domain 7: Monthly Chanda
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { HttpError } from "../../errors/HttpError.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateChandaPlanInput,
  validateGetChandaPlansQuery,
  validateUpdateChandaPlanInput,
  validateGenerateDuesInput,
  validateGetDuesQuery,
  validateRecordDuePaymentInput,
  validateWaiveDueInput,
  validateGetDuesSummaryQuery,
  validatePlanIdParam,
  validateDueIdParam,
} from "./chanda.validation.js";
import {
  createChandaPlan,
  getChandaPlans,
  getChandaPlanById,
  updateChandaPlan,
  pauseChandaPlan,
  resumeChandaPlan,
  endChandaPlan,
  generateDues,
  getDues,
  getDueById,
  recordDuePayment,
  waiveDue,
  getDuesSummary,
} from "./chanda.service.js";

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

// ---------------------------------------------------------------------------
// Chanda Plan Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/mosques/:mosqueId/chanda-plans and POST /api/chanda-plans
 * Access: ADMIN, TREASURER
 */
export const createChandaPlanHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const input = validateCreateChandaPlanInput(req.body);

    const plan = await createChandaPlan(mosqueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 201,
      message: "Chanda plan created successfully.",
      data: plan,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/chanda-plans and GET /api/chanda-plans
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getChandaPlansHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetChandaPlansQuery(req.query);

    const result = await getChandaPlans(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plans retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/chanda-plans/:id and GET /api/chanda-plans/:id
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getChandaPlanByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const planId = validatePlanIdParam(req.params["id"] || req.params["planId"]);

    const plan = await getChandaPlanById(mosqueId, planId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plan retrieved successfully.",
      data: plan,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/chanda-plans/:id and PATCH /api/chanda-plans/:id
 * Access: ADMIN, TREASURER
 */
export const updateChandaPlanHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const planId = validatePlanIdParam(req.params["id"] || req.params["planId"]);
    const input = validateUpdateChandaPlanInput(req.body);

    const plan = await updateChandaPlan(mosqueId, planId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plan amount updated successfully.",
      data: plan,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/pause and POST /api/chanda-plans/:id/pause
 * Access: ADMIN, TREASURER
 */
export const pauseChandaPlanHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const planId = validatePlanIdParam(req.params["id"] || req.params["planId"]);

    const plan = await pauseChandaPlan(mosqueId, planId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plan paused successfully.",
      data: plan,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/resume and POST /api/chanda-plans/:id/resume
 * Access: ADMIN, TREASURER
 */
export const resumeChandaPlanHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const planId = validatePlanIdParam(req.params["id"] || req.params["planId"]);

    const plan = await resumeChandaPlan(mosqueId, planId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plan resumed successfully.",
      data: plan,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/chanda-plans/:id/end and POST /api/chanda-plans/:id/end
 * Access: ADMIN, TREASURER
 */
export const endChandaPlanHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const planId = validatePlanIdParam(req.params["id"] || req.params["planId"]);

    const plan = await endChandaPlan(mosqueId, planId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Chanda plan ended successfully.",
      data: plan,
    });
  },
);

// ---------------------------------------------------------------------------
// Dues Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/mosques/:mosqueId/dues/generate and POST /api/dues/generate
 * Access: ADMIN, TREASURER
 */
export const generateDuesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const input = validateGenerateDuesInput(req.body);

    const result = await generateDues(mosqueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Dues generated successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/dues/summary and GET /api/dues/summary
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getDuesSummaryHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetDuesSummaryQuery(req.query);

    const summary = await getDuesSummary(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Dues summary retrieved successfully.",
      data: summary,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/dues and GET /api/dues
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getDuesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const query = validateGetDuesQuery(req.query);

    const result = await getDues(mosqueId, query, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Dues retrieved successfully.",
      data: result,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/dues/:id and GET /api/dues/:id
 * Access: ADMIN, TREASURER, COMMITTEE_MEMBER
 */
export const getDueByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const dueId = validateDueIdParam(req.params["id"] || req.params["dueId"]);

    const due = await getDueById(mosqueId, dueId, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Due retrieved successfully.",
      data: due,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/dues/:id/payments and POST /api/dues/:id/payments
 * Access: ADMIN, TREASURER (posts); STAFF (PENDING)
 */
export const recordDuePaymentHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const dueId = validateDueIdParam(req.params["id"] || req.params["dueId"]);
    const input = validateRecordDuePaymentInput(req.body);

    const result = await recordDuePayment(mosqueId, dueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 201,
      message: "Due payment recorded successfully.",
      data: result,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/dues/:id/waive and POST /api/dues/:id/waive
 * Access: ADMIN
 */
export const waiveDueHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = resolveMosqueId(req);
    const dueId = validateDueIdParam(req.params["id"] || req.params["dueId"]);
    const input = validateWaiveDueInput(req.body);

    const due = await waiveDue(mosqueId, dueId, input, {
      userId: req.user!.sub,
      role: req.membership!.role,
      membershipId: req.membership?.id,
    });

    sendResponse(res, {
      statusCode: 200,
      message: "Due waived successfully.",
      data: due,
    });
  },
);
