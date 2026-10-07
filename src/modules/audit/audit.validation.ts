// =============================================================================
// audit.validation.ts — Input Validation for Financial Audit Logs
// =============================================================================

import { HttpError } from "../../errors/HttpError.js";
import { AuditAction, AuditEntity } from "../../../generated/prisma/client.js";

export interface AuditLogQueryInput {
  actor?: string;
  entity?: AuditEntity;
  action?: AuditAction;
  date?: Date;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  limit: number;
}

export function validateAuditLogQueryInput(query: unknown): AuditLogQueryInput {
  if (!query || typeof query !== "object") {
    return { page: 1, limit: 50 };
  }

  const raw = query as Record<string, unknown>;
  let actor: string | undefined;
  let entity: AuditEntity | undefined;
  let action: AuditAction | undefined;
  let date: Date | undefined;
  let dateFrom: Date | undefined;
  let dateTo: Date | undefined;
  let page = 1;
  let limit = 50;

  // actor
  if (typeof raw["actor"] === "string" && raw["actor"].trim()) {
    actor = raw["actor"].trim();
  }

  // entity
  if (typeof raw["entity"] === "string" && raw["entity"].trim()) {
    const normalized = raw["entity"].toUpperCase().trim();
    if (Object.values(AuditEntity).includes(normalized as AuditEntity)) {
      entity = normalized as AuditEntity;
    } else {
      throw HttpError.badRequest(
        `Invalid entity '${raw["entity"]}'. Allowed entities are: ${Object.values(AuditEntity).join(", ")}.`,
        "INVALID_ENTITY_FILTER",
      );
    }
  }

  // action
  if (typeof raw["action"] === "string" && raw["action"].trim()) {
    const normalized = raw["action"].toUpperCase().trim().replace(/-/g, "_");
    if (Object.values(AuditAction).includes(normalized as AuditAction)) {
      action = normalized as AuditAction;
    } else {
      throw HttpError.badRequest(
        `Invalid action '${raw["action"]}'. Allowed actions are: ${Object.values(AuditAction).join(", ")}.`,
        "INVALID_ACTION_FILTER",
      );
    }
  }

  // date
  if (raw["date"]) {
    const parsed = new Date(String(raw["date"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid date parameter.", "INVALID_DATE");
    }
    date = parsed;
  }

  // dateFrom
  if (raw["dateFrom"]) {
    const parsed = new Date(String(raw["dateFrom"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid dateFrom parameter.", "INVALID_DATE_FROM");
    }
    dateFrom = parsed;
  }

  // dateTo
  if (raw["dateTo"]) {
    const parsed = new Date(String(raw["dateTo"]));
    if (isNaN(parsed.getTime())) {
      throw HttpError.badRequest("Invalid dateTo parameter.", "INVALID_DATE_TO");
    }
    dateTo = parsed;
  }

  // page & limit
  if (raw["page"] !== undefined) {
    const p = parseInt(String(raw["page"]), 10);
    if (!isNaN(p) && p > 0) {
      page = p;
    }
  }

  if (raw["limit"] !== undefined) {
    const l = parseInt(String(raw["limit"]), 10);
    if (!isNaN(l) && l > 0) {
      limit = Math.min(l, 200);
    }
  }

  return {
    actor,
    entity,
    action,
    date,
    dateFrom,
    dateTo,
    page,
    limit,
  };
}

