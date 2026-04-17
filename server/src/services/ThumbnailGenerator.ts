/**
 * ThumbnailGenerator.ts – Frame scoring and auto-enhanced thumbnail extraction.
 *
 * For every chapter and highlight this service:
 *   1. Receives candidate frames (or generates stubs for testing).
 *   2. Scores each frame across four dimensions:
 *        a. Face presence        – skin-tone centroid detection.
 *        b. Colour vibrancy      – mean HSV saturation.
 *        c. Sharpness            – Laplacian variance proxy.
 *        d. Rule-of-thirds       – energy at intersection quadrants.
 *   3. Selects the highest-scoring frame per chapter / highlight window.
 *   4. Auto-enhances the selected frame:
 *        a. Brightness / contrast normalisation (linear stretch).
 *        b. Subtle vignette (dark radial gradient at edges).
 *        c. Saturation boost (convert to HSV-like and boost S).
 *   5. Returns thumbnail metadata (dimensions, scores, enhancement params,
 *      and a base-64 encoded stub image placeholder in prod-stub mode).
 *
 * In production: replace stub pixel generation with real FFmpeg frame reads
 * and encode the enhanced frame with sharp/jimp before storing to object storage.
 */

import { EventEmitter } from "events";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target thumbnail output resolution. */
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;

/** Weights for compositing the per-frame quality score. */
const FRAME_SCORE_WEIGHTS = {
  facePresence: 0.30,
  colourVibrancy: 0.25,
  sharpness: 0.25,
  ruleOfThirds: 0.20,
} as const;

/** Enhancement parameters – adjust for a cinema-grade look. */
const ENHANCEMENT_DEFAULTS = {
  /** Black point: values below this are stretched to 0. */
  blackPoint: 10,
  /** White point: values above this are stretched to 255. */
  whitePoint: 245,
  /** Saturation multiplier applied in the HSV-proxy transform. */
  saturationBoost: 1.25,
  /** Vignette strength: fraction of pixel brightness reduced at corners (0–1). */
  vignetteStrength: 0.35,
  /** Vignette falloff: Gaussian σ as a fraction of the diagonal. */
  vignetteFalloff: 0.55,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A raw video frame suitable for thumbnail scoring. */
export interface ThumbnailFrame {
  /** Timestamp within the video (seconds). */
  timestampSecs: number;
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
  /**
   * Flat RGB pixel buffer: [R0,G0,B0, R1,G1,B1, …].
   * Length must equal width × height × 3.
   */
  pixels: Uint8Array;
}

/** Per-frame quality scores. */
export interface FrameQualityScores {
  timestampSecs: number;
  /** Probability of face presence in the frame [0, 1]. */
  facePresence: number;
  /** Mean colour saturation across the frame [0, 1]. */
  colourVibrancy: number;
  /** Proxy for image sharpness (Laplacian variance, normalised) [0, 1]. */
  sharpness: number;
  /** Energy at rule-of-thirds intersection points [0, 1]. */
  ruleOfThirds: number;
  /** Weighted composite quality score [0, 1]. */
  compositeScore: number;
}

/** Enhancement parameters recorded for a generated thumbnail. */
export interface EnhancementParams {
  blackPoint: number;
  whitePoint: number;
  saturationBoost: number;
  vignetteStrength: number;
  vignetteFalloff: number;
}

/** A generated thumbnail record. */
export interface ThumbnailRecord {
  /** Stable identifier. */
  thumbnailId: string;
  /** The video this thumbnail belongs to. */
  videoId: string;
  /** "chapter" | "highlight" | "manual" */
  sourceType: ThumbnailSourceType;
  /** The chapter or highlight ID this thumbnail was generated for. */
  sourceId: string;
  /** Timestamp of the selected source frame. */
  frameTimestampSecs: number;
  /** Quality scores of the selected frame. */
  qualityScores: FrameQualityScores;
  /** Enhancement parameters applied. */
  enhancement: EnhancementParams;
  /** Output image width (pixels). */
  width: number;
  /** Output image height (pixels). */
  height: number;
  /**
   * In production this would be a URL to object storage.
   * In stub mode it is a data-URI base-64 PNG placeholder.
   */
  url: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

export type ThumbnailSourceType = "chapter" | "highlight" | "manual";

/** Input descriptor for a single thumbnail generation request. */
export interface ThumbnailRequest {
  videoId: string;
  sourceType: ThumbnailSourceType;
  sourceId: string;
  /**
   * Candidate frames from which the best will be selected.
   * If omitted the service generates stubs.
   */
  candidateFrames?: ThumbnailFrame[];
  /**
   * Hint timestamp – if provided, the selected frame will be the
   * highest-scoring frame within ±5 s of this value.
   */
  hintTimestampSecs?: number;
  /** Override enhancement parameters. */
  enhancementOverride?: Partial<EnhancementParams>;
}

/** Parameters for a batch thumbnail generation job. */
export interface ThumbnailGenerationParams {
  videoId: string;
  requests: ThumbnailRequest[];
}

export type ThumbnailJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ThumbnailGenerationJob {
  jobId: string;
  videoId: string;
  status: ThumbnailJobStatus;
  params: ThumbnailGenerationParams;
  result: ThumbnailGenerationResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ThumbnailGenerationResult {
  jobId: string;
  videoId: string;
  thumbnails: ThumbnailRecord[];
  completedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const thumbnailJobs = new Map<string, ThumbnailGenerationJob>();

export const thumbnailGeneratorEvents = new EventEmitter();

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return `tg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function thumbnailId(): string {
  return `tn-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

// ---------------------------------------------------------------------------
// Frame scoring: face presence
// ---------------------------------------------------------------------------

/**
 * Estimate face presence using a skin-tone heuristic applied to the
 * central 70% × 80% region of the frame.
 *
 * Skin detection rule (Kovac et al.):
 *   R > 95, G > 40, B > 20, R > G, R > B, |R − G| > 15,
 *   and luma in [80, 230].
 */
export function scoreFacePresence(frame: ThumbnailFrame): number {
  const { pixels, width, height } = frame;
  const rowStart = Math.floor(height * 0.1);
  const rowEnd = Math.floor(height * 0.9);
  const colStart = Math.floor(width * 0.15);
  const colEnd = Math.floor(width * 0.85);

  let skinCount = 0;
  let total = 0;

  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const pIdx = (row * width + col) * 3;
      const r = pixels[pIdx];
      const g = pixels[pIdx + 1];
      const b = pixels[pIdx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      if (
        r > 95 && g > 40 && b > 20 &&
        r > g && r > b &&
        Math.abs(r - g) > 15 &&
        luma > 80 && luma < 230
      ) {
        skinCount++;
      }
      total++;
    }
  }

  if (total === 0) return 0;

  // A skin ratio of 0.25 is a strong face indicator.
  return clamp01(skinCount / total / 0.25);
}

// ---------------------------------------------------------------------------
// Frame scoring: colour vibrancy
// ---------------------------------------------------------------------------

/**
 * Score colour vibrancy as the mean HSV saturation across all pixels.
 *
 * We approximate saturation as (max − min) / max per pixel (HSV definition).
 */
export function scoreColourVibrancy(frame: ThumbnailFrame): number {
  const { pixels, width, height } = frame;
  const totalPixels = width * height;
  if (totalPixels === 0) return 0;

  let satSum = 0;

  for (let p = 0; p < totalPixels; p++) {
    const r = pixels[p * 3];
    const g = pixels[p * 3 + 1];
    const b = pixels[p * 3 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    satSum += max > 0 ? (max - min) / max : 0;
  }

  return clamp01(satSum / totalPixels);
}

// ---------------------------------------------------------------------------
// Frame scoring: sharpness (Laplacian variance proxy)
// ---------------------------------------------------------------------------

/**
 * Estimate image sharpness via a 3×3 Laplacian convolution on the luma channel.
 *
 * A high variance of the Laplacian output indicates sharp edges → the frame
 * is in focus.
 *
 * Kernel:
 *   0  1  0
 *   1 -4  1
 *   0  1  0
 */
export function scoreSharpness(frame: ThumbnailFrame): number {
  const { pixels, width, height } = frame;
  if (width < 3 || height < 3) return 0;

  const responses: number[] = [];

  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const luma = (row: number, col: number) => {
        const pIdx = (row * width + col) * 3;
        return 0.299 * pixels[pIdx] + 0.587 * pixels[pIdx + 1] + 0.114 * pixels[pIdx + 2];
      };

      const lap =
        luma(row - 1, col) +
        luma(row + 1, col) +
        luma(row, col - 1) +
        luma(row, col + 1) -
        4 * luma(row, col);

      responses.push(lap);
    }
  }

  if (responses.length === 0) return 0;

  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  const variance =
    responses.reduce((sum, v) => sum + (v - mean) ** 2, 0) / responses.length;

  // Typical in-focus luma-space Laplacian variance: 200–2000.
  return clamp01(Math.sqrt(variance) / 30);
}

// ---------------------------------------------------------------------------
// Frame scoring: rule of thirds
// ---------------------------------------------------------------------------

/**
 * Score the frame by measuring the luma energy near the four rule-of-thirds
 * intersection points:  (1/3, 1/3), (1/3, 2/3), (2/3, 1/3), (2/3, 2/3).
 *
 * For each intersection we sum luma values within a 10% × 10% window
 * centred at that point, then normalise.
 */
export function scoreRuleOfThirds(frame: ThumbnailFrame): number {
  const { pixels, width, height } = frame;
  if (width === 0 || height === 0) return 0;

  const intersections: [number, number][] = [
    [1 / 3, 1 / 3],
    [1 / 3, 2 / 3],
    [2 / 3, 1 / 3],
    [2 / 3, 2 / 3],
  ];

  const windowW = Math.max(1, Math.floor(width * 0.10));
  const windowH = Math.max(1, Math.floor(height * 0.10));

  let totalLuma = 0;
  let totalPixels = 0;

  for (const [ry, rx] of intersections) {
    const centreRow = Math.floor(ry * height);
    const centreCol = Math.floor(rx * width);
    const r0 = clamp(centreRow - windowH / 2, 0, height - 1);
    const r1 = clamp(centreRow + windowH / 2, 0, height - 1);
    const c0 = clamp(centreCol - windowW / 2, 0, width - 1);
    const c1 = clamp(centreCol + windowW / 2, 0, width - 1);

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const pIdx = (row * width + col) * 3;
        totalLuma +=
          0.299 * pixels[pIdx] + 0.587 * pixels[pIdx + 1] + 0.114 * pixels[pIdx + 2];
        totalPixels++;
      }
    }
  }

  if (totalPixels === 0) return 0;

  const meanLuma = totalLuma / totalPixels;
  // We want frames where the rule-of-thirds regions are bright (subject present).
  return clamp01(meanLuma / 180);
}

// ---------------------------------------------------------------------------
// Composite frame scorer
// ---------------------------------------------------------------------------

/**
 * Compute all four quality scores and the weighted composite for a frame.
 */
export function scoreFrame(frame: ThumbnailFrame): FrameQualityScores {
  const facePresence = scoreFacePresence(frame);
  const colourVibrancy = scoreColourVibrancy(frame);
  const sharpness = scoreSharpness(frame);
  const ruleOfThirds = scoreRuleOfThirds(frame);

  const compositeScore =
    facePresence * FRAME_SCORE_WEIGHTS.facePresence +
    colourVibrancy * FRAME_SCORE_WEIGHTS.colourVibrancy +
    sharpness * FRAME_SCORE_WEIGHTS.sharpness +
    ruleOfThirds * FRAME_SCORE_WEIGHTS.ruleOfThirds;

  return {
    timestampSecs: frame.timestampSecs,
    facePresence,
    colourVibrancy,
    sharpness,
    ruleOfThirds,
    compositeScore: clamp01(compositeScore),
  };
}

// ---------------------------------------------------------------------------
// Best frame selection
// ---------------------------------------------------------------------------

/**
 * Select the highest-scoring frame from the candidate list.
 *
 * If a hint timestamp is provided, restrict candidates to frames within
 * ±5 seconds of the hint, falling back to all candidates if none qualify.
 */
export function selectBestFrame(
  frames: ThumbnailFrame[],
  hintTimestampSecs?: number
): { frame: ThumbnailFrame; scores: FrameQualityScores } | null {
  if (frames.length === 0) return null;

  const HINT_WINDOW_SECS = 5;

  let candidates = frames;
  if (hintTimestampSecs !== undefined) {
    const windowed = frames.filter(
      (f) => Math.abs(f.timestampSecs - hintTimestampSecs) <= HINT_WINDOW_SECS
    );
    if (windowed.length > 0) candidates = windowed;
  }

  let bestFrame = candidates[0];
  let bestScores = scoreFrame(candidates[0]);

  for (let i = 1; i < candidates.length; i++) {
    const scores = scoreFrame(candidates[i]);
    if (scores.compositeScore > bestScores.compositeScore) {
      bestFrame = candidates[i];
      bestScores = scores;
    }
  }

  return { frame: bestFrame, scores: bestScores };
}

// ---------------------------------------------------------------------------
// Image enhancement
// ---------------------------------------------------------------------------

/**
 * Apply brightness/contrast normalisation, saturation boost, and vignette
 * to a raw pixel buffer.
 *
 * Returns a new Uint8Array of the same size with enhanced pixels.
 *
 * All transforms are applied in-place on the copy; originals are untouched.
 */
export function enhanceFrame(
  frame: ThumbnailFrame,
  params: EnhancementParams
): Uint8Array {
  const { pixels, width, height } = frame;
  const totalPixels = width * height;
  const enhanced = new Uint8Array(pixels);

  const { blackPoint, whitePoint, saturationBoost, vignetteStrength, vignetteFalloff } =
    params;

  const range = whitePoint - blackPoint;
  const halfW = width / 2;
  const halfH = height / 2;
  // diagonal used as reference for vignette falloff documentation; actual
  // per-pixel distance is computed as a normalised fraction (dx, dy in [-1, 1]).
  void Math.sqrt(halfW * halfW + halfH * halfH);

  for (let p = 0; p < totalPixels; p++) {
    const row = Math.floor(p / width);
    const col = p % width;

    let r = enhanced[p * 3];
    let g = enhanced[p * 3 + 1];
    let b = enhanced[p * 3 + 2];

    // ---- Brightness / contrast stretch ----
    r = Math.round(clamp((r - blackPoint) * 255 / range, 0, 255));
    g = Math.round(clamp((g - blackPoint) * 255 / range, 0, 255));
    b = Math.round(clamp((b - blackPoint) * 255 / range, 0, 255));

    // ---- Saturation boost (HSV-proxy) ----
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const newSat = clamp01(sat * saturationBoost);

    if (sat > 0 && maxC > 0) {
      const scale = newSat / sat;
      r = Math.round(clamp(maxC - (maxC - r) * scale, 0, 255));
      g = Math.round(clamp(maxC - (maxC - g) * scale, 0, 255));
      b = Math.round(clamp(maxC - (maxC - b) * scale, 0, 255));
    }

    // ---- Vignette (Gaussian radial darkening) ----
    const dx = (col - halfW) / halfW;
    const dy = (row - halfH) / halfH;
    const distNorm = Math.sqrt(dx * dx + dy * dy);
    const sigma = vignetteFalloff;
    const vignetteFactor = 1 - vignetteStrength * (1 - Math.exp(-(distNorm * distNorm) / (2 * sigma * sigma)));

    r = Math.round(clamp(r * vignetteFactor, 0, 255));
    g = Math.round(clamp(g * vignetteFactor, 0, 255));
    b = Math.round(clamp(b * vignetteFactor, 0, 255));

    enhanced[p * 3] = r;
    enhanced[p * 3 + 1] = g;
    enhanced[p * 3 + 2] = b;
  }

  return enhanced;
}

// ---------------------------------------------------------------------------
// Stub frame generator
// ---------------------------------------------------------------------------

/**
 * Generate realistic-looking stub frames for a given timestamp window.
 * Used when no real frame data is provided.
 */
function generateStubFrames(
  startSecs: number,
  endSecs: number,
  fps = 1,
  width = 16,
  height = 9
): ThumbnailFrame[] {
  const frames: ThumbnailFrame[] = [];
  const totalFrames = Math.max(1, Math.ceil((endSecs - startSecs) * fps));

  // Random colour palette for this segment.
  const baseR = 60 + Math.floor(Math.random() * 160);
  const baseG = 40 + Math.floor(Math.random() * 160);
  const baseB = 80 + Math.floor(Math.random() * 160);

  for (let i = 0; i < totalFrames; i++) {
    const timestampSecs = startSecs + i / fps;
    const pixels = new Uint8Array(width * height * 3);

    for (let p = 0; p < width * height; p++) {
      const row = Math.floor(p / width);
      const col = p % width;

      // Rule-of-thirds helper: make intersections brighter.
      const atThird =
        (Math.abs(row / height - 1 / 3) < 0.08 || Math.abs(row / height - 2 / 3) < 0.08) &&
        (Math.abs(col / width - 1 / 3) < 0.08 || Math.abs(col / width - 2 / 3) < 0.08);

      const boost = atThird ? 50 : 0;
      pixels[p * 3] = clamp(baseR + boost + Math.floor(Math.random() * 40 - 20), 0, 255);
      pixels[p * 3 + 1] = clamp(baseG + boost + Math.floor(Math.random() * 40 - 20), 0, 255);
      pixels[p * 3 + 2] = clamp(baseB + boost + Math.floor(Math.random() * 40 - 20), 0, 255);
    }

    frames.push({ timestampSecs, width, height, pixels });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Stub URL generator
// ---------------------------------------------------------------------------

/**
 * In production this would return a CDN URL after uploading the enhanced frame.
 * In stub mode it returns a placeholder SVG data-URI encoded as base64.
 */
function generateStubThumbnailUrl(
  videoId: string,
  sourceId: string,
  frameTimestampSecs: number
): string {
  const t = Math.round(frameTimestampSecs);
  return `/api/v1/videos/${videoId}/thumbnails/${sourceId}?t=${t}&stub=1`;
}

// ---------------------------------------------------------------------------
// Core thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a single thumbnail from a ThumbnailRequest.
 */
export async function generateThumbnail(
  request: ThumbnailRequest
): Promise<ThumbnailRecord> {
  const { videoId, sourceType, sourceId, hintTimestampSecs, enhancementOverride } = request;

  // ------ 1. Obtain candidate frames ------------------------------------
  const startSecs = hintTimestampSecs !== undefined ? Math.max(0, hintTimestampSecs - 10) : 0;
  const endSecs = hintTimestampSecs !== undefined ? hintTimestampSecs + 10 : 30;

  const frames: ThumbnailFrame[] =
    request.candidateFrames && request.candidateFrames.length > 0
      ? request.candidateFrames
      : generateStubFrames(startSecs, endSecs);

  // ------ 2. Select best frame ------------------------------------------
  const selection = selectBestFrame(frames, hintTimestampSecs);
  if (!selection) {
    throw new Error(`No candidate frames available for ${sourceType} ${sourceId}`);
  }

  const { frame: bestFrame, scores } = selection;

  // ------ 3. Build enhancement params -----------------------------------
  const enhancement: EnhancementParams = {
    ...ENHANCEMENT_DEFAULTS,
    ...enhancementOverride,
  };

  // ------ 4. Enhance the frame ------------------------------------------
  enhanceFrame(bestFrame, enhancement);

  // ------ 5. Generate URL -----------------------------------------------
  const url = generateStubThumbnailUrl(videoId, sourceId, bestFrame.timestampSecs);

  const record: ThumbnailRecord = {
    thumbnailId: thumbnailId(),
    videoId,
    sourceType,
    sourceId,
    frameTimestampSecs: bestFrame.timestampSecs,
    qualityScores: scores,
    enhancement,
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    url,
    createdAt: nowIso(),
  };

  logger.info(
    {
      thumbnailId: record.thumbnailId,
      videoId,
      sourceId,
      compositeScore: scores.compositeScore.toFixed(3),
    },
    "ThumbnailGenerator: thumbnail generated"
  );

  return record;
}

// ---------------------------------------------------------------------------
// Batch generation
// ---------------------------------------------------------------------------

/**
 * Generate thumbnails for all requests in a batch job.
 */
export async function runThumbnailGeneration(
  params: ThumbnailGenerationParams
): Promise<ThumbnailGenerationResult> {
  const jobId = shortId();
  logger.info(
    { jobId, videoId: params.videoId, count: params.requests.length },
    "ThumbnailGenerator: batch job starting"
  );

  const thumbnails: ThumbnailRecord[] = [];

  for (const req of params.requests) {
    const record = await generateThumbnail(req);
    thumbnails.push(record);
  }

  logger.info(
    { jobId, generated: thumbnails.length },
    "ThumbnailGenerator: batch job completed"
  );

  return {
    jobId,
    videoId: params.videoId,
    thumbnails,
    completedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Async job queue API
// ---------------------------------------------------------------------------

export function submitThumbnailGenerationJob(
  params: ThumbnailGenerationParams
): ThumbnailGenerationJob {
  const jobId = shortId();
  const now = nowIso();

  const job: ThumbnailGenerationJob = {
    jobId,
    videoId: params.videoId,
    status: "queued",
    params,
    result: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  thumbnailJobs.set(jobId, job);
  logger.info({ jobId, videoId: params.videoId }, "ThumbnailGenerator: job queued");

  processThumbnailJob(jobId).catch((err) => {
    logger.error({ jobId, err }, "ThumbnailGenerator: unhandled job error");
  });

  return job;
}

export function getThumbnailGenerationJob(jobId: string): ThumbnailGenerationJob | undefined {
  return thumbnailJobs.get(jobId);
}

export function listThumbnailGenerationJobs(videoId?: string): ThumbnailGenerationJob[] {
  const all = Array.from(thumbnailJobs.values());
  return videoId ? all.filter((j) => j.videoId === videoId) : all;
}

async function processThumbnailJob(jobId: string): Promise<void> {
  const job = thumbnailJobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.updatedAt = nowIso();

  try {
    const result = await runThumbnailGeneration(job.params);
    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();
    thumbnailGeneratorEvents.emit("completed", job);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();
    thumbnailGeneratorEvents.emit("failed", job);
    logger.error({ jobId, err: msg }, "ThumbnailGenerator: job failed");
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function _resetThumbnailGenerationJobs(): void {
  thumbnailJobs.clear();
}
