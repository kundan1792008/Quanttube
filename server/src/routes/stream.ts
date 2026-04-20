import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import logger from "../logger";
import { cache } from "../services/cache";
import { buildQuantumInterpolationPlan } from "../services/QuantumInterpolationService";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const MediaIdParamSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
});

const StreamQuerySchema = z.object({
  userId: z.string().optional(),
  engagementScore: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseFloat(v) : undefined))
    .pipe(z.number().min(0).max(1).optional()),
  mode: z.enum(["cinema", "short-reel", "audio-only"]).optional(),
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface StreamSyncMetadata {
  /** Target lip-sync accuracy in milliseconds. Sub-100ms is production quality. */
  targetSyncOffsetMs: number;
  /** Streaming protocol combination active for this tier. */
  protocol: "hls+dash" | "hls-audio-only";
}

// ---------------------------------------------------------------------------
// Bitrate ladder (HLS) – stub values
// ---------------------------------------------------------------------------

const BITRATE_LADDER = [
  { resolution: "2160p", bitrate: 15000, codec: "h265" },
  { resolution: "1080p", bitrate: 5000,  codec: "h264" },
  { resolution: "720p",  bitrate: 2500,  codec: "h264" },
  { resolution: "480p",  bitrate: 1000,  codec: "h264" },
  { resolution: "360p",  bitrate: 500,   codec: "h264" },
  { resolution: "240p",  bitrate: 250,   codec: "h264" },
  { resolution: "audio", bitrate: 128,   codec: "aac"  },
] as const;
const AUDIO_ONLY_TIER = BITRATE_LADDER[BITRATE_LADDER.length - 1];
const CDN_BASE_URL = process.env.CDN_BASE_URL ?? "https://cdn.quanttube.app";

/**
 * Select a bitrate tier based on engagement score.
 * High engagement → serve higher quality to maximise retention.
 * Audio-only mode → serve audio-only tier regardless of score.
 */
function selectBitrateTier(
  engagementScore: number,
  mode?: string
): (typeof BITRATE_LADDER)[number] {
  if (mode === "audio-only") {
    return BITRATE_LADDER.find((t) => t.resolution === "audio") ?? AUDIO_ONLY_TIER;
  }
  if (engagementScore >= 0.8) return BITRATE_LADDER[0]; // 4K
  if (engagementScore >= 0.6) return BITRATE_LADDER[1]; // 1080p
  if (engagementScore >= 0.4) return BITRATE_LADDER[2]; // 720p
  if (engagementScore >= 0.2) return BITRATE_LADDER[3]; // 480p
  return BITRATE_LADDER[4]; // 360p fallback
}

// ---------------------------------------------------------------------------
// GET /api/v1/stream/:mediaId
// ---------------------------------------------------------------------------

/** Cache TTL for stream metadata (seconds). */
const STREAM_CACHE_TTL_SECONDS = 60;

interface StreamMeta {
  allTiers: typeof BITRATE_LADDER;
  hlsManifestBaseUrl: string;
  dashManifestBaseUrl: string;
}

/**
 * Build a deterministic cache key for stream metadata.
 * The user-specific `userId` is intentionally excluded so that metadata
 * for the same media item is shared across users; per-user engagement
 * adjustments are applied at response time.
 * Both parameters are URI-encoded to prevent key collisions from
 * values that contain the `:` separator.
 */
function streamCacheKey(mediaId: string, mode: string): string {
  return `stream:${encodeURIComponent(mediaId)}:${encodeURIComponent(mode)}`;
}

function buildQuantumInterpolationResponse(mode: string, engagementScore: number, selectedResolution: string) {
  return buildQuantumInterpolationPlan({
    mode: mode as "cinema" | "short-reel" | "audio-only",
    engagementScore,
    selectedResolution,
  });
}

/**
 * Try to retrieve and parse stream metadata from the cache.
 * Returns `null` on cache miss or if the cached payload is malformed.
 */
async function getCachedStreamMeta(key: string): Promise<StreamMeta | null> {
  const raw = await cache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StreamMeta;
  } catch {
    // Discard corrupted cache entries and fall through to a fresh computation.
    logger.warn({ key }, "Discarding malformed stream cache entry");
    return null;
  }
}

/**
 * Adaptive HLS/DASH streaming stub.
 *
 * Returns stub HLS and DASH manifest URLs and the selected bitrate tier for
 * the given mediaId, dynamically adjusted based on the user's current
 * engagement state (`engagementScore` query param, 0-1).
 *
 * Video metadata (bitrate ladder, CDN manifest URL) is cached in Redis
 * (or the in-memory fallback) for `STREAM_CACHE_TTL_SECONDS` seconds to
 * avoid redundant lookups on frequently-accessed media items.
 *
 * In production this endpoint would:
 *  1. Authenticate the user via Quantmail JWT.
 *  2. Look up the CDN-hosted HLS manifest for `mediaId`.
 *  3. Proxy or redirect to the appropriate bitrate playlist.
 */
async function streamHandler(req: Request, res: Response): Promise<void> {
  const paramParse = MediaIdParamSchema.safeParse(req.params);
  if (!paramParse.success) {
    res.status(400).json({ error: paramParse.error.issues[0]?.message });
    return;
  }

  const queryParse = StreamQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: queryParse.error.issues[0]?.message });
    return;
  }

  const { mediaId } = paramParse.data;
  const { userId, engagementScore = 0.5, mode } = queryParse.data;
  const resolvedMode = mode ?? "cinema";

  // Check cache for video metadata (bitrate ladder + CDN manifest URLs)
  const cacheKey = streamCacheKey(mediaId, resolvedMode);
  const cachedMeta = await getCachedStreamMeta(cacheKey);
  if (cachedMeta) {
    const tier = selectBitrateTier(engagementScore, resolvedMode);
    const syncMetadata: StreamSyncMetadata = {
      targetSyncOffsetMs: 100,
      protocol: tier.resolution === "audio" ? "hls-audio-only" : "hls+dash",
    };
    const quantumInterpolation = buildQuantumInterpolationResponse(
      resolvedMode,
      engagementScore,
      tier.resolution
    );
    logger.info(
      { mediaId, userId, engagementScore, mode: resolvedMode, resolution: tier.resolution, cacheHit: true },
      "Stream tier selected (cache hit)"
    );
    res.json({
      mediaId,
      userId: userId ?? null,
      selectedTier: tier,
      hlsManifestUrl: `${cachedMeta.hlsManifestBaseUrl}/${tier.resolution}/master.m3u8`,
      dashManifestUrl: `${cachedMeta.dashManifestBaseUrl}/${tier.resolution}/manifest.mpd`,
      allTiers: cachedMeta.allTiers,
      engagementScore,
      mode: resolvedMode,
      syncMetadata,
      quantumInterpolation,
      note: "HLS/DASH adaptive streaming stub – real CDN URL would be served here",
    });
    return;
  }

  // Cache miss – compute and store metadata
  const tier = selectBitrateTier(engagementScore, resolvedMode);
  const hlsManifestBaseUrl = `${CDN_BASE_URL}/hls/${encodeURIComponent(mediaId)}`;
  const dashManifestBaseUrl = `${CDN_BASE_URL}/dash/${encodeURIComponent(mediaId)}`;
  const meta: StreamMeta = { allTiers: BITRATE_LADDER, hlsManifestBaseUrl, dashManifestBaseUrl };

  await cache.set(cacheKey, JSON.stringify(meta), STREAM_CACHE_TTL_SECONDS);

  logger.info(
    { mediaId, userId, engagementScore, mode: resolvedMode, resolution: tier.resolution, cacheHit: false },
    "Stream tier selected"
  );

  const syncMetadata: StreamSyncMetadata = {
    targetSyncOffsetMs: 100,
    protocol: tier.resolution === "audio" ? "hls-audio-only" : "hls+dash",
  };
  const quantumInterpolation = buildQuantumInterpolationResponse(
    resolvedMode,
    engagementScore,
    tier.resolution
  );

  res.json({
    mediaId,
    userId: userId ?? null,
    selectedTier: tier,
    hlsManifestUrl: `${hlsManifestBaseUrl}/${tier.resolution}/master.m3u8`,
    dashManifestUrl: `${dashManifestBaseUrl}/${tier.resolution}/manifest.mpd`,
    allTiers: BITRATE_LADDER,
    engagementScore,
    mode: resolvedMode,
    syncMetadata,
    quantumInterpolation,
    note: "HLS/DASH adaptive streaming stub – real CDN URL would be served here",
  });
}

router.get("/:mediaId", (req: Request, res: Response, next: NextFunction) => {
  streamHandler(req, res).catch(next);
});

export default router;
