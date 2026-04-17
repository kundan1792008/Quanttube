import { Request, Response, NextFunction } from "express";
import logger from "../logger";

/**
 * Global Express error-handling middleware.
 *
 * Must be registered as the last middleware in the chain so it catches any
 * error passed via `next(err)` from route handlers and other middleware.
 *
 * Produces a consistent JSON error envelope for all unhandled errors while
 * keeping internal details out of the response body in production.
 */
export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === "production";

  // Determine HTTP status – honour statusCode/status set on the error object
  let status = 500;
  if (err instanceof Error && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number") {
    status = (err as { statusCode: number }).statusCode;
  } else if (err instanceof Error && "status" in err && typeof (err as { status: unknown }).status === "number") {
    status = (err as { status: number }).status;
  }

  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";

  logger.error({ err, status }, "Unhandled error");

  res.status(status).json({
    error: isProduction && status === 500 ? "Internal server error" : message,
    ...(isProduction ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });
}
