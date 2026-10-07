// =============================================================================
// audit.service.ts — Financial Audit Logging Service
// =============================================================================

import { prisma } from "../../lib/prisma.js";
import {
  AuditAction,
  AuditEntity,
  type Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client.js";
import type { AuditLogQueryInput } from "./audit.validation.js";

export interface RecordAuditParams {
  mosqueId: string;
  actorId: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records a financial audit trail event for money operations.
 * Works inside or outside Prisma transactions.
 */
export async function recordAuditLog(
  client: Prisma.TransactionClient | PrismaClient,
  params: RecordAuditParams,
) {
  try {
    return await client.auditLog.create({
      data: {
        mosqueId: params.mosqueId,
        actorId: params.actorId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        summary: params.summary,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
      include: {
        actor: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
  } catch (error) {
    // Audit logging should not crash the primary financial transaction if soft-failing
    console.error("[AuditLog] Failed to record audit log:", error);
    return null;
  }
}

/**
 * Retrieves paginated audit logs for a mosque with actor, entity, action, and date filters.
 */
export async function getAuditLogs(
  mosqueId: string,
  query: AuditLogQueryInput,
) {
  const where: any = { mosqueId };

  if (query.entity) {
    where.entity = query.entity;
  }

  if (query.action) {
    where.action = query.action;
  }

  if (query.actor) {
    where.OR = [
      { actorId: query.actor },
      { actor: { name: { contains: query.actor, mode: "insensitive" } } },
      { actor: { email: { contains: query.actor, mode: "insensitive" } } },
      { actor: { phone: { contains: query.actor } } },
    ];
  }

  // Date filtering
  if (query.date) {
    const d = new Date(query.date);
    const startOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    where.createdAt = { gte: startOfDay, lte: endOfDay };
  } else if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }

  const page = query.page || 1;
  const limit = query.limit || 50;
  const skip = (page - 1) * limit;

  const [totalCount, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    }),
  ]);

  return {
    items: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      summary: log.summary,
      metadata: log.metadata,
      actor: log.actor
        ? {
            id: log.actor.id,
            name: log.actor.name,
            email: log.actor.email,
            phone: log.actor.phone,
          }
        : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
    })),
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
  };
}

