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
  validateGetMosqueCategoriesQuery,
  validateUpdateCategoryInput,
} from "./category.validation.js";
import {
  createCategory,
  getCategoryById,
  getMosqueCategories,
  updateCategory,
  archiveCategory,
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

/**
 * GET /api/mosques/:mosqueId/categories
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER, COMMITTEE_MEMBER, STAFF
 *
 * Lists Categories for a mosque, filterable by ?type= and ?fundId=. Pass ?includeArchived=true for settings.
 * STAFF is included so they can select categories when submitting or recording operational expenses.
 */
export const getMosqueCategoriesHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const query = validateGetMosqueCategoriesQuery(req.query);

    const categories = await getMosqueCategories(mosqueId, query);

    sendResponse(res, {
      statusCode: 200,
      message: "Categories retrieved successfully.",
      data: categories,
    });
  },
);

/**
 * PATCH /api/mosques/:mosqueId/categories/:categoryId
 * Access: Authenticated + MOSQUE_ADMIN, TREASURER
 *
 * Updates name/fundId. Changing fundId on a category already used by past transactions
 * does not rewrite history — it only affects future entries.
 */
export const updateCategoryHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const categoryId = validateCategoryIdParam(req.params["categoryId"]);
    const input = validateUpdateCategoryInput(req.body);

    const category = await updateCategory(mosqueId, categoryId, input);

    sendResponse(res, {
      statusCode: 200,
      message: "Category updated successfully.",
      data: category,
    });
  },
);

/**
 * POST /api/mosques/:mosqueId/categories/:categoryId/archive
 * Access: Authenticated + MOSQUE_ADMIN
 *
 * Soft-deletes a category (sets isArchived: true).
 * Hides it from new-transaction dropdowns while preserving historical transaction records.
 */
export const archiveCategoryHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId || validateMosqueIdParam(req.params["mosqueId"]);
    const categoryId = validateCategoryIdParam(req.params["categoryId"]);

    const category = await archiveCategory(mosqueId, categoryId);

    sendResponse(res, {
      statusCode: 200,
      message: "Category archived successfully.",
      data: category,
    });
  },
);



