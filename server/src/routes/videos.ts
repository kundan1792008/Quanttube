/**
 * videos.ts – Complete REST API for videos, comments, likes, and playlists.
 *
 * Routes:
 *   POST   /api/v1/videos              – create/register a video
 *   GET    /api/v1/videos              – list videos
 *   GET    /api/v1/videos/:id          – get video by ID
 *   PATCH  /api/v1/videos/:id          – update video metadata
 *   DELETE /api/v1/videos/:id          – delete video
 *
 *   POST   /api/v1/videos/:id/comments – add a comment
 *   GET    /api/v1/videos/:id/comments – list comments for a video
 *
 *   POST   /api/v1/videos/:id/like     – like a video
 *   DELETE /api/v1/videos/:id/like     – unlike a video
 *   GET    /api/v1/videos/:id/likes    – get like count
 *
 *   POST   /api/v1/playlists           – create a playlist
 *   GET    /api/v1/playlists           – list playlists
 *   GET    /api/v1/playlists/:id       – get playlist
 *   POST   /api/v1/playlists/:id/items – add video to playlist
 *   DELETE /api/v1/playlists/:id/items/:videoId – remove from playlist
 *
 *   POST   /api/v1/videos/:id/transcode   – start transcoding
 *   GET    /api/v1/videos/:id/transcode   – get transcode job(s)
 *
 *   POST   /api/v1/videos/:id/dub         – start a dubbing pipeline
 *   GET    /api/v1/videos/:id/dub         – list dub jobs
 *
 *   GET    /api/v1/recommendations/:userId – get hybrid recommendations
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import logger from "../logger";
import { enqueueTranscode, listTranscodeJobs, getTranscodeJob } from "../services/TranscodeService";
import { transcribeAudio } from "../services/TranscriptionService";
import { translateSegments } from "../services/TranslationService";
import { synthesizeAudio } from "../services/VoiceSynthesisService";
import { getRecommendations, registerVideo } from "../services/HybridRecommender";
import { recordInteraction } from "../services/CollaborativeRecommender";

const router = Router();

// ---------------------------------------------------------------------------
// In-memory stores (Prisma stubs – replace with DB calls in production)
// ---------------------------------------------------------------------------

interface VideoRecord {
  id: string;
  creatorId: string | null;
  channelId: string | null;
  title: string;
  description: string | null;
  hlsUrl: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  durationSecs: number | null;
  viewCount: number;
  isPublished: boolean;
  tags: string[];
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface CommentRecord {
  id: string;
  videoId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface LikeRecord {
  userId: string;
  videoId: string;
  createdAt: string;
}

interface PlaylistRecord {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  items: Array<{ videoId: string; position: number; addedAt: string }>;
  createdAt: string;
  updatedAt: string;
}

interface DubJob {
  jobId: string;
  videoId: string;
  targetLanguage: string;
  status: string;
  transcriptionJobId: string | null;
  translationJobId: string | null;
  synthesisJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

const videosStore = new Map<string, VideoRecord>();
const commentsStore = new Map<string, CommentRecord>();
const likesStore = new Map<string, LikeRecord>(); // key: `${userId}:${videoId}`
const playlistsStore = new Map<string, PlaylistRecord>();
const dubJobsStore = new Map<string, DubJob>();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateVideoSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  creatorId: z.string().optional(),
  channelId: z.string().optional(),
  url: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  durationSecs: z.number().int().positive().optional(),
  tags: z.array(z.string()).max(30).default([]),
  category: z.string().default("entertainment"),
  isPublished: z.boolean().default(false),
});

const UpdateVideoSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  thumbnailUrl: z.string().url().optional(),
  tags: z.array(z.string()).max(30).optional(),
  category: z.string().optional(),
  isPublished: z.boolean().optional(),
});

const CreateCommentSchema = z.object({
  userId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

const LikeSchema = z.object({
  userId: z.string().min(1),
});

const CreatePlaylistSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  isPublic: z.boolean().default(false),
});

const AddPlaylistItemSchema = z.object({
  videoId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const TranscodeRequestSchema = z.object({
  inputPath: z.string().min(1, "inputPath is required"),
  variants: z.array(z.enum(["360p", "720p", "1080p", "2160p"])).optional(),
  durationSecs: z.number().positive().optional(),
});

const DubRequestSchema = z.object({
  targetLanguage: z.string().min(2).max(10),
  referenceAudioPath: z.string().min(1),
  backgroundAudioPath: z.string().optional(),
  sourceLanguage: z.string().min(2).max(10).default("auto"),
});

const RecommendationsQuerySchema = z.object({
  count: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .pipe(z.number().int().min(1).max(50)),
  excludeIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : [])),
  seedVideoId: z.string().optional(),
});

const WatchInteractionSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(["watch", "like", "share", "watchTime"]),
  value: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function videoToPublic(v: VideoRecord) {
  return { ...v };
}

// ---------------------------------------------------------------------------
// Video CRUD
// ---------------------------------------------------------------------------

router.post("/", (req: Request, res: Response) => {
  const parse = CreateVideoSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const data = parse.data;
  const id = uuidv4();
  const now = nowIso();

  const video: VideoRecord = {
    id,
    creatorId: data.creatorId ?? null,
    channelId: data.channelId ?? null,
    title: data.title,
    description: data.description ?? null,
    hlsUrl: null,
    url: data.url ?? null,
    thumbnailUrl: data.thumbnailUrl ?? null,
    durationSecs: data.durationSecs ?? null,
    viewCount: 0,
    isPublished: data.isPublished,
    tags: data.tags,
    category: data.category,
    createdAt: now,
    updatedAt: now,
  };

  videosStore.set(id, video);

  // Register in recommender
  registerVideo(
    {
      videoId: id,
      creatorId: data.creatorId,
      category: data.category,
      viewCount: 0,
      publishedAt: now,
    },
    {
      videoId: id,
      title: data.title,
      description: data.description ?? "",
      tags: data.tags,
      category: data.category,
      durationSecs: data.durationSecs ?? 0,
      viewCount: 0,
    }
  );

  logger.info({ videoId: id, title: data.title }, "Video created");

  res.status(201).json(videoToPublic(video));
});

router.get("/", (req: Request, res: Response) => {
  const { category, published, limit = "20", offset = "0" } = req.query as Record<string, string>;
  let list = Array.from(videosStore.values());

  if (category) list = list.filter((v) => v.category === category);
  if (published === "true") list = list.filter((v) => v.isPublished);

  const limitN = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offsetN = Math.max(0, parseInt(offset, 10) || 0);

  const page = list.slice(offsetN, offsetN + limitN);

  res.json({ total: list.length, offset: offsetN, limit: limitN, items: page.map(videoToPublic) });
});

router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const video = videosStore.get(id!);
  if (!video) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }
  // Increment view count
  video.viewCount += 1;
  video.updatedAt = nowIso();
  res.json(videoToPublic(video));
});

router.patch("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const video = videosStore.get(id!);
  if (!video) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = UpdateVideoSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const data = parse.data;
  if (data.title !== undefined) video.title = data.title;
  if (data.description !== undefined) video.description = data.description ?? null;
  if (data.thumbnailUrl !== undefined) video.thumbnailUrl = data.thumbnailUrl ?? null;
  if (data.tags !== undefined) video.tags = data.tags;
  if (data.category !== undefined) video.category = data.category;
  if (data.isPublished !== undefined) video.isPublished = data.isPublished;
  video.updatedAt = nowIso();

  logger.info({ videoId: id }, "Video updated");
  res.json(videoToPublic(video));
});

router.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }
  videosStore.delete(id!);
  logger.info({ videoId: id }, "Video deleted");
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

router.post("/:id/comments", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = CreateCommentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const commentId = uuidv4();
  const now = nowIso();
  const comment: CommentRecord = {
    id: commentId,
    videoId: id!,
    userId: parse.data.userId,
    content: parse.data.content,
    createdAt: now,
    updatedAt: now,
  };

  commentsStore.set(commentId, comment);
  logger.info({ commentId, videoId: id }, "Comment added");
  res.status(201).json(comment);
});

router.get("/:id/comments", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const comments = Array.from(commentsStore.values()).filter((c) => c.videoId === id);
  res.json({ total: comments.length, items: comments });
});

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

router.post("/:id/like", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = LikeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { userId } = parse.data;
  const likeKey = `${userId}:${id}`;

  if (likesStore.has(likeKey)) {
    res.status(409).json({ error: "Video already liked by this user" });
    return;
  }

  likesStore.set(likeKey, { userId, videoId: id!, createdAt: nowIso() });

  // Record interaction for collaborative filtering
  recordInteraction({ userId, videoId: id!, type: "like", occurredAt: nowIso() });

  logger.info({ userId, videoId: id }, "Like recorded");
  res.status(201).json({ liked: true });
});

router.delete("/:id/like", (req: Request, res: Response) => {
  const { id } = req.params;
  const parse = LikeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { userId } = parse.data;
  const likeKey = `${userId}:${id}`;

  if (!likesStore.has(likeKey)) {
    res.status(404).json({ error: "Like not found" });
    return;
  }

  likesStore.delete(likeKey);
  logger.info({ userId, videoId: id }, "Like removed");
  res.json({ liked: false });
});

router.get("/:id/likes", (req: Request, res: Response) => {
  const { id } = req.params;
  const count = Array.from(likesStore.keys()).filter((k) => k.endsWith(`:${id}`)).length;
  res.json({ videoId: id, count });
});

// ---------------------------------------------------------------------------
// Watch interactions (for recommendation engine)
// ---------------------------------------------------------------------------

router.post("/:id/interact", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = WatchInteractionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { userId, type, value } = parse.data;

  recordInteraction({
    userId,
    videoId: id!,
    type,
    value,
    occurredAt: nowIso(),
  });

  res.status(201).json({ recorded: true, type, videoId: id, userId });
});

// ---------------------------------------------------------------------------
// Transcoding
// ---------------------------------------------------------------------------

router.post("/:id/transcode", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!videosStore.has(id!)) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = TranscodeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { inputPath, variants, durationSecs } = parse.data;

  const result = enqueueTranscode({
    videoId: id!,
    inputPath,
    variants,
    durationSecs,
  });

  if ("error" in result) {
    res.status(400).json(result);
    return;
  }

  logger.info({ jobId: result.jobId, videoId: id }, "Transcode job queued");
  res.status(202).json(result);
});

router.get("/:id/transcode", (req: Request, res: Response) => {
  const { id } = req.params;
  const { jobId } = req.query as { jobId?: string };

  if (jobId) {
    const job = getTranscodeJob(jobId);
    if (!job || job.videoId !== id) {
      res.status(404).json({ error: `Transcode job '${jobId}' not found for video '${id}'` });
      return;
    }
    res.json(job);
    return;
  }

  const jobs = listTranscodeJobs(id!);
  res.json({ videoId: id, total: jobs.length, jobs });
});

// ---------------------------------------------------------------------------
// Dubbing pipeline
// ---------------------------------------------------------------------------

router.post("/:id/dub", (req: Request, res: Response) => {
  const { id } = req.params;
  const video = videosStore.get(id!);
  if (!video) {
    res.status(404).json({ error: `Video '${id}' not found` });
    return;
  }

  const parse = DubRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { targetLanguage, referenceAudioPath, backgroundAudioPath, sourceLanguage } = parse.data;

  // Step 1: Transcription
  const transcriptionJob = transcribeAudio({
    videoId: id!,
    audioPath: referenceAudioPath,
    language: sourceLanguage,
  });

  // Step 2: Translation (async after transcription)
  // In this stub, translation and synthesis are queued immediately
  const translationJob = translateSegments({
    videoId: id!,
    transcriptionJobId: transcriptionJob.jobId,
    segments: [],    // Will be populated by a webhook or polling in production
    sourceLanguage: sourceLanguage === "auto" ? "en" : sourceLanguage,
    targetLanguage,
  });

  // Step 3: Synthesis
  const synthesisJob = synthesizeAudio({
    videoId: id!,
    translationJobId: translationJob.jobId,
    translatedSegments: [],  // Will be populated from translation result in production
    targetLanguage,
    referenceAudioPath,
    backgroundAudioPath,
  });

  const dubJobId = uuidv4();
  const now = nowIso();
  const dubJob: DubJob = {
    jobId: dubJobId,
    videoId: id!,
    targetLanguage,
    status: "in_progress",
    transcriptionJobId: transcriptionJob.jobId,
    translationJobId: translationJob.jobId,
    synthesisJobId: synthesisJob.jobId,
    createdAt: now,
    updatedAt: now,
  };

  dubJobsStore.set(dubJobId, dubJob);

  logger.info({ dubJobId, videoId: id, targetLanguage }, "Dub pipeline started");

  res.status(202).json({
    dubJobId,
    videoId: id,
    targetLanguage,
    pipeline: {
      transcriptionJobId: transcriptionJob.jobId,
      translationJobId: translationJob.jobId,
      synthesisJobId: synthesisJob.jobId,
    },
  });
});

router.get("/:id/dub", (req: Request, res: Response) => {
  const { id } = req.params;
  const jobs = Array.from(dubJobsStore.values()).filter((j) => j.videoId === id);
  res.json({ videoId: id, total: jobs.length, jobs });
});

// ---------------------------------------------------------------------------
// Playlists (separate prefix /playlists is registered in app.ts)
// This section handles playlist operations mounted at the videos router
// ---------------------------------------------------------------------------

export default router;

// ---------------------------------------------------------------------------
// Playlists router (exported separately to mount at /api/v1/playlists)
// ---------------------------------------------------------------------------

export const playlistsRouter = Router();

playlistsRouter.post("/", (req: Request, res: Response) => {
  const parse = CreatePlaylistSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { userId, title, description, isPublic } = parse.data;
  const id = uuidv4();
  const now = nowIso();

  const playlist: PlaylistRecord = {
    id,
    userId,
    title,
    description: description ?? null,
    isPublic,
    items: [],
    createdAt: now,
    updatedAt: now,
  };

  playlistsStore.set(id, playlist);
  logger.info({ playlistId: id, userId }, "Playlist created");
  res.status(201).json(playlist);
});

playlistsRouter.get("/", (req: Request, res: Response) => {
  const { userId, public: isPublicFilter } = req.query as Record<string, string>;
  let list = Array.from(playlistsStore.values());
  if (userId) list = list.filter((p) => p.userId === userId);
  if (isPublicFilter === "true") list = list.filter((p) => p.isPublic);
  res.json({ total: list.length, items: list });
});

playlistsRouter.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const playlist = playlistsStore.get(id!);
  if (!playlist) {
    res.status(404).json({ error: `Playlist '${id}' not found` });
    return;
  }
  res.json(playlist);
});

playlistsRouter.post("/:id/items", (req: Request, res: Response) => {
  const { id } = req.params;
  const playlist = playlistsStore.get(id!);
  if (!playlist) {
    res.status(404).json({ error: `Playlist '${id}' not found` });
    return;
  }

  const parse = AddPlaylistItemSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { videoId, position } = parse.data;

  if (playlist.items.some((item) => item.videoId === videoId)) {
    res.status(409).json({ error: "Video already in playlist" });
    return;
  }

  const pos = position ?? playlist.items.length;
  playlist.items.push({ videoId, position: pos, addedAt: nowIso() });
  playlist.items.sort((a, b) => a.position - b.position);
  playlist.updatedAt = nowIso();

  res.status(201).json(playlist);
});

playlistsRouter.delete("/:id/items/:videoId", (req: Request, res: Response) => {
  const { id, videoId } = req.params;
  const playlist = playlistsStore.get(id!);
  if (!playlist) {
    res.status(404).json({ error: `Playlist '${id}' not found` });
    return;
  }

  const before = playlist.items.length;
  playlist.items = playlist.items.filter((item) => item.videoId !== videoId);

  if (playlist.items.length === before) {
    res.status(404).json({ error: `Video '${videoId}' not found in playlist` });
    return;
  }

  playlist.updatedAt = nowIso();
  res.json(playlist);
});

// ---------------------------------------------------------------------------
// Recommendations router (mounted at /api/v1/recommendations)
// ---------------------------------------------------------------------------

export const recommendationsRouter = Router();

recommendationsRouter.get("/:userId", (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const queryParse = RecommendationsQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: queryParse.error.issues[0]?.message });
    return;
  }

  const { count, excludeIds, seedVideoId } = queryParse.data;

  const recommendations = getRecommendations(userId, count, excludeIds, seedVideoId);

  logger.info({ userId, count: recommendations.length }, "Recommendations served");

  res.json({
    userId,
    count: recommendations.length,
    recommendations,
    generatedAt: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function _resetVideoStores(): void {
  videosStore.clear();
  commentsStore.clear();
  likesStore.clear();
  playlistsStore.clear();
  dubJobsStore.clear();
}
