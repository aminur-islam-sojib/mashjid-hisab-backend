// ---------------------------------------------------------------------------
// notFound middleware — catches requests that didn't match any route.
// Must be registered after all routes, before globalErrorHandler.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/HttpError.js";

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound(`Route ${_req.method} ${_req.originalUrl} not found`));
}
