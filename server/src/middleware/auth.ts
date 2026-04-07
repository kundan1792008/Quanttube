import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import logger from "../logger";

const QUANTMAIL_JWT_SECRET = process.env.QUANTMAIL_JWT_SECRET;
const QUANTMAIL_ISSUER = process.env.QUANTMAIL_ISSUER ?? "quantmail";
const QUANTMAIL_AUDIENCE = process.env.QUANTMAIL_AUDIENCE;

export interface QuantmailJwtPayload {
  sub: string;          // Quantmail user ID (biometric SSO subject)
  email?: string;
  displayName?: string;
  biometricVerified: boolean;
  iat: number;
  exp: number;
  iss: string;
}

/** Extend Express Request to carry the decoded Quantmail identity. */
declare global {
  namespace Express {
    interface Request {
      quantmailUser?: QuantmailJwtPayload;
    }
  }
}

/**
 * requireQuantmailAuth – Express middleware that validates a Quantmail-issued
 * JWT from the `Authorization: Bearer <token>` header.
 *
 * Only users who have completed biometric verification (`biometricVerified: true`)
 * are admitted.  No local passwords are used anywhere in Quanttube.
 */
export function requireQuantmailAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  if (!QUANTMAIL_JWT_SECRET) {
    logger.warn("QUANTMAIL_JWT_SECRET is not set – rejecting all auth requests");
    res.status(503).json({ error: "Authentication service not configured" });
    return;
  }

  try {
    const payload = jwt.verify(token, QUANTMAIL_JWT_SECRET, {
      algorithms: ["HS256"],
      audience: QUANTMAIL_AUDIENCE,
      issuer: QUANTMAIL_ISSUER,
    }) as QuantmailJwtPayload;

    if (!payload.biometricVerified) {
      res.status(403).json({ error: "Biometric verification required" });
      return;
    }

    req.quantmailUser = payload;
    next();
  } catch (err) {
    logger.debug({ err }, "JWT verification failed");
    res.status(401).json({ error: "Invalid or expired Quantmail token" });
  }
}
