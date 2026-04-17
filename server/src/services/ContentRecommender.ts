/**
 * ContentRecommender – Content-based filtering recommendation engine.
 *
 * Workflow:
 *  1. For each video, extract a feature vector from:
 *     • TF-IDF embeddings of title + description tokens.
 *     • Tag one-hot encoding.
 *     • Category one-hot encoding.
 *     • Duration bucket (bucketed into 5 ranges).
 *     • View-count normalised to [0,1].
 *  2. Compute pairwise cosine similarity between all videos.
 *  3. Cache the similarity matrix in memory (Redis in production).
 *  4. Expose `getContentSimilar(videoId, topK)` to retrieve the most similar videos.
 */

import logger from "../logger";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface VideoFeatures {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  durationSecs: number;
  viewCount: number;
}

export interface ContentSimilarityEntry {
  videoId: string;
  similarVideoId: string;
  score: number;
}

export interface ContentRecommendation {
  videoId: string;
  score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// In-memory vector + similarity store
// ---------------------------------------------------------------------------

/** Map<videoId, feature vector> */
const featureVectors = new Map<string, number[]>();

/** Map<videoId, VideoFeatures> */
const videoFeaturesStore = new Map<string, VideoFeatures>();

/**
 * Similarity cache: Map<videoId, sorted array of {videoId, score}>
 * In production this would be stored in Redis with TTL.
 */
const similarityCache = new Map<string, ContentSimilarityEntry[]>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration buckets in seconds */
const DURATION_BUCKETS = [
  { max: 60, label: "short" },       // < 1 min
  { max: 300, label: "medium-short" }, // 1-5 min
  { max: 1200, label: "medium" },    // 5-20 min
  { max: 3600, label: "long" },      // 20-60 min
  { max: Infinity, label: "very-long" }, // > 60 min
];

const KNOWN_CATEGORIES = [
  "entertainment", "education", "music", "gaming", "sports",
  "news", "technology", "travel", "food", "lifestyle",
  "science", "comedy", "documentary", "animation", "finance",
];

// ---------------------------------------------------------------------------
// Text processing utilities
// ---------------------------------------------------------------------------

/** Very lightweight tokenizer: lowercase, strip punctuation, remove stopwords */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "it", "its", "i", "you", "he", "she", "we", "they",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Compute TF-IDF weights for tokens within the corpus of stored videos.
 *
 * Returns a sparse weight map: token → weight
 */
export function computeTfIdf(
  tokens: string[],
  allDocTokens: string[][]
): Map<string, number> {
  const tf = new Map<string, number>();
  const totalTokens = tokens.length || 1;

  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1 / totalTokens);
  }

  const docCount = allDocTokens.length || 1;
  const result = new Map<string, number>();

  for (const [token, tfVal] of tf.entries()) {
    const docsWithToken = allDocTokens.filter((doc) => doc.includes(token)).length;
    const idf = Math.log((docCount + 1) / (docsWithToken + 1)) + 1;
    result.set(token, tfVal * idf);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Feature vector construction
// ---------------------------------------------------------------------------

/**
 * Get the duration bucket index (0-4) for a given duration.
 */
export function getDurationBucket(durationSecs: number): number {
  for (let i = 0; i < DURATION_BUCKETS.length; i++) {
    if (durationSecs < (DURATION_BUCKETS[i]?.max ?? Infinity)) return i;
  }
  return DURATION_BUCKETS.length - 1;
}

/**
 * Build a fixed-dimension feature vector for a video.
 *
 * Vector layout:
 *   [0..N-1]   : TF-IDF text embedding (top N tokens from corpus vocabulary)
 *   [N..N+T-1] : tag one-hot (T = number of unique tags in corpus)
 *   [N+T..N+T+C-1]: category one-hot (C = KNOWN_CATEGORIES.length)
 *   [N+T+C]    : duration bucket normalised to [0,1]
 *   [N+T+C+1]  : view-count normalised to [0,1]
 */
export function buildFeatureVector(
  video: VideoFeatures,
  vocabulary: string[],
  allTags: string[],
  maxViewCount: number
): number[] {
  // --- TF-IDF text component ---
  const allDocTokens = Array.from(videoFeaturesStore.values()).map((v) =>
    tokenize(`${v.title} ${v.description}`)
  );
  const tokens = tokenize(`${video.title} ${video.description}`);
  const tfidf = computeTfIdf(tokens, allDocTokens);

  const textVec = vocabulary.map((word) => tfidf.get(word) ?? 0);

  // --- Tag one-hot ---
  const tagSet = new Set(video.tags.map((t) => t.toLowerCase()));
  const tagVec = allTags.map((t) => (tagSet.has(t) ? 1 : 0));

  // --- Category one-hot ---
  const catVec = KNOWN_CATEGORIES.map((c) =>
    video.category.toLowerCase() === c ? 1 : 0
  );

  // --- Duration bucket ---
  const durBucket = getDurationBucket(video.durationSecs) / (DURATION_BUCKETS.length - 1);

  // --- View count ---
  const normViewCount = maxViewCount > 0 ? Math.log1p(video.viewCount) / Math.log1p(maxViewCount) : 0;

  return [...textVec, ...tagVec, ...catVec, durBucket, normViewCount];
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Derive corpus-level vocabulary and tag list from stored videos.
 */
function deriveCorpus(): { vocabulary: string[]; allTags: string[]; maxViewCount: number } {
  const tokenFreq = new Map<string, number>();
  const tagSet = new Set<string>();
  let maxViewCount = 0;

  for (const v of videoFeaturesStore.values()) {
    const tokens = tokenize(`${v.title} ${v.description}`);
    for (const t of tokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    for (const tag of v.tags) tagSet.add(tag.toLowerCase());
    if (v.viewCount > maxViewCount) maxViewCount = v.viewCount;
  }

  // Keep top-500 most frequent tokens as vocabulary
  const vocabulary = [...tokenFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 500)
    .map(([w]) => w);

  return { vocabulary, allTags: [...tagSet], maxViewCount };
}

/**
 * Re-index a single video's feature vector.  Call after adding/updating a video.
 */
export function indexVideo(video: VideoFeatures): void {
  videoFeaturesStore.set(video.videoId, video);

  const { vocabulary, allTags, maxViewCount } = deriveCorpus();
  const vec = buildFeatureVector(video, vocabulary, allTags, maxViewCount);
  featureVectors.set(video.videoId, vec);

  // Invalidate similarity cache for this video and recompute
  similarityCache.delete(video.videoId);

  logger.info({ videoId: video.videoId, vecDim: vec.length }, "Video indexed for content recommendations");
}

/**
 * Remove a video from the index.
 */
export function removeVideoFromIndex(videoId: string): void {
  videoFeaturesStore.delete(videoId);
  featureVectors.delete(videoId);
  similarityCache.delete(videoId);
}

/**
 * Rebuild the full similarity matrix for all indexed videos.
 * O(n²) – called lazily on first recommendation query if cache is cold.
 */
function rebuildSimilarityMatrix(): void {
  const ids = Array.from(featureVectors.keys());
  logger.info({ count: ids.length }, "Rebuilding content similarity matrix");

  for (const id of ids) {
    const vecA = featureVectors.get(id);
    if (!vecA) continue;

    const entries: ContentSimilarityEntry[] = [];
    for (const otherId of ids) {
      if (otherId === id) continue;
      const vecB = featureVectors.get(otherId);
      if (!vecB) continue;
      const score = cosineSimilarity(vecA, vecB);
      entries.push({ videoId: id, similarVideoId: otherId, score });
    }

    entries.sort((a, b) => b.score - a.score);
    similarityCache.set(id, entries);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get content-based recommendations for a specific video.
 *
 * Returns the `topK` most similar videos, excluding those in `excludeIds`.
 */
export function getContentSimilar(
  videoId: string,
  topK = 10,
  excludeIds: string[] = []
): ContentRecommendation[] {
  // Ensure cache is populated
  if (!similarityCache.has(videoId) && featureVectors.size > 1) {
    rebuildSimilarityMatrix();
  }

  const entries = similarityCache.get(videoId) ?? [];
  const excludeSet = new Set(excludeIds);

  return entries
    .filter((e) => !excludeSet.has(e.similarVideoId))
    .slice(0, topK)
    .map((e) => ({
      videoId: e.similarVideoId,
      score: Math.round(e.score * 1000) / 1000,
      reason: `Content similarity: ${Math.round(e.score * 100)}% match`,
    }));
}

/**
 * Get the number of indexed videos.
 */
export function getIndexSize(): number {
  return featureVectors.size;
}

/**
 * Retrieve the feature vector for a video (for debugging/testing).
 */
export function getFeatureVector(videoId: string): number[] | undefined {
  return featureVectors.get(videoId);
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetContentIndex(): void {
  featureVectors.clear();
  videoFeaturesStore.clear();
  similarityCache.clear();
}
