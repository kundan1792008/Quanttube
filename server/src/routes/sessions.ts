import { Router, Request, Response } from "express";
import {
  createSession,
  getSession,
  transitionMode,
  deleteSession,
  listSessions,
  extractAudioBuffer,
} from "../services";
import { PlaybackMode, CreateSessionRequest, TransitionModeRequest } from "../types";

const router = Router();

/**
 * POST /api/sessions
 * Create a new media session that intercepts a video stream.
 */
router.post("/", (req: Request, res: Response) => {
  const { streamUrl, mode } = req.body as CreateSessionRequest;
  if (!streamUrl || typeof streamUrl !== "string") {
    res.status(400).json({ error: "streamUrl is required" });
    return;
  }
  const validModes = Object.values(PlaybackMode) as string[];
  if (mode && !validModes.includes(mode)) {
    res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(", ")}` });
    return;
  }
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
  const { mode } = req.body as TransitionModeRequest;
  const validModes = Object.values(PlaybackMode) as string[];
  if (!mode || !validModes.includes(mode)) {
    res.status(400).json({ error: `mode is required and must be one of: ${validModes.join(", ")}` });
    return;
  }
  const session = transitionMode(req.params.id, mode);
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
