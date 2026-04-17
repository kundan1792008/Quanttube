import express from "express";
import pinoHttp from "pino-http";
import sessionRoutes from "./routes/sessions";
import dubbingRoutes from "./routes/dubbing";
import reelsRoutes from "./routes/reels";
import streamRoutes from "./routes/stream";
import cinemaRoutes from "./routes/cinema";
import feedRoutes from "./routes/feed";
import videosRoutes, { playlistsRouter, recommendationsRouter } from "./routes/videos";
import logger from "./logger";
import { globalErrorHandler } from "./middleware/error";

const app = express();

/** Structured request/response logging via Pino. */
app.use(pinoHttp({ logger }));

app.use(express.json());

/** Health check */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", engine: "format-shifting-engine", version: "1.0.0" });
});

/** Session & stream management */
app.use("/api/sessions", sessionRoutes);

/** Deep-Dubbing ML endpoints */
app.use("/api/dubbing", dubbingRoutes);

/** Quanttube reels sharing + deep-link + Quantsink pressure endpoints */
app.use("/api/reels", reelsRoutes);

/** Adaptive HLS streaming (v1) */
app.use("/api/v1/stream", streamRoutes);

/** Interactive Cinema – AI story choices (v1) */
app.use("/api/v1/cinema", cinemaRoutes);

/** Telepathic Feed Engine – cross-app signal ingestion + recommendations (v1) */
app.use("/api/v1/feed", feedRoutes);

/** Video pipeline: upload, transcode, dubbing, CRUD */
app.use("/api/v1/videos", videosRoutes);

/** Playlists */
app.use("/api/v1/playlists", playlistsRouter);

/** Hybrid recommendations */
app.use("/api/v1/recommendations", recommendationsRouter);

/** Global error handler – must be registered last */
app.use(globalErrorHandler);

export default app;
