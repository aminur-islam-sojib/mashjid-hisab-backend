// =============================================================================
// attachment.controller.ts — Express Controllers for File Attachments
// =============================================================================

import fs from "fs";
import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  validateAttachmentIdParam,
  validateUploadBase64Input,
  validateSignedUrlQuery,
} from "./attachment.validation.js";
import {
  saveAttachment,
  getAttachmentWithSignedUrl,
  getAttachmentForStreaming,
} from "./attachment.service.js";

/**
 * POST /attachments
 * Access: ADMIN, TREAS, STAFF
 *
 * Uploads a bill or receipt image or PDF (type and size limited).
 * Returns an id to attach to a transaction.
 * Supports multipart/form-data (field 'file') or application/json ({ fileName, mimeType, contentBase64 }).
 */
export const uploadAttachmentHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mosqueId = req.mosqueId!;
    const userId = req.user!.sub;

    // A. Multipart file upload
    if (req.file) {
      const buffer = req.file.buffer;
      const originalName = req.file.originalname || "attachment";
      const mimeType = req.file.mimetype;

      const attachment = await saveAttachment(
        mosqueId,
        userId,
        originalName,
        mimeType,
        buffer,
      );

      res.status(201).json({
        success: true,
        message: "Attachment uploaded successfully.",
        data: attachment,
      });
      return;
    }

    // B. Base64 JSON upload
    if (req.body && typeof req.body === "object" && "contentBase64" in req.body) {
      const input = validateUploadBase64Input(req.body);
      let buffer: Buffer;
      try {
        buffer = Buffer.from(input.contentBase64, "base64");
      } catch {
        throw HttpError.badRequest("Invalid base64 encoding.", "INVALID_BASE64");
      }

      const attachment = await saveAttachment(
        mosqueId,
        userId,
        input.fileName,
        input.mimeType,
        buffer,
      );

      res.status(201).json({
        success: true,
        message: "Attachment uploaded successfully.",
        data: attachment,
      });
      return;
    }

    throw HttpError.badRequest(
      "No file provided. Please upload a file using multipart/form-data ('file' field) or application/json ('contentBase64').",
      "NO_FILE_PROVIDED",
    );
  },
);

/**
 * GET /attachments/:id
 * Access: ADMIN, TREAS, COMM
 *
 * Returns a short-lived signed URL. Files are never public.
 * If ?download=true is provided, streams the file directly to authenticated caller.
 */
export const getAttachmentHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const attachmentId = validateAttachmentIdParam(req.params["id"]);
    const mosqueId = req.mosqueId!;

    // Direct stream if download=true is requested by authorized caller
    if (req.query["download"] === "true") {
      const attachment = await getAttachmentForStreaming(attachmentId, undefined, undefined, mosqueId);
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
      );
      fs.createReadStream(attachment.storagePath).pipe(res);
      return;
    }

    // Otherwise return metadata with short-lived signed URL
    const attachmentData = await getAttachmentWithSignedUrl(mosqueId, attachmentId);
    res.status(200).json({
      success: true,
      data: attachmentData,
    });
  },
);

/**
 * GET /attachments/:id/view?token=...&expires=...
 * Access: Private via cryptographically signed URL (token + expires)
 *
 * Validates HMAC token and streams the file securely.
 */
export const viewSignedAttachmentHandler = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const attachmentId = validateAttachmentIdParam(req.params["id"]);
    const query = validateSignedUrlQuery(req.query);

    const attachment = await getAttachmentForStreaming(
      attachmentId,
      query.token,
      query.expires,
    );

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=900");

    fs.createReadStream(attachment.storagePath).pipe(res);
  },
);

