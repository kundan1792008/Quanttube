/**
 * remixes.ts – REST API for the AI Video Remix Engine.
 *
 * Mounted under `/api/remixes`.
 *
 * Video remix jobs (queue-based, async):
 *   POST   /api/remixes/style                  – start style-transfer job
 *   POST   /api/remixes/background             – start background-swap job
 *   POST   /api/remixes/ending                 – start alternate-ending job
 *   POST   /api/remixes/effects                – start visual-effects job
 *   GET    /api/remixes/jobs                   – list remix jobs (filter by videoId/type/status)
 *   GET    /api/remixes/jobs/:jobId            – get remix job status
 *
 * Audio remix jobs:
 *   POST   /api/remixes/audio/music            – change background music by genre
 *   POST   /api/remixes/audio/sfx              – add SFX at timestamps
 *   POST   /api/remixes/audio/speed            – time-stretch (pitch-preserved)
 *   POST   /api/remixes/audio/voice            – voice-clone re-dub
 *   GET    /api/remixes/audio/jobs             – list audio jobs
 *   GET    /api/remixes/audio/jobs/:jobId      – get audio job status
 *
 * Publish / discover:
 *   POST   /api/remixes/jobs/:jobId/publish    – publish a completed remix
 *   GET    /api/remixes/trending               – trending published remixes
 *   GET    /api/remixes/chains/:originalVideoId – all remixes derived from an original
 *   GET    /api/remixes/published/:remixId     – get one published remix (bumps viewCount)
 *
 * Catalogues (for UI pickers):
 *   GET    /api/remixes/meta/styles
 *   GET    /api/remixes/meta/backgrounds
 *   GET    /api/remixes/meta/effects
 *   GET    /api/remixes/meta/genres
 *   GET    /api/remixes/meta/sfx
 *   GET    /api/remixes/meta/voices
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import logger from "../logger";
import {
  STYLE_PRESETS,
  BACKGROUND_PRESETS,
  VISUAL_EFFECTS,
  applyStyleTransfer,
  swapBackground,
  generateAlternateEnding,
  addVisualEffects,
  getRemixJob,
  listRemixJobs,
  publishRemix,
  getTrendingRemixes,
  getRemixChain,
  getPublishedRemix,
  incrementRemixViewCount,
  RemixJobType,
  RemixJobStatus,
} from "../services/RemixEngine";
import {
  MUSIC_GENRES,
  SFX_IDS,
  VOICE_BANK,
  changeMusic,
  addSoundEffects,
  speedChange,
  voiceClone,
  getAudioJob,
  listAudioJobs,
  AudioJobType,
  AudioJobStatus,
} from "../services/AudioRemixService";

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const VideoIdField = z.string().min(1, "videoId is required").max(200);

const StyleRequest = z.object({
  videoId: VideoIdField,
  style: z.enum(STYLE_PRESETS),
});

const BackgroundRequest = z.object({
  videoId: VideoIdField,
  newBackground: z.string().min(1).max(500),
});

const EndingRequest = z.object({
  videoId: VideoIdField,
  prompt: z.string().max(500),
});

const EffectsRequest = z.object({
  videoId: VideoIdField,
  effects: z
    .array(z.enum(VISUAL_EFFECTS))
    .min(1, "effects must contain at least one entry")
    .max(VISUAL_EFFECTS.length),
});

const MusicRequest = z.object({
  videoId: VideoIdField,
  genre: z.enum(MUSIC_GENRES),
});

const SfxRequest = z.object({
  videoId: VideoIdField,
  entries: z
    .array(
      z.object({
        timestampSecs: z.number().nonnegative(),
        effectId: z.enum(SFX_IDS),
        volumeDb: z.number().min(-24).max(12).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const SpeedRequest = z.object({
  videoId: VideoIdField,
  factor: z.number().min(0.25).max(4.0),
});

const VoiceRequest = z.object({
  videoId: VideoIdField,
  targetVoiceId: z.enum(VOICE_BANK),
});

const PublishRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  originalCreatorHandle: z.string().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendZodError(res: Response, err: z.ZodError): void {
  res.status(400).json({
    error: err.issues[0]?.message ?? "Invalid request body",
    details: err.issues,
  });
}

function handleThrown(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: msg });
}

// ---------------------------------------------------------------------------
// Video remix job routes
// ---------------------------------------------------------------------------

router.post("/style", (req: Request, res: Response) => {
  const parse = StyleRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = applyStyleTransfer(parse.data.videoId, parse.data.style);
    logger.info({ jobId: job.jobId, videoId: job.videoId }, "Remix style-transfer queued");
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/background", (req: Request, res: Response) => {
  const parse = BackgroundRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = swapBackground(parse.data.videoId, parse.data.newBackground);
    logger.info({ jobId: job.jobId, videoId: job.videoId }, "Remix background-swap queued");
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/ending", (req: Request, res: Response) => {
  const parse = EndingRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = generateAlternateEnding(parse.data.videoId, parse.data.prompt);
    logger.info({ jobId: job.jobId, videoId: job.videoId }, "Remix alternate-ending queued");
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/effects", (req: Request, res: Response) => {
  const parse = EffectsRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = addVisualEffects(parse.data.videoId, parse.data.effects);
    logger.info({ jobId: job.jobId, videoId: job.videoId }, "Remix visual-effects queued");
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.get("/jobs", (req: Request, res: Response) => {
  const { videoId, type, status } = req.query as Record<string, string | undefined>;
  const jobs = listRemixJobs({
    videoId,
    type: type as RemixJobType | undefined,
    status: status as RemixJobStatus | undefined,
  });
  res.json({ total: jobs.length, items: jobs });
});

router.get("/jobs/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getRemixJob(jobId!);
  if (!job) {
    res.status(404).json({ error: `Remix job '${jobId}' not found` });
    return;
  }
  res.json(job);
});

// ---------------------------------------------------------------------------
// Audio remix job routes
// ---------------------------------------------------------------------------

router.post("/audio/music", (req: Request, res: Response) => {
  const parse = MusicRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = changeMusic(parse.data.videoId, parse.data.genre);
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/audio/sfx", (req: Request, res: Response) => {
  const parse = SfxRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = addSoundEffects(parse.data.videoId, parse.data.entries);
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/audio/speed", (req: Request, res: Response) => {
  const parse = SpeedRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = speedChange(parse.data.videoId, parse.data.factor);
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.post("/audio/voice", (req: Request, res: Response) => {
  const parse = VoiceRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);
  try {
    const job = voiceClone(parse.data.videoId, parse.data.targetVoiceId);
    res.status(202).json(job);
  } catch (err) {
    handleThrown(res, err);
  }
});

router.get("/audio/jobs", (req: Request, res: Response) => {
  const { videoId, type, status } = req.query as Record<string, string | undefined>;
  const jobs = listAudioJobs({
    videoId,
    type: type as AudioJobType | undefined,
    status: status as AudioJobStatus | undefined,
  });
  res.json({ total: jobs.length, items: jobs });
});

router.get("/audio/jobs/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getAudioJob(jobId!);
  if (!job) {
    res.status(404).json({ error: `Audio remix job '${jobId}' not found` });
    return;
  }
  res.json(job);
});

// ---------------------------------------------------------------------------
// Publish / discover
// ---------------------------------------------------------------------------

router.post("/jobs/:jobId/publish", (req: Request, res: Response) => {
  const { jobId } = req.params;
  const parse = PublishRequest.safeParse(req.body);
  if (!parse.success) return sendZodError(res, parse.error);

  const job = getRemixJob(jobId!);
  if (!job) {
    res.status(404).json({ error: `Remix job '${jobId}' not found` });
    return;
  }
  if (job.status !== "completed") {
    res
      .status(409)
      .json({ error: `Remix job '${jobId}' is not completed (status: ${job.status})` });
    return;
  }

  try {
    const published = publishRemix(jobId!, parse.data);
    logger.info({ remixId: published.remixId, jobId }, "Remix published");
    res.status(201).json(published);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Duplicate-publish and similar lifecycle violations → 409.
    if (/already been published/i.test(msg)) {
      res.status(409).json({ error: msg });
      return;
    }
    if (/not completed/i.test(msg)) {
      res.status(409).json({ error: msg });
      return;
    }
    if (/not found/i.test(msg)) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

router.get("/trending", (req: Request, res: Response) => {
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "20";
  const limit = Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 20));
  const items = getTrendingRemixes(limit).map((r) => ({
    ...r,
    attribution: r.originalCreatorHandle
      ? `Remixed from @${r.originalCreatorHandle}`
      : `Remixed from video ${r.originalVideoId}`,
  }));
  res.json({ total: items.length, items });
});

router.get("/chains/:originalVideoId", (req: Request, res: Response) => {
  const { originalVideoId } = req.params;
  const items = getRemixChain(originalVideoId!);
  res.json({ originalVideoId, total: items.length, items });
});

router.get("/published/:remixId", (req: Request, res: Response) => {
  const { remixId } = req.params;
  const r = getPublishedRemix(remixId!);
  if (!r) {
    res.status(404).json({ error: `Published remix '${remixId}' not found` });
    return;
  }
  const updated = incrementRemixViewCount(remixId!) ?? r;
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

router.get("/meta/styles", (_req: Request, res: Response) => {
  res.json({ items: STYLE_PRESETS });
});
router.get("/meta/backgrounds", (_req: Request, res: Response) => {
  res.json({ items: BACKGROUND_PRESETS });
});
router.get("/meta/effects", (_req: Request, res: Response) => {
  res.json({ items: VISUAL_EFFECTS });
});
router.get("/meta/genres", (_req: Request, res: Response) => {
  res.json({ items: MUSIC_GENRES });
});
router.get("/meta/sfx", (_req: Request, res: Response) => {
  res.json({ items: SFX_IDS });
});
router.get("/meta/voices", (_req: Request, res: Response) => {
  res.json({ items: VOICE_BANK });
});

export default router;
