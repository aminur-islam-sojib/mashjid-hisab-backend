// ---------------------------------------------------------------------------
// Category Controller — HTTP Adapter Layer
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { validateMosqueIdParam } from "../mosque/mosque.validation.js";
import {
  validateCreateCategoryInput,
  validateCategoryIdParam,
} from "./category.validation.js";
import {
  createCategory,
  getCategoryById,
} from "./category.service.js";

/**
 * POST /api/mosques/:mosqueId/categories
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Creates a Category (name, type: INCOME|EXPENSE, optional fundId).
 * Setting fundId is what restricts this category to one Fund only.
 */
export const createCategoryHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const input = validateCreateCategoryInput(req.body);

    const category = await createCategory(mosqueId, input);

    sendResponse(res, {
      statusCode: 201,
      message: "Category created successfully.",
      data: category,
    });
  },
);

/**
 * GET /api/mosques/:mosqueId/categories/:categoryId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER
 *
 * Retrieves a single Category by its ID.
 */
export const getCategoryByIdHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const categoryId = validateCategoryIdParam(req.params["categoryId"]);

    const category = await getCategoryById(mosqueId, categoryId);

    sendResponse(res, {
      statusCode: 200,
      message: "Category retrieved successfully.",
      data: category,
    });
  },
);
