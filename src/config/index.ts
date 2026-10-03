import "dotenv/config";

// ---------------------------------------------------------------------------
// Config — single source of truth for all environment-derived values.
// All values are validated at startup; a missing required var exits the
// process rather than silently producing undefined-driven bugs at runtime.
// ---------------------------------------------------------------------------

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `[Config] Environment variable ${key} must be an integer, got: "${raw}"`,
    );
  }
  return parsed;
}

const config = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: optionalInt("PORT", 5000),

  APP_URL: optional("APP_URL", "http://localhost:5000"),
  CLIENT_URL: optional("CLIENT_URL", "http://localhost:3000"),

  DATABASE_URL: required("DATABASE_URL"),

  // JSON Web Tokens
  JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: required("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES_IN: optional("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_ACCESS_EXPIRES_IN_MS: optionalInt(
    "JWT_ACCESS_EXPIRES_IN_MS",
    15 * 60 * 1000, // 15 minutes
  ),
  JWT_REFRESH_EXPIRES_IN_MS: optionalInt(
    "JWT_REFRESH_EXPIRES_IN_MS",
    7 * 24 * 60 * 60 * 1000, // 7 days
  ),

  // Bcrypt
  BCRYPT_ROUNDS: optionalInt("BCRYPT_ROUNDS", 12),

  // Email (SMTP / provider config added later)
  SMTP_HOST: optional("SMTP_HOST", ""),
  SMTP_PORT: optionalInt("SMTP_PORT", 587),
  SMTP_USER: optional("SMTP_USER", ""),
  SMTP_PASS: optional("SMTP_PASS", ""),
  SMTP_FROM: optional("SMTP_FROM", "no-reply@mashjid-hisab.com"),

  // Email verification token TTL (milliseconds)
  EMAIL_VERIFY_TOKEN_TTL_MS: optionalInt(
    "EMAIL_VERIFY_TOKEN_TTL_MS",
    24 * 60 * 60 * 1000, // 24 hours
  ),
} as const;

export type AppConfig = typeof config;
export default config;