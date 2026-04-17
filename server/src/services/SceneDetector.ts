/**
 * SceneDetector.ts – AI-powered video scene detection and chapter generation.
 *
 * Pipeline:
 *   1. Sample video frames at 1 fps (stubbed: accepts pre-supplied frame data).
 *   2. Compute per-frame RGB histograms (256 bins × 3 channels).
 *   3. Compare consecutive histograms with chi-squared distance.
 *   4. Flag a scene boundary when the distance exceeds a configurable threshold.
 *   5. Group contiguous scenes into chapters (min 30 s, max 300 s per chapter).
 *   6. Generate a human-readable chapter title from audio transcript of that window
 *      using extractive summarisation (longest non-trivial sentence heuristic).
 *   7. Persist analysis jobs in-memory (swap for DB in production).
 *
 * In production: replace the frame-extraction stub with real FFmpeg frame reads
 * and wire the transcript lookup to the TranscriptionService.
 */

import { EventEmitter } from "events";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default histogram difference threshold above which a scene cut is declared. */
const DEFAULT_SCENE_THRESHOLD = 0.35;

/** Minimum chapter duration in seconds. */
const MIN_CHAPTER_DURATION_SECS = 30;

/** Maximum chapter duration in seconds. */
const MAX_CHAPTER_DURATION_SECS = 300;

/** Number of histogram bins per channel. */
const HISTOGRAM_BINS = 256;

/** Number of RGB channels. */
const RGB_CHANNELS = 3;

/** Total histogram length (bins × channels). */
const HISTOGRAM_LENGTH = HISTOGRAM_BINS * RGB_CHANNELS;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single RGB frame represented as flat pixel data [R,G,B, R,G,B, …]. */
export interface RawFrame {
  /** Timestamp in seconds from start of video. */
  timestampSecs: number;
  /** Width of the frame in pixels. */
  width: number;
  /** Height of the frame in pixels. */
  height: number;
  /**
   * Flat pixel buffer: [R0,G0,B0, R1,G1,B1, …].
   * Length must equal width × height × 3.
   */
  pixels: Uint8Array;
}

/** Computed per-frame histogram. */
export interface FrameHistogram {
  timestampSecs: number;
  /** Flat normalised histogram: bins[channel * 256 + value] */
  histogram: Float32Array;
}

/** A detected scene boundary. */
export interface SceneBoundary {
  /** Start time of the scene in seconds. */
  startSecs: number;
  /** End time of the scene in seconds (exclusive). */
  endSecs: number;
  /** Chi-squared distance that triggered the boundary (0 at start of video). */
  boundaryScore: number;
  /** Index of the scene within the video (0-based). */
  sceneIndex: number;
}

/** A generated video chapter. */
export interface VideoChapter {
  /** Unique ID within this analysis job. */
  chapterId: string;
  /** 0-based chapter index. */
  chapterIndex: number;
  /** Chapter start time in seconds. */
  startSecs: number;
  /** Chapter end time in seconds. */
  endSecs: number;
  /** Duration in seconds. */
  durationSecs: number;
  /** Auto-generated chapter title derived from transcript. */
  title: string;
  /** Scenes grouped into this chapter. */
  scenes: SceneBoundary[];
  /** Representative thumbnail timestamp (most visually distinct frame time). */
  thumbnailTimestampSecs: number;
  /** Transcript segment text covering this chapter window. */
  transcriptExcerpt: string;
}

/** Parameters for a scene detection run. */
export interface SceneDetectionParams {
  /** ID of the video being analysed. */
  videoId: string;
  /**
   * Pre-sampled frames at ~1 fps.
   * If omitted the service generates synthetic frames for stub/test environments.
   */
  frames?: RawFrame[];
  /** Total video duration in seconds (required when frames are omitted). */
  videoDurationSecs?: number;
  /** Transcript segments from TranscriptionService (optional, improves titles). */
  transcriptSegments?: TranscriptSegmentRef[];
  /**
   * Chi-squared distance threshold [0, 1].
   * Lower ⇒ more sensitive (more scene cuts detected).
   * @default 0.35
   */
  threshold?: number;
}

/** Lightweight transcript segment reference passed from the caller. */
export interface TranscriptSegmentRef {
  start: number;
  end: number;
  text: string;
}

/** Status of a scene detection job. */
export type SceneDetectionStatus = "queued" | "processing" | "completed" | "failed";

/** A scene detection job record. */
export interface SceneDetectionJob {
  jobId: string;
  videoId: string;
  status: SceneDetectionStatus;
  params: SceneDetectionParams;
  result: SceneDetectionResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The full result of a completed scene detection run. */
export interface SceneDetectionResult {
  jobId: string;
  videoId: string;
  totalScenes: number;
  totalChapters: number;
  videoDurationSecs: number;
  sceneBoundaries: SceneBoundary[];
  chapters: VideoChapter[];
  thresholdUsed: number;
  framesAnalysed: number;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const sceneJobs = new Map<string, SceneDetectionJob>();

/** Event emitter so callers can subscribe to job completion. */
export const sceneDetectorEvents = new EventEmitter();

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return `sd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function chapterId(index: number): string {
  return `ch-${index.toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Histogram computation
// ---------------------------------------------------------------------------

/**
 * Compute a normalised per-channel RGB histogram for a single frame.
 *
 * The resulting Float32Array has HISTOGRAM_LENGTH elements:
 *   [R-channel bins 0..255, G-channel bins 0..255, B-channel bins 0..255]
 *
 * Each bin value is in [0, 1] and the sum of each channel's 256 bins equals 1.
 */
export function computeHistogram(frame: RawFrame): FrameHistogram {
  const totalPixels = frame.width * frame.height;
  const histogram = new Float32Array(HISTOGRAM_LENGTH);

  for (let p = 0; p < totalPixels; p++) {
    const r = frame.pixels[p * 3];
    const g = frame.pixels[p * 3 + 1];
    const b = frame.pixels[p * 3 + 2];
    histogram[r]++;
    histogram[HISTOGRAM_BINS + g]++;
    histogram[HISTOGRAM_BINS * 2 + b]++;
  }

  // Normalise each channel independently.
  for (let ch = 0; ch < RGB_CHANNELS; ch++) {
    const offset = ch * HISTOGRAM_BINS;
    for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
      histogram[offset + bin] /= totalPixels;
    }
  }

  return { timestampSecs: frame.timestampSecs, histogram };
}

/**
 * Chi-squared distance between two normalised histograms.
 *
 * χ²(H, H') = Σ (h_i − h'_i)² / (h_i + h'_i + ε)
 *
 * Returns a value in [0, ∞) where 0 means identical histograms.
 * In practice values above ~0.5 indicate hard cuts; the result is
 * clamped to [0, 1] for consistent threshold comparisons.
 */
export function chiSquaredDistance(a: Float32Array, b: Float32Array): number {
  const eps = 1e-10;
  let sum = 0;
  for (let i = 0; i < HISTOGRAM_LENGTH; i++) {
    const diff = a[i] - b[i];
    sum += (diff * diff) / (a[i] + b[i] + eps);
  }
  // Normalise: theoretical maximum for a binary histogram is HISTOGRAM_LENGTH.
  const normalised = sum / HISTOGRAM_LENGTH;
  return Math.min(1, normalised);
}

// ---------------------------------------------------------------------------
// Scene boundary detection
// ---------------------------------------------------------------------------

/**
 * Given a sequence of frame histograms, return the list of scene boundaries.
 *
 * A boundary is detected when the chi-squared distance between consecutive
 * frames exceeds `threshold`.  The first scene always starts at time 0.
 */
export function detectSceneBoundaries(
  histograms: FrameHistogram[],
  threshold: number
): SceneBoundary[] {
  if (histograms.length === 0) return [];

  const boundaries: SceneBoundary[] = [];
  let sceneIndex = 0;
  let sceneStartSecs = histograms[0].timestampSecs;

  for (let i = 1; i < histograms.length; i++) {
    const dist = chiSquaredDistance(histograms[i - 1].histogram, histograms[i].histogram);

    if (dist > threshold) {
      boundaries.push({
        startSecs: sceneStartSecs,
        endSecs: histograms[i].timestampSecs,
        boundaryScore: dist,
        sceneIndex,
      });
      sceneStartSecs = histograms[i].timestampSecs;
      sceneIndex++;
    }
  }

  // Push the final scene (from last boundary to end of video).
  const lastTs = histograms[histograms.length - 1].timestampSecs;
  boundaries.push({
    startSecs: sceneStartSecs,
    endSecs: lastTs,
    boundaryScore: 0,
    sceneIndex,
  });

  return boundaries;
}

// ---------------------------------------------------------------------------
// Chapter grouping
// ---------------------------------------------------------------------------

/**
 * Group scenes into chapters, enforcing min/max duration constraints.
 *
 * Algorithm:
 *   - Accumulate scenes into the current chapter.
 *   - If adding the next scene would exceed MAX_CHAPTER_DURATION_SECS,
 *     close the current chapter and start a new one.
 *   - If the current chapter has already reached MIN_CHAPTER_DURATION_SECS,
 *     prefer closing at high-salience scene boundaries (boundaryScore rank).
 *   - Any remaining scenes shorter than MIN_CHAPTER_DURATION_SECS are merged
 *     into the preceding chapter.
 */
export function groupScenesIntoChapters(
  scenes: SceneBoundary[],
  transcriptSegments: TranscriptSegmentRef[],
  videoDurationSecs: number
): VideoChapter[] {
  if (scenes.length === 0) return [];

  const rawChapters: SceneBoundary[][] = [];
  let currentGroup: SceneBoundary[] = [];
  let currentDuration = 0;

  for (const scene of scenes) {
    const sceneDuration = scene.endSecs - scene.startSecs;

    if (
      currentGroup.length > 0 &&
      currentDuration + sceneDuration > MAX_CHAPTER_DURATION_SECS &&
      currentDuration >= MIN_CHAPTER_DURATION_SECS
    ) {
      rawChapters.push(currentGroup);
      currentGroup = [scene];
      currentDuration = sceneDuration;
    } else {
      currentGroup.push(scene);
      currentDuration += sceneDuration;
    }
  }

  if (currentGroup.length > 0) {
    // Merge a very short trailing group into the last chapter.
    if (currentDuration < MIN_CHAPTER_DURATION_SECS && rawChapters.length > 0) {
      rawChapters[rawChapters.length - 1].push(...currentGroup);
    } else {
      rawChapters.push(currentGroup);
    }
  }

  return rawChapters.map((group, idx) => {
    const startSecs = group[0].startSecs;
    const endSecs = Math.min(videoDurationSecs, group[group.length - 1].endSecs);
    const durationSecs = endSecs - startSecs;

    const transcriptExcerpt = extractTranscriptWindow(
      transcriptSegments,
      startSecs,
      endSecs
    );
    const title = generateChapterTitle(transcriptExcerpt, idx);
    const thumbnailTimestampSecs = chooseThumbnailTimestamp(group, startSecs, endSecs);

    return {
      chapterId: chapterId(idx),
      chapterIndex: idx,
      startSecs,
      endSecs,
      durationSecs,
      title,
      scenes: group,
      thumbnailTimestampSecs,
      transcriptExcerpt,
    };
  });
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

/**
 * Concatenate transcript text segments that overlap with [startSecs, endSecs].
 */
function extractTranscriptWindow(
  segments: TranscriptSegmentRef[],
  startSecs: number,
  endSecs: number
): string {
  return segments
    .filter((s) => s.end > startSecs && s.start < endSecs)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Extractive summarisation: choose the "most informative" sentence from a text
 * snippet to use as the chapter title.
 *
 * Scoring heuristic:
 *   - Prefer sentences of 5–12 words (conversational but substantial).
 *   - Penalise sentences starting with stop-words (filler phrases).
 *   - Reward sentences with title-case words (proper nouns, emphasis).
 */
function generateChapterTitle(text: string, chapterIndex: number): string {
  const fallback = `Chapter ${chapterIndex + 1}`;
  if (!text) return fallback;

  const STOP_STARTERS = new Set([
    "i", "we", "you", "he", "she", "it", "they", "and", "but", "or", "so",
    "the", "a", "an", "this", "that", "these", "those", "um", "uh", "well",
    "okay", "so", "yeah", "right",
  ]);

  const sentences = text
    .replace(/\s+/g, " ")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length === 0) {
    // Fall back to first 50 characters of text.
    const clipped = text.slice(0, 50).trim();
    return clipped.length > 0 ? clipped : fallback;
  }

  let bestSentence = sentences[0];
  let bestScore = -Infinity;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    const wordCount = words.length;

    let score = 0;

    // Prefer medium-length sentences.
    if (wordCount >= 5 && wordCount <= 12) score += 3;
    else if (wordCount >= 3 && wordCount <= 20) score += 1;

    // Penalise filler starters.
    const firstWord = words[0]?.toLowerCase() ?? "";
    if (STOP_STARTERS.has(firstWord)) score -= 2;

    // Reward title-case words (potential proper nouns).
    const titleCaseCount = words.filter(
      (w) => w.length > 2 && w[0] === w[0].toUpperCase() && w !== w.toUpperCase()
    ).length;
    score += titleCaseCount * 0.5;

    // Reward sentences with digits (often timestamps / key facts).
    if (/\d/.test(sentence)) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  // Capitalise first letter, truncate to 80 chars.
  const title = bestSentence.charAt(0).toUpperCase() + bestSentence.slice(1);
  return title.length > 80 ? title.slice(0, 77) + "…" : title;
}

// ---------------------------------------------------------------------------
// Thumbnail timestamp selection
// ---------------------------------------------------------------------------

/**
 * Choose the timestamp for the representative thumbnail of a chapter group.
 *
 * Strategy: pick the frame just after the highest-scoring scene boundary
 * (most visually distinctive cut) within the group, which typically lands on
 * an establishing shot.  If all scores are zero, fall back to the midpoint.
 */
function chooseThumbnailTimestamp(
  scenes: SceneBoundary[],
  startSecs: number,
  endSecs: number
): number {
  if (scenes.length === 0) return (startSecs + endSecs) / 2;

  let maxScore = -1;
  let bestTs = scenes[0].startSecs + 1; // 1 s into the first scene

  for (const scene of scenes) {
    if (scene.boundaryScore > maxScore) {
      maxScore = scene.boundaryScore;
      bestTs = Math.max(scene.startSecs, scene.startSecs + 1);
    }
  }

  return Math.min(bestTs, endSecs - 0.5);
}

// ---------------------------------------------------------------------------
// Stub frame generator (test / local environments)
// ---------------------------------------------------------------------------

/**
 * Generate synthetic frames for a video of given duration.
 *
 * Each "frame" is a tiny 4×4 pixel image with pseudo-random colour variation.
 * Scene cuts are injected at semi-regular intervals to exercise the detector.
 */
function generateStubFrames(
  videoDurationSecs: number,
  fps = 1
): RawFrame[] {
  const totalFrames = Math.ceil(videoDurationSecs * fps);
  const frames: RawFrame[] = [];

  // Scene cut roughly every 30–90 seconds.
  const cutInterval = 45 + Math.floor(Math.random() * 30);
  let currentBaseR = 120;
  let currentBaseG = 80;
  let currentBaseB = 160;

  for (let i = 0; i < totalFrames; i++) {
    const timestampSecs = i / fps;

    // Inject a scene cut.
    if (i > 0 && i % cutInterval === 0) {
      currentBaseR = Math.floor(Math.random() * 200) + 20;
      currentBaseG = Math.floor(Math.random() * 200) + 20;
      currentBaseB = Math.floor(Math.random() * 200) + 20;
    }

    const width = 4;
    const height = 4;
    const pixels = new Uint8Array(width * height * 3);

    for (let p = 0; p < width * height; p++) {
      pixels[p * 3] = Math.min(255, currentBaseR + Math.floor(Math.random() * 20 - 10));
      pixels[p * 3 + 1] = Math.min(255, currentBaseG + Math.floor(Math.random() * 20 - 10));
      pixels[p * 3 + 2] = Math.min(255, currentBaseB + Math.floor(Math.random() * 20 - 10));
    }

    frames.push({ timestampSecs, width, height, pixels });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Core analysis function
// ---------------------------------------------------------------------------

/**
 * Run the complete scene detection and chapter generation pipeline.
 *
 * This is the pure-function heart of the service; it is called by the
 * async job runner and can also be invoked directly in tests.
 */
export async function runSceneDetection(
  params: SceneDetectionParams
): Promise<SceneDetectionResult> {
  const jobId = shortId();
  const threshold = params.threshold ?? DEFAULT_SCENE_THRESHOLD;

  logger.info(
    { jobId, videoId: params.videoId, threshold },
    "SceneDetector: starting analysis"
  );

  // ------ 1. Obtain frames -----------------------------------------------
  const videoDurationSecs =
    params.videoDurationSecs ??
    (params.frames && params.frames.length > 0
      ? params.frames[params.frames.length - 1].timestampSecs
      : 120);

  const frames: RawFrame[] =
    params.frames && params.frames.length > 0
      ? params.frames
      : generateStubFrames(videoDurationSecs);

  logger.info(
    { jobId, frames: frames.length, videoDurationSecs },
    "SceneDetector: frames ready"
  );

  // ------ 2. Compute histograms -------------------------------------------
  const histograms: FrameHistogram[] = frames.map((f) => computeHistogram(f));

  // ------ 3. Detect scene boundaries -------------------------------------
  const sceneBoundaries = detectSceneBoundaries(histograms, threshold);

  logger.info(
    { jobId, scenes: sceneBoundaries.length },
    "SceneDetector: scene boundaries detected"
  );

  // ------ 4. Group into chapters -----------------------------------------
  const transcriptSegments = params.transcriptSegments ?? [];
  const chapters = groupScenesIntoChapters(
    sceneBoundaries,
    transcriptSegments,
    videoDurationSecs
  );

  logger.info(
    { jobId, chapters: chapters.length },
    "SceneDetector: chapters generated"
  );

  const result: SceneDetectionResult = {
    jobId,
    videoId: params.videoId,
    totalScenes: sceneBoundaries.length,
    totalChapters: chapters.length,
    videoDurationSecs,
    sceneBoundaries,
    chapters,
    thresholdUsed: threshold,
    framesAnalysed: frames.length,
    completedAt: nowIso(),
  };

  return result;
}

// ---------------------------------------------------------------------------
// Async job queue API
// ---------------------------------------------------------------------------

/**
 * Submit a scene detection job.  Returns the job immediately; processing
 * happens asynchronously.
 */
export function submitSceneDetectionJob(
  params: SceneDetectionParams
): SceneDetectionJob {
  const jobId = shortId();
  const now = nowIso();

  const job: SceneDetectionJob = {
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

  sceneJobs.set(jobId, job);
  logger.info({ jobId, videoId: params.videoId }, "SceneDetector: job queued");

  // Run asynchronously.
  processSceneJob(jobId).catch((err) => {
    logger.error({ jobId, err }, "SceneDetector: unhandled job error");
  });

  return job;
}

/** Retrieve a job by ID. */
export function getSceneDetectionJob(jobId: string): SceneDetectionJob | undefined {
  return sceneJobs.get(jobId);
}

/** List all jobs for a given video. */
export function listSceneDetectionJobs(videoId?: string): SceneDetectionJob[] {
  const all = Array.from(sceneJobs.values());
  return videoId ? all.filter((j) => j.videoId === videoId) : all;
}

/** Internal async processor. */
async function processSceneJob(jobId: string): Promise<void> {
  const job = sceneJobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.updatedAt = nowIso();

  try {
    const result = await runSceneDetection(job.params);
    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();
    sceneDetectorEvents.emit("completed", job);
    logger.info(
      { jobId, chapters: result.totalChapters },
      "SceneDetector: job completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();
    sceneDetectorEvents.emit("failed", job);
    logger.error({ jobId, err: msg }, "SceneDetector: job failed");
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the in-memory job store (used in tests). */
export function _resetSceneDetectionJobs(): void {
  sceneJobs.clear();
}
