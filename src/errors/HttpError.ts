// ---------------------------------------------------------------------------
// HttpError — typed, structured application error.
// Throw this anywhere in service/controller layers; the global error handler
// serialises it into a consistent JSON envelope:
//
//   { success: false, error: { code, message, details } }
//
// `details` is used for field-level validation errors (422); null otherwise.
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  field: string;
  issue: string;
}

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: ValidationIssue[] | null;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details: ValidationIssue[] | null = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Maintains proper stack trace in V8 (Node / Bun)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }

  // -------------------------------------------------------------------------
  // Factory helpers — keeps throw-sites readable without magic numbers.
  // -------------------------------------------------------------------------

  static badRequest(message: string, code = "BAD_REQUEST"): HttpError {
    return new HttpError(400, message, code);
  }

  static unauthorized(
    message = "Unauthorized",
    code = "UNAUTHORIZED",
  ): HttpError {
    return new HttpError(401, message, code);
  }

  static forbidden(message = "Forbidden", code = "FORBIDDEN"): HttpError {
    return new HttpError(403, message, code);
  }

  static notFound(message: string, code = "NOT_FOUND"): HttpError {
    return new HttpError(404, message, code);
  }

  static conflict(message: string, code = "CONFLICT"): HttpError {
    return new HttpError(409, message, code);
  }

  static gone(message: string, code = "GONE"): HttpError {
    return new HttpError(410, message, code);
  }

  /**
   * 422 Unprocessable Entity — field-level validation failures.
   * Always includes a `details` array so the client can highlight
   * the exact fields that failed.
   */
  static validationError(
    details: ValidationIssue[],
    message = "One or more fields are invalid.",
  ): HttpError {
    return new HttpError(422, message, "VALIDATION_ERROR", details);
  }

  static internal(
    message = "Internal server error",
    code = "INTERNAL_SERVER_ERROR",
  ): HttpError {
    return new HttpError(500, message, code);
  }
}
