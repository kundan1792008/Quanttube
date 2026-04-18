/**
 * CollaborativeRecommender – Collaborative filtering via ALS matrix factorization.
 *
 * Workflow:
 *  1. Track user–item interactions: watch, like, share, watchTime.
 *  2. Build a sparse user–item interaction matrix.
 *  3. Factorize via Alternating Least Squares (ALS) to learn latent factors.
 *  4. Score unseen items for a user using dot-product of their latent factors.
 *  5. Expose `getCollaborativeRecommendations(userId, topK, excludeIds)`.
 *
 * ALS convergence:
 *   • Iteratively solve for user factors U given item factors V, then V given U.
 *   • Uses L2 regularisation (λ) to prevent overfitting.
 *   • Default: 50 latent factors, 15 iterations, λ = 0.01.
 */

import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LATENT_FACTORS = 50;
const ALS_ITERATIONS = 15;
const ALS_LAMBDA = 0.01;    // L2 regularisation factor

// ---------------------------------------------------------------------------
// Interaction weights
// ---------------------------------------------------------------------------

/** Weights for each interaction type when building the implicit feedback matrix */
const INTERACTION_WEIGHTS: Record<InteractionType, number> = {
  watch: 1.0,
  like: 3.0,
  share: 5.0,
  watchTime: 0.5, // per-second, accumulated separately
};

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type InteractionType = "watch" | "like" | "share" | "watchTime";

export interface UserInteraction {
  userId: string;
  videoId: string;
  type: InteractionType;
  /** For `watchTime` interactions: seconds watched */
  value?: number;
  occurredAt: string;
}

export interface CollaborativeRecommendation {
  videoId: string;
  score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/** All raw interactions */
const interactions: UserInteraction[] = [];

/**
 * Aggregated confidence matrix: Map<userId, Map<videoId, confidence>>
 *
 * confidence = weight × (1 + log(1 + raw_value))
 */
const confidenceMatrix = new Map<string, Map<string, number>>();

/** Ordered list of unique user IDs (row index lookup) */
let userIndex: string[] = [];

/** Ordered list of unique video IDs (column index lookup) */
let videoIndex: string[] = [];

/** ALS user factor matrix: rows=users, cols=latent factors */
let userFactors: number[][] = [];

/** ALS item factor matrix: rows=items, cols=latent factors */
let itemFactors: number[][] = [];

/** Whether the model needs to be retrained */
let modelDirty = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/** Initialize a random matrix of shape [rows × cols] with small values */
function randomMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.01)
  );
}

/** Matrix multiplication: (m×k) × (k×n) → (m×n) */
function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const C = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let l = 0; l < k; l++) {
        sum += (A[i]![l] ?? 0) * (B[l]![j] ?? 0);
      }
      C[i]![j] = sum;
    }
  }
  return C;
}

/** Dot product of two vectors */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/**
 * Solve the ALS sub-problem for one row:
 *   x = (YᵀCᵤY + λI)⁻¹ YᵀCᵤpᵤ
 *
 * Where:
 *   Y     = item (or user) factor matrix  [n × f]
 *   Cu    = diagonal confidence matrix for this user [n × n]
 *   pu    = preference vector (1 where interaction > 0)
 *   λ     = regularisation term
 *   f     = number of latent factors
 *
 * We use the closed-form ALS update with small Cholesky-style solver.
 */
function alsRowUpdate(
  Y: number[][],         // [n × f]  item factors
  confidences: number[], // [n]       per-item confidence for this user
  lambda: number,
  f: number
): number[] {
  const n = Y.length;

  // Accumulate A = YᵀCᵤY + λI   and   b = YᵀCᵤpᵤ
  const A: number[][] = Array.from({ length: f }, (_, i) =>
    Array.from({ length: f }, (__, j) => (i === j ? lambda : 0))
  );
  const b: number[] = new Array<number>(f).fill(0);

  for (let i = 0; i < n; i++) {
    const c = confidences[i] ?? 0;
    if (c === 0) continue; // sparse: skip zero-confidence items

    const yi = Y[i]!;
    const preference = c > 0 ? 1 : 0;

    for (let row = 0; row < f; row++) {
      for (let col = 0; col < f; col++) {
        A[row]![col]! += c * (yi[row] ?? 0) * (yi[col] ?? 0);
      }
      b[row]! += c * preference * (yi[row] ?? 0);
    }
  }

  // Solve Ax = b via Gaussian elimination
  return gaussianElimination(A, b);
}

/**
 * Simple Gaussian elimination to solve Ax = b.
 * A is f×f (small, ≤ 50×50) so naive O(f³) is fine.
 */
export function gaussianElimination(A: number[][], b: number[]): number[] {
  const f = A.length;
  // Augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i] ?? 0]);

  for (let col = 0; col < f; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < f; row++) {
      if (Math.abs(M[row]![col] ?? 0) > Math.abs(M[maxRow]![col] ?? 0)) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow]!, M[col]!];

    const pivot = M[col]![col] ?? 0;
    if (Math.abs(pivot) < 1e-12) continue; // singular row

    for (let row = 0; row < f; row++) {
      if (row === col) continue;
      const factor = (M[row]![col] ?? 0) / pivot;
      for (let k = col; k <= f; k++) {
        M[row]![k]! -= factor * (M[col]![k] ?? 0);
      }
    }
  }

  return Array.from({ length: f }, (_, i) => (M[i]![f] ?? 0) / (M[i]![i] ?? 1));
}

// ---------------------------------------------------------------------------
// ALS training
// ---------------------------------------------------------------------------

/**
 * Train the ALS model on the current interaction matrix.
 *
 * This is a full batch retrain.  In production: incremental updates.
 */
export function trainAls(): void {
  if (confidenceMatrix.size === 0) {
    logger.info("ALS: no interactions to train on");
    return;
  }

  userIndex = Array.from(confidenceMatrix.keys());
  const videoSet = new Set<string>();
  for (const userConf of confidenceMatrix.values()) {
    for (const videoId of userConf.keys()) videoSet.add(videoId);
  }
  videoIndex = Array.from(videoSet);

  const U = userIndex.length;
  const V = videoIndex.length;
  const f = Math.min(LATENT_FACTORS, U, V);

  if (U === 0 || V === 0) return;

  logger.info({ users: U, videos: V, factors: f }, "ALS: starting training");

  // Initialize factor matrices
  userFactors = randomMatrix(U, f);
  itemFactors = randomMatrix(V, f);

  // Video ID → column index lookup
  const vidToIdx = new Map(videoIndex.map((id, i) => [id, i]));
  const userToIdx = new Map(userIndex.map((id, i) => [id, i]));

  for (let iter = 0; iter < ALS_ITERATIONS; iter++) {
    // Update user factors given fixed item factors
    for (let ui = 0; ui < U; ui++) {
      const userId = userIndex[ui]!;
      const userConf = confidenceMatrix.get(userId) ?? new Map<string, number>();
      const confidences = videoIndex.map((vid) => userConf.get(vid) ?? 0);
      userFactors[ui] = alsRowUpdate(itemFactors, confidences, ALS_LAMBDA, f);
    }

    // Update item factors given fixed user factors
    for (let vi = 0; vi < V; vi++) {
      const videoId = videoIndex[vi]!;
      const confidences = userIndex.map((uid) => {
        const c = confidenceMatrix.get(uid);
        return c?.get(videoId) ?? 0;
      });
      itemFactors[vi] = alsRowUpdate(userFactors, confidences, ALS_LAMBDA, f);
    }
  }

  void matMul; // exported utility
  void userToIdx;
  void vidToIdx;

  modelDirty = false;
  logger.info({ users: U, videos: V, factors: f, iterations: ALS_ITERATIONS }, "ALS training complete");
}

// ---------------------------------------------------------------------------
// Interaction tracking
// ---------------------------------------------------------------------------

/**
 * Record a user–item interaction and update the confidence matrix.
 *
 * The ALS model is marked dirty and will be retrained lazily on the
 * next recommendation request.
 */
export function recordInteraction(interaction: UserInteraction): void {
  const { userId, videoId, type, value = 1 } = interaction;

  interactions.push({ ...interaction, occurredAt: interaction.occurredAt ?? nowIso() });

  // Update confidence matrix
  if (!confidenceMatrix.has(userId)) {
    confidenceMatrix.set(userId, new Map<string, number>());
  }
  const userConf = confidenceMatrix.get(userId)!;

  const weight = INTERACTION_WEIGHTS[type];
  const increment = type === "watchTime"
    ? weight * Math.log1p(value) // logarithmic scaling for watch-time
    : weight;

  userConf.set(videoId, (userConf.get(videoId) ?? 0) + increment);
  modelDirty = true;

  logger.info({ userId, videoId, type, value }, "Interaction recorded");
}

/**
 * Batch-record interactions (e.g. from import).
 */
export function recordInteractions(batch: UserInteraction[]): void {
  for (const interaction of batch) recordInteraction(interaction);
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

/**
 * Get collaborative filtering recommendations for a user.
 *
 * Returns `topK` unseen videos ranked by predicted preference score.
 */
export function getCollaborativeRecommendations(
  userId: string,
  topK = 10,
  excludeIds: string[] = []
): CollaborativeRecommendation[] {
  if (modelDirty) trainAls();

  const ui = userIndex.indexOf(userId);
  if (ui === -1) {
    // New user – return empty (cold-start handled by HybridRecommender)
    return [];
  }

  const uFactor = userFactors[ui];
  if (!uFactor) return [];

  const seenVideos = new Set(confidenceMatrix.get(userId)?.keys() ?? []);
  const excludeSet = new Set(excludeIds);

  const scored: CollaborativeRecommendation[] = [];

  for (let vi = 0; vi < videoIndex.length; vi++) {
    const videoId = videoIndex[vi]!;
    if (seenVideos.has(videoId) || excludeSet.has(videoId)) continue;

    const vFactor = itemFactors[vi];
    if (!vFactor) continue;

    const rawScore = dot(uFactor, vFactor);
    // Normalize to [0, 1] using sigmoid
    const score = 1 / (1 + Math.exp(-rawScore));

    scored.push({
      videoId,
      score: Math.round(score * 1000) / 1000,
      reason: `Collaborative filtering: predicted affinity ${Math.round(score * 100)}%`,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Get the raw confidence value for a user–video pair.
 */
export function getConfidence(userId: string, videoId: string): number {
  return confidenceMatrix.get(userId)?.get(videoId) ?? 0;
}

/**
 * Get all interactions for a user.
 */
export function getUserInteractions(userId: string): UserInteraction[] {
  return interactions.filter((i) => i.userId === userId);
}

/**
 * Get the ALS model state for inspection/debugging.
 */
export function getModelState(): {
  users: number;
  videos: number;
  factors: number;
  dirty: boolean;
} {
  return {
    users: userIndex.length,
    videos: videoIndex.length,
    factors: Math.min(LATENT_FACTORS, userIndex.length, videoIndex.length),
    dirty: modelDirty,
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetCollaborativeModel(): void {
  interactions.length = 0;
  confidenceMatrix.clear();
  userIndex = [];
  videoIndex = [];
  userFactors = [];
  itemFactors = [];
  modelDirty = true;
}
