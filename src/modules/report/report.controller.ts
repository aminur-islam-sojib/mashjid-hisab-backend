// =============================================================================
// report.controller.ts — Express Controllers for Domain 10: Reports & Period Control
// =============================================================================

import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { Role } from "../../../generated/prisma/client.js";
import {
  validatePeriodParam,
  validateReopenPeriodInput,
  validateAccountReconciliationInput,
  validateBalancesReportQueryInput,
  validateIncomeExpenseReportQueryInput,
  validateFundStatementQueryInput,
  validateAccountStatementQueryInput,
  validateDonorsReportQueryInput,
  validateFiscalYearParam,
  validateCreateReportExportInput,
  validateExportIdParam,
} from "./report.validation.js";
import {
  getDashboardReport,
  getBalancesReport,
  getIncomeExpenseReport,
  getFundStatement,
  getAccountStatement,
  getDonorsReport,
  getFiscalYearReport,
  createReportExport,
  getReportExport,
  closeAccountingPeriod,
  reopenAccountingPeriod,
  reconcileAccount,
} from "./report.service.js";

/**
 * GET /reports/dashboard
 * Access: ADMIN, TREAS, COMM
 */
export const getDashboardReportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const report = await getDashboardReport(req.mosqueId!);
    res.status(200).json({
      success: true,
      data: report,
    });
  },
);

/**
 * GET /reports/balances?asOf=
 * Access: ADMIN, TREAS, COMM
 */
export const getBalancesReportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const query = validateBalancesReportQueryInput(req.query);
    const report = await getBalancesReport(req.mosqueId!, query);
    res.status(200).json({
      success: true,
      data: report,
    });
  },
);

/**
 * GET /reports/income-expense
 * Access: ADMIN, TREAS, COMM
 */
export const getIncomeExpenseReportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const query = validateIncomeExpenseReportQueryInput(req.query);
    const report = await getIncomeExpenseReport(req.mosqueId!, query);
    res.status(200).json({
      success: true,
      data: report,
    });
  },
);

/**
 * GET /reports/funds/:fundId/statement
 * Access: ADMIN, TREAS, COMM
 */
export const getFundStatementHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const fundId = String(req.params["fundId"]);
    const query = validateFundStatementQueryInput(req.query);
    const statement = await getFundStatement(req.mosqueId!, fundId, query);
    res.status(200).json({
      success: true,
      data: statement,
    });
  },
);

/**
 * GET /reports/accounts/:accountId/statement
 * Access: ADMIN, TREAS
 */
export const getAccountStatementHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const accountId = String(req.params["accountId"]);
    const query = validateAccountStatementQueryInput(req.query);
    const statement = await getAccountStatement(req.mosqueId!, accountId, query);
    res.status(200).json({
      success: true,
      data: statement,
    });
  },
);

/**
 * GET /reports/donors
 * Access: ADMIN, TREAS
 */
export const getDonorsReportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const query = validateDonorsReportQueryInput(req.query);
    const report = await getDonorsReport(req.mosqueId!, query);
    res.status(200).json({
      success: true,
      data: report,
    });
  },
);

/**
 * GET /reports/fiscal-year/:year
 * Access: ADMIN, TREAS, COMM
 */
export const getFiscalYearReportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const year = validateFiscalYearParam(req.params["year"]);
    const report = await getFiscalYearReport(req.mosqueId!, year);
    res.status(200).json({
      success: true,
      data: report,
    });
  },
);

/**
 * POST /reports/exports
 * Access: ADMIN, TREAS
 */
export const createReportExportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const input = validateCreateReportExportInput(req.body);
    const exportRecord = await createReportExport(
      req.mosqueId!,
      req.user!.sub,
      input,
    );
    res.status(201).json({
      success: true,
      message: "Report export initiated successfully.",
      data: exportRecord,
    });
  },
);

/**
 * GET /reports/exports/:exportId
 * Access: Requester (or ADMIN, TREAS)
 */
export const getReportExportHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const exportId = validateExportIdParam(req.params["exportId"]);
    const userRole = req.membership?.role ?? Role.MEMBER;
    const exportRecord = await getReportExport(
      req.mosqueId!,
      exportId,
      req.user!.sub,
      userRole,
    );

    if (req.query["download"] === "true" || req.headers["accept"] === "text/csv") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exportRecord.fileName ?? "export.csv"}"`,
      );
      res.setHeader("Content-Type", exportRecord.mimeType || "text/csv");
      res.status(200).send(exportRecord.content || "");
      return;
    }

    res.status(200).json({
      success: true,
      data: exportRecord,
    });
  },
);

/**
 * POST /periods/:period/close
 * Access: ADMIN
 */
export const closeAccountingPeriodHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const rawPeriod = req.params["period"] || req.params["yyyy_mm"] || req.params["yyyyMm"];
    const period = validatePeriodParam(rawPeriod);
    const result = await closeAccountingPeriod(
      req.mosqueId!,
      period,
      req.user!.sub,
    );
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  },
);

/**
 * POST /periods/:period/reopen
 * Access: ADMIN
 */
export const reopenAccountingPeriodHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const rawPeriod = req.params["period"] || req.params["yyyy_mm"] || req.params["yyyyMm"];
    const period = validatePeriodParam(rawPeriod);
    const input = validateReopenPeriodInput(req.body);
    const result = await reopenAccountingPeriod(
      req.mosqueId!,
      period,
      req.user!.sub,
      input.reason,
    );
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  },
);

/**
 * POST /accounts/:accountId/reconciliations
 * Access: ADMIN, TREAS
 */
export const reconcileAccountHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const accountId = String(req.params["accountId"]);
    const input = validateAccountReconciliationInput(req.body);
    const result = await reconcileAccount(
      req.mosqueId!,
      accountId,
      req.user!.sub,
      input,
    );
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  },
);
