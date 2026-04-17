/**
 * Remix API routes.
 *
 *   POST   /api/remixes/style-transfer          – apply style to video
 *   POST   /api/remixes/background-swap         – AI background replacement
 *   POST   /api/remixes/alternate-ending        – generate alternate ending
 *   POST   /api/remixes/visual-effects          – add visual effects
 *   GET    /api/remixes/jobs/:jobId             – get a remix job
 *   GET    /api/remixes/videos/:videoId/jobs    – list jobs for a video
 *
 *   POST   /api/remixes/audio/music             – change background music
 *   POST   /api/remixes/audio/sfx               – add SFX at timestamps
 *   POST   /api/remixes/audio/speed             – time-stretch speed change
 *   POST   /api/remixes/audio/voice-clone       – re-dub with cloned voice
 *   GET    /api/remixes/audio/jobs/:jobId       – get an audio job
 *   GET    /api/remixes/audio/videos/:videoId/jobs – list audio jobs for a video
 *
 *   GET    /api/remixes/trending                – trending remixes feed
 *   GET    /api/remixes/chains/:originalVideoId – remix chain for a video
 *   GET    /api/remixes/:remixId/attribution    – attribution for a remix
 *   POST   /api/remixes/:remixId/publish        – one-click publish
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import logger from "../logger";
import {
  applyStyleTransfer,
  swapBackground,
  generateAlternateEnding,
  addVisualEffects,
  getRemixJob,
  listRemixJobs,
  STYLE_PRESETS,
  VISUAL_EFFECTS,
  BACKGROUND_PRESETS,
  StylePreset,
  VisualEffect,
} from "../services/RemixEngine";
import {
  changeMusic,
  addSoundEffects,
  speedChange,
  voiceClone,
  getAudioJob,
  listAudioJobs,
  MUSIC_GENRES,
  SOUND_EFFECTS,
  MusicGenre,
  SoundEffectId,
} from "../services/AudioRemixService";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas – video remix
// ---------------------------------------------------------------------------

const StyleTransferSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  style: z.enum(STYLE_PRESETS as unknown as [StylePreset, ...StylePreset[]]),
});

const BackgroundSwapSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  newBackground: z.string().min(1, "newBackground is required"),
});

const AlternateEndingSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  prompt: z
    .string()
    .min(1, "prompt is required")
    .max(500, "prompt must be 500 characters or fewer"),
});

const VisualEffectsSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  effects: z
    .array(z.enum(VISUAL_EFFECTS as unknown as [VisualEffect, ...VisualEffect[]]))
    .min(1, "effects must contain at least one item"),
});

// ---------------------------------------------------------------------------
// Zod schemas – audio remix
// ---------------------------------------------------------------------------

const MusicChangeSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  genre: z.enum(MUSIC_GENRES as unknown as [MusicGenre, ...MusicGenre[]]),
});

const SfxTimestampSchema = z.object({
  timestampSeconds: z.number().min(0, "timestampSeconds must be non-negative"),
  effectId: z.enum(SOUND_EFFECTS as unknown as [SoundEffectId, ...SoundEffectId[]]),
  volume: z.number().min(0).max(2).optional(),
});

const SfxInjectionSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  timestamps: z.array(SfxTimestampSchema).min(1, "timestamps must contain at least one item"),
});

const SpeedChangeSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  factor: z.number().min(0.25).max(4.0),
});

const VoiceCloneSchema = z.object({
  videoId: z.string().min(1, "videoId is required"),
  targetVoiceId: z.string().min(1, "targetVoiceId is required"),
});

// ---------------------------------------------------------------------------
// Zod schemas – publish & trending
// ---------------------------------------------------------------------------

const PublishSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(20).optional(),
  originalVideoId: z.string().min(1, "originalVideoId is required"),
  originalCreatorHandle: z.string().min(1, "originalCreatorHandle is required"),
});

// ---------------------------------------------------------------------------
// In-memory published-remixes store
// ---------------------------------------------------------------------------

interface PublishedRemix {
  remixId: string;
  jobId: string;
  jobType: string;
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  originalVideoId: string;
  originalCreatorHandle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  remixCount: number;
  outputUrl: string | null;
}

const publishedRemixes = new Map<string, PublishedRemix>();

/** Generate deterministic trending seed data for demo purposes. */
function seedTrendingRemixes(): void {
  if (publishedRemixes.size > 0) return;

  const seeds: Array<Omit<PublishedRemix, "publishedAt">> = [
    {
      remixId: "remix-trending-001",
      jobId: "job-001",
      jobType: "style-transfer",
      videoId: "video-001",
      title: "Cyberpunk City Chase – Anime Edition",
      description: "Original car chase remixed into anime style",
      tags: ["anime", "action", "cyberpunk"],
      originalVideoId: "video-001",
      originalCreatorHandle: "@speedrunner",
      viewCount: 124_500,
      likeCount: 8_340,
      remixCount: 42,
      outputUrl: "https://cdn.quanttube.app/remixes/style-transfer/job-001/output.mp4",
    },
    {
      remixId: "remix-trending-002",
      jobId: "job-002",
      jobType: "visual-effects",
      videoId: "video-002",
      title: "Concert Footage + VHS Glitch",
      description: "Live concert remixed with retro VHS scan lines and glitch effects",
      tags: ["music", "retro", "vhs", "glitch"],
      originalVideoId: "video-002",
      originalCreatorHandle: "@stagemaster",
      viewCount: 98_200,
      likeCount: 6_110,
      remixCount: 29,
      outputUrl: "https://cdn.quanttube.app/remixes/visual-effects/job-002/output.mp4",
    },
    {
      remixId: "remix-trending-003",
      jobId: "job-003",
      jobType: "music-change",
      videoId: "video-003",
      title: "Travel Vlog + Synthwave Soundtrack",
      description: "Tokyo travel vlog with the original music replaced by synthwave",
      tags: ["travel", "synthwave", "tokyo"],
      originalVideoId: "video-003",
      originalCreatorHandle: "@wanderlustvids",
      viewCount: 75_600,
      likeCount: 5_090,
      remixCount: 17,
      outputUrl: "https://cdn.quanttube.app/audio-remixes/music-change/job-003/output.mp4",
    },
    {
      remixId: "remix-trending-004",
      jobId: "job-004",
      jobType: "alternate-ending",
      videoId: "video-004",
      title: "Short Film – The Other Path",
      description: "AI-generated alternate ending where the hero chooses differently",
      tags: ["shortfilm", "drama", "ai-generated"],
      originalVideoId: "video-004",
      originalCreatorHandle: "@indiestudios",
      viewCount: 61_000,
      likeCount: 4_830,
      remixCount: 11,
      outputUrl: "https://cdn.quanttube.app/remixes/alternate-ending/job-004/output.mp4",
    },
    {
      remixId: "remix-trending-005",
      jobId: "job-005",
      jobType: "background-swap",
      videoId: "video-005",
      title: "Home Workout in Space",
      description: "Indoor workout video with background swapped to outer space",
      tags: ["fitness", "space", "comedy"],
      originalVideoId: "video-005",
      originalCreatorHandle: "@fitnessguru",
      viewCount: 53_400,
      likeCount: 3_970,
      remixCount: 8,
      outputUrl: "https://cdn.quanttube.app/remixes/background-swap/job-005/output.mp4",
    },
  ];

  const baseDate = new Date("2026-04-01T00:00:00.000Z");
  seeds.forEach((seed, i) => {
    const publishedAt = new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000).toISOString();
    publishedRemixes.set(seed.remixId, { ...seed, publishedAt });
  });
}

// Seed on module load.
seedTrendingRemixes();

// ---------------------------------------------------------------------------
// Video remix endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/remixes/style-transfer
 * Apply a visual style (anime, noir, etc.) to the entire video.
 */
router.post("/style-transfer", (req: Request, res: Response) => {
  const parse = StyleTransferSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = applyStyleTransfer(parse.data.videoId, parse.data.style);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId, style: result.style }, "style-transfer job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/background-swap
 * AI-powered background removal and compositing.
 */
router.post("/background-swap", (req: Request, res: Response) => {
  const parse = BackgroundSwapSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = swapBackground(parse.data.videoId, parse.data.newBackground);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId }, "background-swap job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/alternate-ending
 * Generate a new ending using a text prompt.
 */
router.post("/alternate-ending", (req: Request, res: Response) => {
  const parse = AlternateEndingSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = generateAlternateEnding(parse.data.videoId, parse.data.prompt);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId }, "alternate-ending job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/visual-effects
 * Add one or more visual effects (rain, snow, fire, glitch, etc.).
 */
router.post("/visual-effects", (req: Request, res: Response) => {
  const parse = VisualEffectsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = addVisualEffects(parse.data.videoId, parse.data.effects);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId, effects: result.effects }, "visual-effects job created");
  res.status(202).json(result);
});

/**
 * GET /api/remixes/jobs/:jobId
 * Retrieve a video remix job by ID.
 */
router.get("/jobs/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = getRemixJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Remix job ${jobId} not found` });
    return;
  }

  res.json(job);
});

/**
 * GET /api/remixes/videos/:videoId/jobs
 * List all remix jobs for a specific video.
 */
router.get("/videos/:videoId/jobs", (req: Request, res: Response) => {
  const { videoId } = req.params;
  if (!videoId) {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  const jobs = listRemixJobs({ videoId });
  res.json({ videoId, count: jobs.length, jobs });
});

// ---------------------------------------------------------------------------
// Audio remix endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/remixes/audio/music
 * Replace background music while preserving speech.
 */
router.post("/audio/music", (req: Request, res: Response) => {
  const parse = MusicChangeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = changeMusic(parse.data.videoId, parse.data.genre);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId, genre: result.genre }, "music-change job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/audio/sfx
 * Add SFX at specific timestamps.
 */
router.post("/audio/sfx", (req: Request, res: Response) => {
  const parse = SfxInjectionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = addSoundEffects(parse.data.videoId, parse.data.timestamps);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId }, "sfx-injection job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/audio/speed
 * Time-stretch without pitch change.
 */
router.post("/audio/speed", (req: Request, res: Response) => {
  const parse = SpeedChangeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = speedChange(parse.data.videoId, parse.data.factor);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId, factor: result.factor }, "speed-change job created");
  res.status(202).json(result);
});

/**
 * POST /api/remixes/audio/voice-clone
 * Re-dub with a different voice while maintaining lip sync.
 */
router.post("/audio/voice-clone", (req: Request, res: Response) => {
  const parse = VoiceCloneSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const result = voiceClone(parse.data.videoId, parse.data.targetVoiceId);
  if (!("jobId" in result)) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: result.videoId, targetVoiceId: result.targetVoiceId }, "voice-clone job created");
  res.status(202).json(result);
});

/**
 * GET /api/remixes/audio/jobs/:jobId
 * Retrieve an audio remix job by ID.
 */
router.get("/audio/jobs/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = getAudioJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Audio job ${jobId} not found` });
    return;
  }

  res.json(job);
});

/**
 * GET /api/remixes/audio/videos/:videoId/jobs
 * List audio remix jobs for a specific video.
 */
router.get("/audio/videos/:videoId/jobs", (req: Request, res: Response) => {
  const { videoId } = req.params;
  if (!videoId) {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  const jobs = listAudioJobs({ videoId });
  res.json({ videoId, count: jobs.length, jobs });
});

// ---------------------------------------------------------------------------
// Trending remixes feed
// ---------------------------------------------------------------------------

/**
 * GET /api/remixes/trending
 * Return the most popular published remixes sorted by view count.
 */
router.get("/trending", (_req: Request, res: Response) => {
  const trending = Array.from(publishedRemixes.values())
    .sort((a, b) => b.viewCount - a.viewCount)
    .map((remix) => ({
      remixId: remix.remixId,
      title: remix.title,
      description: remix.description,
      tags: remix.tags,
      jobType: remix.jobType,
      outputUrl: remix.outputUrl,
      attribution: {
        originalVideoId: remix.originalVideoId,
        originalCreatorHandle: remix.originalCreatorHandle,
        label: `Remixed from ${remix.originalCreatorHandle}`,
      },
      stats: {
        viewCount: remix.viewCount,
        likeCount: remix.likeCount,
        remixCount: remix.remixCount,
      },
      publishedAt: remix.publishedAt,
    }));

  res.json({ count: trending.length, remixes: trending });
});

// ---------------------------------------------------------------------------
// Remix chains
// ---------------------------------------------------------------------------

/**
 * GET /api/remixes/chains/:originalVideoId
 * Return all remixes that trace back to a given original video.
 */
router.get("/chains/:originalVideoId", (req: Request, res: Response) => {
  const { originalVideoId } = req.params;
  if (!originalVideoId) {
    res.status(400).json({ error: "originalVideoId is required" });
    return;
  }

  const chain = Array.from(publishedRemixes.values())
    .filter((r) => r.originalVideoId === originalVideoId)
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
    .map((remix) => ({
      remixId: remix.remixId,
      title: remix.title,
      jobType: remix.jobType,
      outputUrl: remix.outputUrl,
      attribution: {
        originalVideoId: remix.originalVideoId,
        originalCreatorHandle: remix.originalCreatorHandle,
        label: `Remixed from ${remix.originalCreatorHandle}`,
      },
      stats: {
        viewCount: remix.viewCount,
        likeCount: remix.likeCount,
        remixCount: remix.remixCount,
      },
      publishedAt: remix.publishedAt,
    }));

  res.json({ originalVideoId, chainLength: chain.length, chain });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * GET /api/remixes/:remixId/attribution
 * Return attribution details for a specific remix.
 */
router.get("/:remixId/attribution", (req: Request, res: Response) => {
  const { remixId } = req.params;
  const remix = publishedRemixes.get(remixId);
  if (!remix) {
    res.status(404).json({ error: `Remix ${remixId} not found` });
    return;
  }

  res.json({
    remixId: remix.remixId,
    title: remix.title,
    originalVideoId: remix.originalVideoId,
    originalCreatorHandle: remix.originalCreatorHandle,
    label: `Remixed from ${remix.originalCreatorHandle}`,
    deepLink: `https://quanttube.app/watch/${remix.originalVideoId}`,
    publishedAt: remix.publishedAt,
  });
});

// ---------------------------------------------------------------------------
// One-click publish
// ---------------------------------------------------------------------------

/**
 * POST /api/remixes/:remixId/publish
 * Publish a completed remix to the Quanttube feed.
 */
router.post("/:remixId/publish", (req: Request, res: Response) => {
  const { remixId } = req.params;

  const parse = PublishSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  // Check if this remixId is a valid job in either store.
  const videoJob = getRemixJob(remixId);
  const audioJob = getAudioJob(remixId);
  const job = videoJob ?? audioJob;

  if (!job) {
    // Allow publishing ad-hoc remixes that aren't tracked (e.g. uploaded externally)
    // by accepting the provided remixId directly.
    if (!remixId || !remixId.trim()) {
      res.status(400).json({ error: "remixId is required" });
      return;
    }
  }

  if (job && job.status !== "completed") {
    res.status(409).json({
      error: `Cannot publish: job ${remixId} is in status "${job.status}". Wait for completion.`,
    });
    return;
  }

  if (publishedRemixes.has(remixId)) {
    res.status(409).json({ error: "Remix is already published" });
    return;
  }

  const published: PublishedRemix = {
    remixId,
    jobId: remixId,
    jobType: job?.type ?? "unknown",
    videoId: job?.videoId ?? parse.data.originalVideoId,
    title: parse.data.title,
    description: parse.data.description ?? "",
    tags: parse.data.tags ?? [],
    originalVideoId: parse.data.originalVideoId,
    originalCreatorHandle: parse.data.originalCreatorHandle,
    publishedAt: new Date().toISOString(),
    viewCount: 0,
    likeCount: 0,
    remixCount: 0,
    outputUrl: job?.outputUrl ?? null,
  };

  publishedRemixes.set(remixId, published);
  logger.info({ remixId, videoId: published.videoId }, "remix published");
  res.status(201).json(published);
});

// ---------------------------------------------------------------------------
// Metadata helpers (available constants)
// ---------------------------------------------------------------------------

/**
 * GET /api/remixes/meta/styles
 * List all available style presets.
 */
router.get("/meta/styles", (_req: Request, res: Response) => {
  res.json({ count: STYLE_PRESETS.length, styles: [...STYLE_PRESETS] });
});

/**
 * GET /api/remixes/meta/effects
 * List all available visual effects.
 */
router.get("/meta/effects", (_req: Request, res: Response) => {
  res.json({ count: VISUAL_EFFECTS.length, effects: [...VISUAL_EFFECTS] });
});

/**
 * GET /api/remixes/meta/backgrounds
 * List all available background presets.
 */
router.get("/meta/backgrounds", (_req: Request, res: Response) => {
  res.json({ count: BACKGROUND_PRESETS.length, backgrounds: [...BACKGROUND_PRESETS] });
});

/**
 * GET /api/remixes/meta/music-genres
 * List all available music genres.
 */
router.get("/meta/music-genres", (_req: Request, res: Response) => {
  res.json({ count: MUSIC_GENRES.length, genres: [...MUSIC_GENRES] });
});

/**
 * GET /api/remixes/meta/sound-effects
 * List all available sound effects.
 */
router.get("/meta/sound-effects", (_req: Request, res: Response) => {
  res.json({ count: SOUND_EFFECTS.length, soundEffects: [...SOUND_EFFECTS] });
});

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetPublishedRemixes(): void {
  publishedRemixes.clear();
  seedTrendingRemixes();
}

export { uuidv4 };
export default router;
