import pino from "pino";

/**
 * Singleton Pino logger for the Quanttube Format-Shifting Engine.
 * Always uses JSON output so logs are machine-parseable.
 * In test environments the transport worker is skipped to keep Jest clean.
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "quanttube-engine",
    version: process.env.npm_package_version ?? "1.0.0",
  },
});

export default logger;
