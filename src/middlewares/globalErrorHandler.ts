// ---------------------------------------------------------------------------
// Global error-handler middleware
//
// Must be registered LAST in app.ts (after all routes).
// Express identifies a 4-argument function as an error handler.
//
// Response shape on error:
//   { success: false, message: string, code: string, errors?: unknown }
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError.js";
import config from "../config/index.js";

export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // -------------------------------------------------------------------------
  // Known application error
  // -------------------------------------------------------------------------
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Unknown / unexpected error — log full details server-side, return a
  // generic message to the client (never leak internals in production).
  // -------------------------------------------------------------------------
  console.error("[UnhandledError]", err);

  res.status(500).json({
    success: false,
    message: "An unexpected error occurred. Please try again later.",
    code: "INTERNAL_SERVER_ERROR",
    // Stack trace only in development — never in production
    ...(config.NODE_ENV === "development" && err instanceof Error
      ? { stack: err.stack }
      : {}),
  });
}
