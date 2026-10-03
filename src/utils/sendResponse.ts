// ---------------------------------------------------------------------------
// sendResponse — typed, consistent JSON envelope for every success response.
//
// Shape:
//   { success: true, message: string, data: T }
//
// Controllers call sendResponse(res, { ... }) — never res.json() directly —
// so the client always gets a predictable structure.
// ---------------------------------------------------------------------------

import type { Response } from "express";

interface SuccessResponseOptions<T> {
  statusCode?: number;
  message: string;
  data: T;
}

export function sendResponse<T>(
  res: Response,
  options: SuccessResponseOptions<T>,
): void {
  const { statusCode = 200, message, data } = options;

  res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}
