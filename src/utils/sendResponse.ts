// ---------------------------------------------------------------------------
// sendResponse — typed, consistent JSON envelope for every success response.
//
// Shape:
//   { success: true, message: string, data: T, _dev?: unknown }
//
// In development mode, `_dev` provides testing tokens, simulated email links,
// etc. In production, `_dev` is stripped completely.
// ---------------------------------------------------------------------------

import type { Response } from "express";
import config from "../config/index.js";

interface SuccessResponseOptions<T> {
  statusCode?: number;
  message: string;
  data: T;
  dev?: Record<string, unknown>;
}

export function sendResponse<T>(
  res: Response,
  options: SuccessResponseOptions<T>,
): void {
  const { statusCode = 200, message, data, dev } = options;

  res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(config.NODE_ENV === "development" && dev ? { _dev: dev } : {}),
  });
}
