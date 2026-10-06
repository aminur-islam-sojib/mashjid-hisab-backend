import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Checks whether an error is a Prisma P2002 Unique Constraint Violation.
 */
export function isPrismaP2002(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Checks if a Prisma P2002 Unique Constraint Violation targets a specific field or constraint name.
 */
export function isP2002Target(error: unknown, fieldName: string): boolean {
  if (!isPrismaP2002(error)) {
    return false;
  }
  const lowerField = fieldName.toLowerCase();

  // 1. Check meta.target if provided (standard Prisma engines)
  const meta = error.meta as Record<string, any> | undefined;
  if (meta) {
    if (meta.target) {
      const target = meta.target;
      if (Array.isArray(target)) {
        if (target.some((t: unknown) => typeof t === "string" && t.toLowerCase().includes(lowerField))) {
          return true;
        }
      } else if (typeof target === "string" && target.toLowerCase().includes(lowerField)) {
        return true;
      }
    }

    // 2. Check driverAdapterError (Prisma 7 with @prisma/adapter-pg)
    const driverErr = meta.driverAdapterError;
    if (driverErr && typeof driverErr === "object") {
      const cause = driverErr.cause;
      if (cause && typeof cause === "object") {
        if (typeof cause.constraint === "string" && cause.constraint.toLowerCase().includes(lowerField)) {
          return true;
        }
        if (typeof cause.detail === "string" && cause.detail.toLowerCase().includes(lowerField)) {
          return true;
        }
      }
    }
  }

  // 3. Fallback: Check error.message (e.g. "Unique constraint failed on the constraint: `users_email_key`")
  if (typeof error.message === "string" && error.message.toLowerCase().includes(lowerField)) {
    return true;
  }

  return false;
}

export { prisma };