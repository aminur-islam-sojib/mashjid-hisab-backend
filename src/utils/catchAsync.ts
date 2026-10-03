// ---------------------------------------------------------------------------
// catchAsync — eliminates try/catch boilerplate from every controller.
// Wraps an async route handler so that any rejected promise is forwarded to
// Express's next(err) — picked up by the global error-handler middleware.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export function catchAsync(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
