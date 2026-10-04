// ---------------------------------------------------------------------------
// Express Request augmentation
//
// Adds `req.user` so every downstream middleware and controller has
// type-safe access to the verified token payload without casting.
//
// This file is picked up automatically by TypeScript because it uses
// `declare global` — no explicit import needed in other files.
// ---------------------------------------------------------------------------

import type { AccessTokenPayload } from "../utils/token.js";
import type { Membership } from "../../generated/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by the `authenticate` middleware after a valid access token
       * is verified. Undefined on unauthenticated/public routes.
       */
      user?: AccessTokenPayload;

      /**
       * Populated by `requireMosqueMembership` middleware after verifying the caller's
       * live active membership in the mosque identified by :mosqueId.
       */
      membership?: Membership;

      /**
       * Validated mosqueId extracted from params by tenant middlewares.
       */
      mosqueId?: string;
    }
  }
}

export {};
