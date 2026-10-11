// ---------------------------------------------------------------------------
// Idempotency Middleware — Double-Submit & Retry Deduplication (T03)
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../errors/HttpError.js";
import { IdempotencyStatus, Prisma } from "../../generated/prisma/client.js";
import { resolveActiveMosqueId } from "../modules/mosque/mosque.service.js";

/**
 * Deterministically serializes a JavaScript value by sorting object keys recursively.
 * Ensures { a: 1, b: 2 } and { b: 2, a: 1 } produce identical JSON strings.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof (value as any).toJSON === "function") {
    return canonicalJsonStringify((value as any).toJSON());
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys
    .filter((key) => obj[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * Computes a hex-encoded SHA-256 hash of a request payload.
 */
export function computeRequestHash(body: unknown): string {
  if (body === undefined || body === null || body === "") {
    return createHash("sha256").update("").digest("hex");
  }
  const canonicalStr = canonicalJsonStringify(body);
  return createHash("sha256").update(canonicalStr).digest("hex");
}

export interface IdempotencyMiddlewareOptions {
  /**
   * If true, requests missing the Idempotency-Key header will be rejected with 400 Bad Request.
   * Defaults to false (optional header; deduplicates whenever header is provided).
   */
  required?: boolean;
}

/**
 * Express middleware that enforces HTTP Idempotency-Key semantics.
 *
 * Scoped per (mosqueId, userId, key) with a 24-hour TTL.
 * - Replays identical responses on repeated requests with matching payload.
 * - Returns 409 Conflict if the same key is reused with a different payload.
 * - Returns 409 Conflict if a concurrent request with the same key is in-flight.
 */
export function idempotency(options: IdempotencyMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Extract and normalize header
    const rawHeader = req.headers["idempotency-key"];
    const key = typeof rawHeader === "string" ? rawHeader.trim() : null;

    if (!key) {
      if (options.required) {
        throw HttpError.badRequest(
          "Idempotency-Key header is required for this operation.",
          "IDEMPOTENCY_KEY_REQUIRED",
        );
      }
      return next();
    }

    if (key.length < 1 || key.length > 128) {
      throw HttpError.badRequest(
        "Idempotency-Key header must be between 1 and 128 characters.",
        "INVALID_IDEMPOTENCY_KEY",
      );
    }

    // 2. Validate authentication context
    const userId = req.user?.sub;
    if (!userId) {
      throw HttpError.unauthorized(
        "Authentication required for idempotent operations.",
        "UNAUTHORIZED",
      );
    }

    // 3. Resolve mosque tenant context
    const rawMosqueParam =
      req.mosqueId || (typeof req.params["mosqueId"] === "string" ? req.params["mosqueId"] : null);
    if (!rawMosqueParam) {
      throw HttpError.badRequest(
        "Mosque context is required for idempotent operations.",
        "MOSQUE_CONTEXT_REQUIRED",
      );
    }

    const resolvedMosqueId = await resolveActiveMosqueId(rawMosqueParam);
    const requestHash = computeRequestHash(req.body);
    const requestPath = req.originalUrl || req.baseUrl + req.path;
    const requestMethod = req.method;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours TTL

    // 4. Check for existing key record in DB
    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        mosqueId_userId_key: {
          mosqueId: resolvedMosqueId,
          userId,
          key,
        },
      },
    });

    if (existing) {
      // If expired, delete and proceed as new
      if (existing.expiresAt < now) {
        await prisma.idempotencyKey.delete({ where: { id: existing.id } });
      } else if (existing.status === IdempotencyStatus.PROCESSING) {
        // If locked for > 5 minutes, consider it abandoned and allow retry; otherwise 409
        const isStale = now.getTime() - existing.updatedAt.getTime() > 5 * 60 * 1000;
        if (!isStale) {
          throw HttpError.conflict(
            "A request with this Idempotency-Key is currently being processed. Please retry shortly.",
            "IDEMPOTENCY_IN_FLIGHT",
          );
        }
        // Stale in-flight: reset status to PROCESSING with new hash
        await prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: {
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            updatedAt: now,
          },
        });
      } else if (existing.status === IdempotencyStatus.RESOLVED) {
        // Same key, different body -> 409 Conflict
        if (existing.requestHash !== requestHash) {
          throw HttpError.conflict(
            `Idempotency key '${key}' was already used for a different request payload.`,
            "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
          );
        }

        // Same key, same body -> replay cached response
        res.setHeader("Idempotent-Replayed", "true");
        res.status(existing.statusCode ?? 200).json(existing.responseBody);
        return;
      } else if (existing.status === IdempotencyStatus.FAILED) {
        // Previous attempt failed; reuse record and retry
        await prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: {
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            updatedAt: now,
          },
        });
      }
    }

    // 5. Reserve key atomically as PROCESSING
    let recordId: string;
    if (existing && existing.expiresAt >= now) {
      recordId = existing.id;
    } else {
      try {
        const created = await prisma.idempotencyKey.create({
          data: {
            mosqueId: resolvedMosqueId,
            userId,
            key,
            requestPath,
            requestMethod,
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            expiresAt,
          },
        });
        recordId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw HttpError.conflict(
            "A request with this Idempotency-Key is currently being processed. Please retry shortly.",
            "IDEMPOTENCY_IN_FLIGHT",
          );
        }
        throw err;
      }
    }

    // 6. Hook response to capture status code and body
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let captured = false;

    const finalizeIdempotency = async (bodyContent: unknown) => {
      if (captured) return;
      captured = true;

      const statusCode = res.statusCode || 200;
      if (statusCode >= 200 && statusCode < 500) {
        let responseBodyJson = bodyContent;
        if (typeof bodyContent === "string") {
          try {
            responseBodyJson = JSON.parse(bodyContent);
          } catch {
            responseBodyJson = bodyContent;
          }
        }
        try {
          await prisma.idempotencyKey.update({
            where: { id: recordId },
            data: {
              status: IdempotencyStatus.RESOLVED,
              statusCode,
              responseBody: (responseBodyJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
          });
        } catch {
          // Swallow background update error to avoid crashing completed response
        }
      } else {
        // 5xx error: Mark FAILED so user can retry without being locked out
        try {
          await prisma.idempotencyKey.update({
            where: { id: recordId },
            data: { status: IdempotencyStatus.FAILED },
          });
        } catch {}
      }
    };

    res.json = function (data: unknown) {
      finalizeIdempotency(data).catch(() => {});
      return originalJson(data);
    };

    res.send = function (body: unknown) {
      finalizeIdempotency(body).catch(() => {});
      return originalSend(body);
    };

    // Fail-safe cleanup if socket closes unexpectedly before response completes
    res.on("close", () => {
      if (!captured) {
        prisma.idempotencyKey
          .update({
            where: { id: recordId },
            data: { status: IdempotencyStatus.FAILED },
          })
          .catch(() => {});
      }
    });

    next();
  };
}
