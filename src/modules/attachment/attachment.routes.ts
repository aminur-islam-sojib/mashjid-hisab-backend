// =============================================================================
// attachment.routes.ts — Express Router for File Attachments & Signed URLs
// =============================================================================

import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  requireMosqueMembership,
  OVERSIGHT_ROLES,
  COLLECTION_OPERATOR_ROLES,
} from "../../middlewares/mosque.middleware.js";
import {
  uploadAttachmentHandler,
  getAttachmentHandler,
  viewSignedAttachmentHandler,
} from "./attachment.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const attachmentRouter: Router = Router({ mergeParams: true });

/**
 * POST /attachments
 * Access: ADMIN, TREAS, STAFF
 *
 * Uploads a bill or receipt image or PDF (type and size limited).
 * Returns an id to attach to a transaction.
 */
attachmentRouter.post(
  "/",
  authenticate,
  requireMosqueMembership(...COLLECTION_OPERATOR_ROLES),
  upload.single("file"),
  uploadAttachmentHandler,
);

/**
 * GET /attachments/:id/view?token=...&expires=...
 * Access: Private via cryptographically signed URL token
 *
 * Streams the file inline. Files are never public without a valid signed token.
 */
attachmentRouter.get(
  "/:id/view",
  viewSignedAttachmentHandler,
);

/**
 * GET /attachments/:id
 * Access: ADMIN, TREAS, COMM
 *
 * Returns a short-lived signed URL. Files are never public.
 */
attachmentRouter.get(
  "/:id",
  authenticate,
  requireMosqueMembership(...OVERSIGHT_ROLES),
  getAttachmentHandler,
);

export default attachmentRouter;

