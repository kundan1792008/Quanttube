/**
 * HybridRecommender – Blended recommendation combining three signals.
 *
 * Weighting:
 *   • Content-based (cosine similarity)  : 40 %
 *   • Collaborative filtering (ALS)      : 40 %
 *   • Trending (global recency × views)  : 20 %
 *
 * Post-processing:
 *   • Diversity penalty: reduces score of videos that share a category or
 *     creator with already-selected recommendations, to avoid filter bubbles.
 *   • Expose `getRecommendations(userId, count, excludeIds)`.
 */

import logger from "../logger";
import { getContentSimilar, VideoFeatures, indexVideo } from "./ContentRecommender";
import { getCollaborativeRecommendations, recordInteraction, UserInteraction } from "./CollaborativeRecommender";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_WEIGHT = 0.40;
const COLLABORATIVE_WEIGHT = 0.40;
const TRENDING_WEIGHT = 0.20;

/** Fraction by which score is penalised for each already-selected same-category video */
const DIVERSITY_PENALTY_PER_DUPLICATE_CATEGORY = 0.15;

/** Fraction by which score is penalised for each already-selected same-creator video */
const DIVERSITY_PENALTY_PER_DUPLICATE_CREATOR = 0.20;

/** How many top content and collaborative candidates to fetch before blending */
const CANDIDATE_POOL_MULTIPLIER = 5;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface VideoMetaForRecommender {
  videoId: string;
  creatorId?: string;
  category: string;
  viewCount: number;
  publishedAt: string;
  /** Whether the video is currently trending (updated by external signal) */
  isTrending?: boolean;
}

export interface HybridRecommendation {
  videoId: string;
  /** Final blended score [0, 1] */
  score: number;
  /** Content-based component score */
  contentScore: number;
  /** Collaborative component score */
  collaborativeScore: number;
  /** Trending component score */
  trendingScore: number;
  reason: string;
  /** Whether diversity penalty was applied */
  diversityPenaltyApplied: boolean;
}

// ---------------------------------------------------------------------------
// In-memory metadata store
// ---------------------------------------------------------------------------

const videoMeta = new Map<string, VideoMetaForRecommender>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Compute a trending score for a video based on its view count and recency.
 *
 * Score = log(1 + viewCount) / log(1 + maxViewCount) × recencyBoost
 *
 * recencyBoost decays exponentially with age (half-life = 7 days).
 */
export function computeTrendingScore(
  video: VideoMetaForRecommender,
  maxViewCount: number,
  nowMs: number = Date.now()
): number {
  const logViews = maxViewCount > 0
    ? Math.log1p(video.viewCount) / Math.log1p(maxViewCount)
    : 0;

  const publishedMs = Date.parse(video.publishedAt);
  const ageMs = nowMs - publishedMs;
  const halfLifeMs = 7 * 24 * 3600 * 1000; // 7 days
  const recencyBoost = Math.exp(-ageMs / halfLifeMs);

  return Math.min(1, logViews * 0.7 + recencyBoost * 0.3);
}

/**
 * Apply diversity penalty to a scored list.
 *
 * Iterates through the list in score order.  When a video is "selected",
 * subsequent videos sharing its category or creator have their scores
 * reduced.
 */
export function applyDiversityPenalty(
  recommendations: HybridRecommendation[],
  metaStore: Map<string, VideoMetaForRecommender>
): HybridRecommendation[] {
  const selectedCategories = new Map<string, number>(); // category → count
  const selectedCreators = new Map<string, number>();   // creatorId → count
  const result: HybridRecommendation[] = [];

  for (const rec of recommendations) {
    const meta = metaStore.get(rec.videoId);
    const category = meta?.category ?? "unknown";
    const creatorId = meta?.creatorId ?? null;

    const catCount = selectedCategories.get(category) ?? 0;
    const creCount = creatorId ? (selectedCreators.get(creatorId) ?? 0) : 0;

    const penalty =
      catCount * DIVERSITY_PENALTY_PER_DUPLICATE_CATEGORY +
      creCount * DIVERSITY_PENALTY_PER_DUPLICATE_CREATOR;

    const adjustedScore = Math.max(0, rec.score - penalty);

    result.push({
      ...rec,
      score: Math.round(adjustedScore * 1000) / 1000,
      diversityPenaltyApplied: penalty > 0,
    });

    // Mark as selected
    selectedCategories.set(category, catCount + 1);
    if (creatorId) selectedCreators.set(creatorId, creCount + 1);
  }

  // Re-sort after penalty application
  result.sort((a, b) => b.score - a.score);
  return result;
}

// ---------------------------------------------------------------------------
// Metadata management
// ---------------------------------------------------------------------------

/**
 * Register or update video metadata in the recommender.
 *
 * Also indexes the video in the ContentRecommender if features are provided.
 */
export function registerVideo(
  meta: VideoMetaForRecommender,
  features?: VideoFeatures
): void {
  videoMeta.set(meta.videoId, meta);
  if (features) indexVideo(features);
  logger.info({ videoId: meta.videoId }, "Video registered in HybridRecommender");
}

/**
 * Remove a video from the recommender.
 */
export function unregisterVideo(videoId: string): void {
  videoMeta.delete(videoId);
}

// ---------------------------------------------------------------------------
// Trending feed
// ---------------------------------------------------------------------------

/**
 * Compute the trending feed: top videos by trending score.
 */
export function getTrendingFeed(
  topK: number,
  excludeIds: string[] = []
): Array<{ videoId: string; score: number }> {
  const excludeSet = new Set(excludeIds);
  const nowMs = Date.now();

  const maxViewCount = Math.max(
    1,
    ...Array.from(videoMeta.values()).map((v) => v.viewCount)
  );

  const scored = Array.from(videoMeta.entries())
    .filter(([id]) => !excludeSet.has(id))
    .map(([videoId, meta]) => ({
      videoId,
      score: computeTrendingScore(meta, maxViewCount, nowMs),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Get hybrid recommendations for a user.
 *
 * @param userId    Target user ID.  If new, falls back to content + trending.
 * @param count     Number of recommendations to return.
 * @param excludeIds Video IDs to exclude (e.g. already watched, in current playlist).
 * @param seedVideoId Optional: video currently being watched (for content-similar seed).
 */
export async function getRecommendations(
  userId: string,
  count = 10,
  excludeIds: string[] = [],
  seedVideoId?: string
): Promise<HybridRecommendation[]> {
  const pool = count * CANDIDATE_POOL_MULTIPLIER;

  // --- Content-based candidates ---
  const seedId = seedVideoId ?? await findLastWatchedVideo(userId);
  const contentCandidates = seedId
    ? getContentSimilar(seedId, pool, excludeIds)
    : [];

  // --- Collaborative candidates ---
  const collaborativeCandidates = getCollaborativeRecommendations(userId, pool, excludeIds);

  // --- Trending candidates ---
  const trendingCandidates = getTrendingFeed(pool, excludeIds);

  // --- Merge into score map ---
  const scoreMap = new Map<string, {
    contentScore: number;
    collaborativeScore: number;
    trendingScore: number;
  }>();

  function ensureEntry(videoId: string) {
    if (!scoreMap.has(videoId)) {
      scoreMap.set(videoId, { contentScore: 0, collaborativeScore: 0, trendingScore: 0 });
    }
    return scoreMap.get(videoId)!;
  }

  for (const c of contentCandidates) {
    ensureEntry(c.videoId).contentScore = c.score;
  }
  for (const c of collaborativeCandidates) {
    ensureEntry(c.videoId).collaborativeScore = c.score;
  }
  for (const t of trendingCandidates) {
    ensureEntry(t.videoId).trendingScore = t.score;
  }

  // --- Blend scores ---
  const blended: HybridRecommendation[] = [];

  for (const [videoId, scores] of scoreMap.entries()) {
    const { contentScore, collaborativeScore, trendingScore } = scores;

    const blendedScore =
      CONTENT_WEIGHT * contentScore +
      COLLABORATIVE_WEIGHT * collaborativeScore +
      TRENDING_WEIGHT * trendingScore;

    const parts: string[] = [];
    if (contentScore > 0) parts.push(`content:${Math.round(contentScore * 100)}%`);
    if (collaborativeScore > 0) parts.push(`collaborative:${Math.round(collaborativeScore * 100)}%`);
    if (trendingScore > 0) parts.push(`trending:${Math.round(trendingScore * 100)}%`);

    blended.push({
      videoId,
      score: Math.round(blendedScore * 1000) / 1000,
      contentScore: Math.round(contentScore * 1000) / 1000,
      collaborativeScore: Math.round(collaborativeScore * 1000) / 1000,
      trendingScore: Math.round(trendingScore * 1000) / 1000,
      reason: `Hybrid (${parts.join(", ")})`,
      diversityPenaltyApplied: false,
    });
  }

  blended.sort((a, b) => b.score - a.score);

  // --- Apply diversity penalty ---
  const withDiversity = applyDiversityPenalty(blended, videoMeta);

  const finalResults = withDiversity.slice(0, count);

  logger.info(
    {
      userId,
      count: finalResults.length,
      candidatePool: scoreMap.size,
      seedVideoId: seedId,
    },
    "Hybrid recommendations generated"
  );

  return finalResults;
}

// ---------------------------------------------------------------------------
// Helper: find seed video
// ---------------------------------------------------------------------------

/** Find the most recently recorded video interaction for a user (as seed for content-based). */
async function findLastWatchedVideo(userId: string): Promise<string | undefined> {
  // We re-use CollaborativeRecommender's interaction store
  // Import lazily to avoid circular deps
  const CollaborativeRecommenderModule = await import("./CollaborativeRecommender");
  const { getUserInteractions } = CollaborativeRecommenderModule;

  const userInteractions = getUserInteractions(userId);
  if (userInteractions.length === 0) return undefined;

  const sorted = [...userInteractions].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt)
  );

  return sorted[0]?.videoId;
}

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export { recordInteraction };
export type { UserInteraction };

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export async function _resetHybridRecommender(): Promise<void> {
  videoMeta.clear();

  const ContentRecommenderModule = await import("./ContentRecommender");
  const CollaborativeRecommenderModule = await import("./CollaborativeRecommender");
  const { _resetContentIndex } = ContentRecommenderModule;
  const { _resetCollaborativeModel } = CollaborativeRecommenderModule;

  _resetContentIndex();
  _resetCollaborativeModel();
}

export { nowIso as _nowIso };
