// =============================================================================
// attachment.validation.ts — Validation for Domain 11: File Attachments
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface UploadBase64Input {
  fileName: string;
  mimeType: AllowedMimeType;
  contentBase64: string;
}

export interface SignedUrlQueryInput {
  token: string;
  expires: number;
}

export function validateAttachmentIdParam(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw HttpError.badRequest("Attachment ID must be a non-empty string.", "INVALID_ATTACHMENT_ID");
  }
  return param.trim();
}

export function validateMimeType(mimeType: string): AllowedMimeType {
  const normalized = mimeType.toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(normalized as AllowedMimeType)) {
    throw HttpError.badRequest(
      `Invalid file type '${mimeType}'. Allowed types are: image/jpeg, image/png, image/webp, application/pdf.`,
      "INVALID_FILE_TYPE",
    );
  }
  return normalized as AllowedMimeType;
}

export function validateFileSize(sizeBytes: number): void {
  if (sizeBytes <= 0) {
    throw HttpError.badRequest("Uploaded file is empty.", "EMPTY_FILE");
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw HttpError.badRequest(
      `File size exceeds maximum limit of 5MB (${(sizeBytes / 1024 / 1024).toFixed(2)}MB uploaded).`,
      "FILE_TOO_LARGE",
    );
  }
}

export function validateUploadBase64Input(body: unknown): UploadBase64Input {
  if (!body || typeof body !== "object") {
    throw HttpError.badRequest("Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const issues: { field: string; issue: string }[] = [];

  // fileName
  let fileName = "";
  if (!raw["fileName"] || typeof raw["fileName"] !== "string" || !raw["fileName"].trim()) {
    issues.push({ field: "fileName", issue: "fileName is required." });
  } else {
    fileName = raw["fileName"].trim();
  }

  // mimeType
  let mimeType: AllowedMimeType = "image/jpeg";
  if (!raw["mimeType"] || typeof raw["mimeType"] !== "string" || !raw["mimeType"].trim()) {
    issues.push({ field: "mimeType", issue: "mimeType is required." });
  } else {
    mimeType = validateMimeType(raw["mimeType"]);
  }

  // contentBase64
  let contentBase64 = "";
  if (!raw["contentBase64"] || typeof raw["contentBase64"] !== "string" || !raw["contentBase64"].trim()) {
    issues.push({ field: "contentBase64", issue: "contentBase64 payload is required." });
  } else {
    contentBase64 = raw["contentBase64"].trim();
    // Strip data URI header if provided e.g. "data:image/png;base64,"
    if (contentBase64.includes(";base64,")) {
      contentBase64 = contentBase64.split(";base64,")[1]!;
    }
  }

  if (issues.length > 0) {
    throw HttpError.validationError(issues, "Validation failed.");
  }

  return { fileName, mimeType, contentBase64 };
}

export function validateSignedUrlQuery(query: unknown): SignedUrlQueryInput {
  if (!query || typeof query !== "object") {
    throw HttpError.badRequest("Missing signed URL query parameters.", "INVALID_SIGNED_URL");
  }

  const raw = query as Record<string, unknown>;
  const token = typeof raw["token"] === "string" ? raw["token"].trim() : "";
  const expiresStr = typeof raw["expires"] === "string" ? raw["expires"].trim() : "";

  if (!token || !expiresStr) {
    throw HttpError.badRequest("Signed URL is missing token or expires timestamp.", "INVALID_SIGNED_URL");
  }

  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires <= 0) {
    throw HttpError.badRequest("Invalid expiration timestamp.", "INVALID_SIGNED_URL");
  }

  return { token, expires };
}
