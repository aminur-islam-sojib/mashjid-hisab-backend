// ---------------------------------------------------------------------------
// Slug Utilities — URL-safe identifier creation and validation
// ---------------------------------------------------------------------------

import crypto from "crypto";

/**
 * Valid slug pattern:
 * - Lowercase alphanumeric characters and single hyphens
 * - Cannot start or end with a hyphen
 * - Length between 3 and 60 characters
 */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates whether a given string is a syntactically valid URL slug.
 */
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  const trimmed = slug.trim();
  return trimmed.length >= 3 && trimmed.length <= 60 && SLUG_REGEX.test(trimmed);
}

/**
 * Converts arbitrary text (e.g. Mosque name) into a clean, URL-safe slug.
 * Example: "Baitul Mukarram National Mosque!" -> "baitul-mukarram-national-mosque"
 */
export function slugify(text: string): string {
  if (!text || typeof text !== "string") return "";

  const clean = text
    .normalize("NFKD") // Normalize unicode characters
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove non-word chars (except spaces and hyphens)
    .trim()
    .replace(/[\s_-]+/g, "-") // Replace spaces and underscores with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading and trailing hyphens

  return clean;
}

/**
 * Generates an available unique slug. If the base slug is taken,
 * appends an incremental counter (e.g., "masjid-2") or a random suffix.
 */
export async function generateUniqueSlug(
  baseText: string,
  existsCheck: (slug: string) => Promise<boolean>,
): Promise<string> {
  let base = slugify(baseText);

  // If text was non-latin only (e.g. Arabic/Bengali only) and slugify yielded empty,
  // create a safe fallback base: "mosque"
  if (!base || base.length < 3) {
    base = `mosque-${crypto.randomBytes(3).toString("hex")}`;
  }

  // Truncate to maximum 50 characters to leave room for numeric/random suffixes
  if (base.length > 50) {
    base = base.slice(0, 50).replace(/-+$/, "");
  }

  if (!(await existsCheck(base))) {
    return base;
  }

  // Try numeric suffixes up to 10
  for (let counter = 2; counter <= 10; counter++) {
    const candidate = `${base}-${counter}`;
    if (!(await existsCheck(candidate))) {
      return candidate;
    }
  }

  // If still colliding, append random 4-byte hex
  const randomSuffix = crypto.randomBytes(2).toString("hex");
  return `${base}-${randomSuffix}`;
}
