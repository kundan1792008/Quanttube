import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createSession,
  getSession,
  transitionMode,
  deleteSession,
  listSessions,
  extractAudioBuffer,
} from "../services";
import { PlaybackMode } from "../types";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateSessionSchema = z.object({
  streamUrl: z.string().url("streamUrl must be a valid URL"),
  mode: z
    .enum(Object.values(PlaybackMode) as [PlaybackMode, ...PlaybackMode[]])
    .optional(),
});

const TransitionModeSchema = z.object({
  mode: z.enum(Object.values(PlaybackMode) as [PlaybackMode, ...PlaybackMode[]], {
    error: () => ({
      message: `mode is required and must be one of: ${Object.values(PlaybackMode).join(", ")}`,
    }),
  }),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/sessions
 * Create a new media session that intercepts a video stream.
 */
router.post("/", (req: Request, res: Response) => {
  const parse = CreateSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const { streamUrl, mode } = parse.data;
  const session = createSession(streamUrl, mode);
  res.status(201).json(session);
});

/**
 * GET /api/sessions
 * List all active sessions.
 */
router.get("/", (_req: Request, res: Response) => {
  res.json(listSessions());
});

/**
 * GET /api/sessions/:id
 * Retrieve a single session.
 */
router.get("/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

/**
 * PATCH /api/sessions/:id/mode
 * Transition a session to a new playback mode.
 *
 * When switching to `audio-only` (background / Drive Mode), the visual
 * render is dropped but OTT cache is preserved.
 */
router.patch("/:id/mode", (req: Request, res: Response) => {
  const parse = TransitionModeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const session = transitionMode(req.params.id, parse.data.mode);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

/**
 * GET /api/sessions/:id/audio
 * Extract the audio buffer from the session's stream (Podcast / Spotify mode).
 */
router.get("/:id/audio", (req: Request, res: Response) => {
  const audio = extractAudioBuffer(req.params.id);
  if (!audio) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(audio);
});

/**
 * DELETE /api/sessions/:id
 * Terminate a session.
 */
router.delete("/:id", (req: Request, res: Response) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.status(204).send();
});

export default router;
