// =============================================================================
// attachment.service.ts — Business Logic for File Attachments & Signed URLs
// =============================================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/HttpError.js";
import {
  validateMimeType,
  validateFileSize,
  type AllowedMimeType,
} from "./attachment.validation.js";

const UPLOAD_ROOT_DIR = path.resolve(process.cwd(), "uploads", "attachments");
const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes
const HMAC_SECRET = process.env["JWT_SECRET"] || "mosque_secure_attachment_token_key_default";

function getFileExtension(mimeType: AllowedMimeType, originalName: string): string {
  const mimeToExt: Record<AllowedMimeType, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };

  const extFromMime = mimeToExt[mimeType];
  if (extFromMime) return extFromMime;

  const dotExt = path.extname(originalName).replace(/^\./, "").toLowerCase();
  return dotExt || "bin";
}

/**
 * Computes a cryptographic HMAC-SHA256 signature for short-lived private access.
 */
export function generateSignedToken(attachmentId: string, expires: number, mosqueId: string): string {
  const payload = `${attachmentId}:${expires}:${mosqueId}`;
  return crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
}

/**
 * Validates a signed URL token and expiration timestamp.
 */
export function verifySignedToken(
  attachmentId: string,
  mosqueId: string,
  token: string,
  expires: number,
): boolean {
  if (Date.now() > expires) {
    return false;
  }

  const expectedToken = generateSignedToken(attachmentId, expires, mosqueId);
  if (token.length !== expectedToken.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
}

/**
 * Saves an uploaded file buffer to private disk storage and persists an Attachment record.
 */
export async function saveAttachment(
  mosqueId: string,
  userId: string,
  originalName: string,
  mimeTypeStr: string,
  buffer: Buffer,
) {
  const mimeType = validateMimeType(mimeTypeStr);
  validateFileSize(buffer.length);

  // Tenant-isolated storage directory
  const tenantDir = path.join(UPLOAD_ROOT_DIR, mosqueId);
  await fs.promises.mkdir(tenantDir, { recursive: true });

  const ext = getFileExtension(mimeType, originalName);
  const safeDiskName = `att_${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const absoluteStoragePath = path.join(tenantDir, safeDiskName);

  await fs.promises.writeFile(absoluteStoragePath, buffer);

  const attachment = await prisma.attachment.create({
    data: {
      mosqueId,
      fileName: path.basename(originalName) || `attachment.${ext}`,
      fileSize: buffer.length,
      mimeType,
      storagePath: absoluteStoragePath,
      uploadedById: userId,
    },
  });

  const expires = Date.now() + SIGNED_URL_TTL_MS;
  const token = generateSignedToken(attachment.id, expires, mosqueId);
  const signedUrl = `/api/attachments/${attachment.id}/view?token=${token}&expires=${expires}`;

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    signedUrl,
    expiresAt: new Date(expires).toISOString(),
    expiresInMinutes: 15,
    createdAt: attachment.createdAt,
  };
}

/**
 * Retrieves attachment metadata and generates a short-lived signed URL for private access.
 */
export async function getAttachmentWithSignedUrl(mosqueId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, mosqueId },
  });

  if (!attachment) {
    throw HttpError.notFound("Attachment not found in this mosque.", "ATTACHMENT_NOT_FOUND");
  }

  const expires = Date.now() + SIGNED_URL_TTL_MS;
  const token = generateSignedToken(attachment.id, expires, mosqueId);

  // Short-lived signed URL
  const signedUrl = `/api/attachments/${attachment.id}/view?token=${token}&expires=${expires}`;

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    signedUrl,
    expiresAt: new Date(expires).toISOString(),
    expiresInMinutes: 15,
    createdAt: attachment.createdAt,
  };
}

/**
 * Validates a signed URL token and returns the file path and metadata for streaming.
 */
export async function getAttachmentForStreaming(
  attachmentId: string,
  token?: string,
  expires?: number,
  mosqueId?: string,
) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });

  if (!attachment) {
    throw HttpError.notFound("Attachment not found.", "ATTACHMENT_NOT_FOUND");
  }

  // If token is provided, verify signed URL
  if (token && expires) {
    const isValid = verifySignedToken(attachment.id, attachment.mosqueId, token, expires);
    if (!isValid) {
      throw HttpError.forbidden(
        "Signed URL is invalid or has expired. Please request a fresh signed URL.",
        "EXPIRED_OR_INVALID_TOKEN",
      );
    }
  } else if (mosqueId && attachment.mosqueId !== mosqueId) {
    throw HttpError.forbidden("Attachment does not belong to this mosque.", "TENANT_MISMATCH");
  }

  if (!fs.existsSync(attachment.storagePath)) {
    throw HttpError.notFound("Attachment file is missing from storage.", "FILE_NOT_FOUND");
  }

  return attachment;
}
