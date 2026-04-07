import { Router, Request, Response } from "express";
import { z } from "zod";
import logger from "../logger";

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

/**
 * Adaptive HLS streaming stub.
 *
 * Returns a stub HLS manifest URL and the selected bitrate tier for the
 * given mediaId, dynamically adjusted based on the user's current
 * engagement state (`engagementScore` query param, 0-1).
 *
 * In production this endpoint would:
 *  1. Authenticate the user via Quantmail JWT.
 *  2. Look up the CDN-hosted HLS manifest for `mediaId`.
 *  3. Proxy or redirect to the appropriate bitrate playlist.
 */
router.get("/:mediaId", (req: Request, res: Response) => {
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

  const tier = selectBitrateTier(engagementScore, mode);

  logger.info(
    { mediaId, userId, engagementScore, mode, resolution: tier.resolution },
    "Stream tier selected"
  );

  res.json({
    mediaId,
    userId: userId ?? null,
    selectedTier: tier,
    hlsManifestUrl: `${CDN_BASE_URL}/hls/${encodeURIComponent(mediaId)}/${tier.resolution}/master.m3u8`,
    allTiers: BITRATE_LADDER,
    engagementScore,
    mode: mode ?? "cinema",
    note: "HLS streaming stub – real CDN URL would be served here",
  });
});

export default router;
