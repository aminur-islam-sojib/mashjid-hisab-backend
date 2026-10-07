// ---------------------------------------------------------------------------
// Global error-handler middleware
//
// Must be registered LAST in app.ts (after all routes).
// Express identifies a 4-argument function as an error handler.
//
// Error envelope (all errors, every route):
//   {
//     "success": false,
//     "error": {
//       "code":    string,
//       "message": string,
//       "details": ValidationIssue[] | null
//     }
//   }
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError.js";
import config from "../config/index.js";
import { isPrismaP2002 } from "../lib/prisma.js";

export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // -------------------------------------------------------------------------
  // Known application error — serialise exactly as-is
  // -------------------------------------------------------------------------
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Body-parser malformed JSON syntax error (400 Bad Request)
  // -------------------------------------------------------------------------
  if (
    err instanceof SyntaxError &&
    "status" in err &&
    (err as { status: unknown }).status === 400 &&
    "body" in err
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON_BODY",
        message:
          "Malformed JSON in request body. Ensure valid JSON syntax: remove trailing commas, use double quotes for property names, and do not wrap the body in extra outer quotes.",
        details: null,
      },
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Body-parser / Raw-body payload too large error (400 Bad Request)
  // -------------------------------------------------------------------------
  if (
    err &&
    typeof err === "object" &&
    (("type" in err && (err as { type: unknown }).type === "entity.too.large") ||
      ("status" in err && (err as { status: unknown }).status === 413))
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: "Payload too large: exceeds maximum allowed file size limit of 5MB.",
        details: null,
      },
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Prisma unique constraint violation (P2002) safety net
  // Converts database-level concurrency races into a clean 409 Conflict
  // -------------------------------------------------------------------------
  if (isPrismaP2002(err)) {
    const target = err.meta?.target;
    let targetField = "resource";
    if (Array.isArray(target) && target.length > 0) {
      targetField = target.join(", ");
    } else if (typeof target === "string") {
      targetField = target;
    }

    res.status(409).json({
      success: false,
      error: {
        code: "DUPLICATE_RESOURCE",
        message: `A conflict occurred: A record with this unique ${targetField} already exists.`,
        details: null,
      },
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Unknown / unexpected error
  // Log the full error server-side; send a generic message to the client.
  // Never leak stack traces or internal details in production.
  // -------------------------------------------------------------------------
  console.error("[UnhandledError]", err);

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred. Please try again later.",
      details: null,
      // Stack trace only in development — stripped in production builds
      ...(config.NODE_ENV === "development" && err instanceof Error
        ? { _stack: err.stack }
        : {}),
    },
  });
}
