/**
 * HighlightDetector.ts – Multi-signal highlight detection for uploaded videos.
 *
 * Detection pipeline per 10-second analysis window:
 *
 *   1. Audio energy score     – RMS amplitude; spikes → crowd noise, laughter,
 *                               applause, sudden dialog.
 *   2. Visual motion score    – Mean absolute frame-difference between
 *                               consecutive frames; rapid motion → action.
 *   3. Text overlay score     – Detects sudden large bright regions that often
 *                               indicate subtitles, score graphics, or banners.
 *   4. Face emotion score     – Simulated via a composite of brightness
 *                               variance and saturation spikes (proxy for
 *                               close-up expressions with warm lighting).
 *
 * Each signal is normalised to [0, 1].  The composite "highlight score" is
 * a weighted sum of the four signals.
 *
 * Top-5 non-overlapping 10-second windows are selected as highlights.
 *
 * In production: swap stub generators for real audio/video decoders
 * (FFmpeg / Web Audio API on the client, or a media processing microservice).
 */

import { EventEmitter } from "events";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration of each analysis window in seconds. */
const WINDOW_DURATION_SECS = 10;

/** Minimum gap between selected highlights (seconds).  Prevents clustering. */
const MIN_HIGHLIGHT_GAP_SECS = 15;

/** How many top highlights to select per video. */
const MAX_HIGHLIGHTS = 5;

/** Weights for the four signal components (must sum to 1). */
const SIGNAL_WEIGHTS = {
  audioEnergy: 0.35,
  visualMotion: 0.30,
  textOverlay: 0.15,
  faceEmotion: 0.20,
} as const;

/** Duration of each generated highlight clip in seconds. */
const HIGHLIGHT_CLIP_DURATION_SECS = 15;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-window audio signal data. */
export interface AudioWindowData {
  /** Start of the window in seconds. */
  startSecs: number;
  /** Array of RMS energy samples within the window (arbitrary resolution). */
  rmsSamples: Float32Array;
}

/** Per-window frame pixel data for visual analysis. */
export interface VisualWindowData {
  /** Start of the window in seconds. */
  startSecs: number;
  /**
   * Sequence of raw frames (at ~1 fps) covering the window.
   * Each entry: { pixels: Uint8Array (RGB flat), width, height }
   */
  frames: Array<{ pixels: Uint8Array; width: number; height: number }>;
}

/** Scores for a single analysis window. */
export interface WindowSignalScores {
  startSecs: number;
  endSecs: number;
  /** Normalised audio energy spike score [0, 1]. */
  audioEnergyScore: number;
  /** Normalised visual motion score [0, 1]. */
  visualMotionScore: number;
  /** Normalised text overlay score [0, 1]. */
  textOverlayScore: number;
  /** Normalised face emotion score [0, 1]. */
  faceEmotionScore: number;
  /** Weighted composite highlight score [0, 1]. */
  highlightScore: number;
}

/** A detected video highlight. */
export interface VideoHighlight {
  /** Stable ID. */
  highlightId: string;
  /** 0-based rank (0 = best). */
  rank: number;
  /** Start time of the highlight clip in seconds. */
  startSecs: number;
  /** End time of the highlight clip in seconds. */
  endSecs: number;
  /** Duration of the clip in seconds (always HIGHLIGHT_CLIP_DURATION_SECS). */
  durationSecs: number;
  /** Composite score [0, 1]. */
  score: number;
  /** Individual signal scores. */
  signals: Omit<WindowSignalScores, "startSecs" | "endSecs" | "highlightScore">;
  /** Auto-generated label. */
  label: string;
  /** Timestamp of the most interesting single frame within the clip. */
  peakFrameTimestampSecs: number;
  /** Suggested share URL fragment for deep-linking. */
  shareFragment: string;
}

/** Parameters for a highlight detection run. */
export interface HighlightDetectionParams {
  /** ID of the video being analysed. */
  videoId: string;
  /** Total video duration in seconds. */
  videoDurationSecs: number;
  /**
   * Pre-computed audio window data at WINDOW_DURATION_SECS resolution.
   * Omit to use stub data (test environments).
   */
  audioWindows?: AudioWindowData[];
  /**
   * Pre-computed visual window data at WINDOW_DURATION_SECS resolution.
   * Omit to use stub data (test environments).
   */
  visualWindows?: VisualWindowData[];
  /**
   * Maximum number of highlights to return.
   * @default 5
   */
  maxHighlights?: number;
}

/** Status of a highlight detection job. */
export type HighlightDetectionStatus = "queued" | "processing" | "completed" | "failed";

/** A highlight detection job record. */
export interface HighlightDetectionJob {
  jobId: string;
  videoId: string;
  status: HighlightDetectionStatus;
  params: HighlightDetectionParams;
  result: HighlightDetectionResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The full result of a completed highlight detection run. */
export interface HighlightDetectionResult {
  jobId: string;
  videoId: string;
  totalWindowsAnalysed: number;
  highlights: VideoHighlight[];
  windowScores: WindowSignalScores[];
  videoDurationSecs: number;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const highlightJobs = new Map<string, HighlightDetectionJob>();

/** Event emitter for job lifecycle notifications. */
export const highlightDetectorEvents = new EventEmitter();

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return `hd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function highlightId(rank: number): string {
  return `hl-${rank.toString().padStart(3, "0")}-${Math.random().toString(36).substring(2, 6)}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Signal 1: Audio energy spike detection
// ---------------------------------------------------------------------------

/**
 * Score a window's audio based on RMS energy.
 *
 * We compare the window's peak RMS to its mean.  A high peak-to-mean ratio
 * (>3×) indicates a sudden loudness spike — characteristic of audience
 * reactions, explosions, or emphasis.
 *
 * Returns a score in [0, 1].
 */
export function scoreAudioEnergy(audioWindow: AudioWindowData): number {
  const { rmsSamples } = audioWindow;
  if (rmsSamples.length === 0) return 0;

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < rmsSamples.length; i++) {
    const v = rmsSamples[i];
    sum += v;
    if (v > peak) peak = v;
  }

  const mean = sum / rmsSamples.length;
  if (mean < 1e-6) return 0;

  // Peak-to-mean ratio capped at 5, normalised to [0, 1].
  const ratio = Math.min(5, peak / mean);
  return clamp01((ratio - 1) / 4);
}

// ---------------------------------------------------------------------------
// Signal 2: Visual motion detection
// ---------------------------------------------------------------------------

/**
 * Score a window's visual content based on inter-frame motion.
 *
 * We compute the mean absolute difference (MAD) between consecutive frames.
 * High MAD → rapid action (cuts, fast movement).
 *
 * Returns a score in [0, 1].
 */
export function scoreVisualMotion(visualWindow: VisualWindowData): number {
  const { frames } = visualWindow;
  if (frames.length < 2) return 0;

  let totalMad = 0;
  let comparisons = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    // Skip if dimensions differ (shouldn't happen in practice).
    if (
      prev.pixels.length !== curr.pixels.length ||
      prev.width !== curr.width ||
      prev.height !== curr.height
    ) {
      continue;
    }

    const totalPixels = prev.width * prev.height;
    let frameSum = 0;

    for (let p = 0; p < totalPixels * 3; p++) {
      frameSum += Math.abs(curr.pixels[p] - prev.pixels[p]);
    }

    totalMad += frameSum / (totalPixels * 3);
    comparisons++;
  }

  if (comparisons === 0) return 0;

  const avgMad = totalMad / comparisons;
  // Typical range: 0–30 for natural video.  Hard cuts: 60–80.
  return clamp01(avgMad / 50);
}

// ---------------------------------------------------------------------------
// Signal 3: Text overlay detection
// ---------------------------------------------------------------------------

/**
 * Score a window for text overlay presence.
 *
 * Heuristic: look for high-contrast horizontal bands near the bottom or top
 * of the frame (where subtitles and score graphics typically appear).
 * A sudden increase in the proportion of near-white or near-black pixels in
 * those bands indicates a text overlay.
 *
 * Returns a score in [0, 1].
 */
export function scoreTextOverlay(visualWindow: VisualWindowData): number {
  const { frames } = visualWindow;
  if (frames.length === 0) return 0;

  let totalScore = 0;

  for (const frame of frames) {
    const { pixels, width, height } = frame;
    const totalPixels = width * height;
    if (totalPixels === 0) continue;

    // Examine the bottom 20% and top 10% of the frame.
    const bottomBandStart = Math.floor(height * 0.8);
    const topBandEnd = Math.floor(height * 0.1);

    let extremePixels = 0;
    let bandPixels = 0;

    for (let row = 0; row < height; row++) {
      const inBand = row < topBandEnd || row >= bottomBandStart;
      if (!inBand) continue;

      for (let col = 0; col < width; col++) {
        const pIdx = (row * width + col) * 3;
        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        // Near-white (>220) or near-black (<35) pixels are text candidates.
        if (luma > 220 || luma < 35) extremePixels++;
        bandPixels++;
      }
    }

    if (bandPixels === 0) continue;

    const ratio = extremePixels / bandPixels;
    // A ratio above 0.3 strongly suggests text graphics.
    totalScore += clamp01(ratio / 0.3);
  }

  return clamp01(totalScore / Math.max(1, frames.length));
}

// ---------------------------------------------------------------------------
// Signal 4: Face emotion proxy
// ---------------------------------------------------------------------------

/**
 * Score a window for face emotion / close-up reaction presence.
 *
 * True face detection requires ML; here we use a proxy:
 *   – High skin-tone pixel ratio in the centre region.
 *   – High colour saturation variance (expressions change colour balance).
 *   – Brightness variance (side-lit faces create luminance variation).
 *
 * Returns a score in [0, 1].
 */
export function scoreFaceEmotion(visualWindow: VisualWindowData): number {
  const { frames } = visualWindow;
  if (frames.length === 0) return 0;

  let totalScore = 0;

  for (const frame of frames) {
    const { pixels, width, height } = frame;
    const totalPixels = width * height;
    if (totalPixels === 0) continue;

    // Focus on the central 60% × 80% region.
    const rowStart = Math.floor(height * 0.1);
    const rowEnd = Math.floor(height * 0.9);
    const colStart = Math.floor(width * 0.2);
    const colEnd = Math.floor(width * 0.8);

    let skinPixels = 0;
    let lumaSum = 0;
    let lumaSumSq = 0;
    let satSum = 0;
    let regionPixels = 0;

    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
        const pIdx = (row * width + col) * 3;
        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];

        // Skin tone: R > 95, G > 40, B > 20, R > G, R > B, |R−G| > 15.
        if (
          r > 95 && g > 40 && b > 20 &&
          r > g && r > b &&
          Math.abs(r - g) > 15
        ) {
          skinPixels++;
        }

        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        lumaSum += luma;
        lumaSumSq += luma * luma;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max > 0 ? (max - min) / max : 0;
        satSum += sat;

        regionPixels++;
      }
    }

    if (regionPixels === 0) continue;

    const skinRatio = skinPixels / regionPixels;
    const meanLuma = lumaSum / regionPixels;
    const lumaVariance = lumaSumSq / regionPixels - meanLuma * meanLuma;
    const lumaStdNorm = Math.sqrt(Math.max(0, lumaVariance)) / 128;
    const meanSat = satSum / regionPixels;

    // Composite: skin presence + luminance variance + saturation.
    const frameScore =
      clamp01(skinRatio * 2.5) * 0.4 +
      clamp01(lumaStdNorm * 3) * 0.3 +
      clamp01(meanSat * 2) * 0.3;

    totalScore += frameScore;
  }

  return clamp01(totalScore / Math.max(1, frames.length));
}

// ---------------------------------------------------------------------------
// Composite scorer
// ---------------------------------------------------------------------------

/**
 * Combine all four signals into a single WindowSignalScores record.
 */
export function scoreWindow(
  startSecs: number,
  audioDatum: AudioWindowData | null,
  visualDatum: VisualWindowData | null
): WindowSignalScores {
  const endSecs = startSecs + WINDOW_DURATION_SECS;

  const defaultAudio: AudioWindowData = {
    startSecs,
    rmsSamples: new Float32Array(0),
  };
  const defaultVisual: VisualWindowData = {
    startSecs,
    frames: [],
  };

  const audioEnergyScore = scoreAudioEnergy(audioDatum ?? defaultAudio);
  const visualMotionScore = scoreVisualMotion(visualDatum ?? defaultVisual);
  const textOverlayScore = scoreTextOverlay(visualDatum ?? defaultVisual);
  const faceEmotionScore = scoreFaceEmotion(visualDatum ?? defaultVisual);

  const highlightScore =
    audioEnergyScore * SIGNAL_WEIGHTS.audioEnergy +
    visualMotionScore * SIGNAL_WEIGHTS.visualMotion +
    textOverlayScore * SIGNAL_WEIGHTS.textOverlay +
    faceEmotionScore * SIGNAL_WEIGHTS.faceEmotion;

  return {
    startSecs,
    endSecs,
    audioEnergyScore,
    visualMotionScore,
    textOverlayScore,
    faceEmotionScore,
    highlightScore: clamp01(highlightScore),
  };
}

// ---------------------------------------------------------------------------
// Highlight selection (greedy non-overlapping with minimum gap)
// ---------------------------------------------------------------------------

/**
 * Select the top-N non-overlapping windows, enforcing a minimum gap between
 * selected highlights to avoid clustering multiple clips from one burst.
 */
export function selectTopHighlights(
  windowScores: WindowSignalScores[],
  maxHighlights: number,
  minGapSecs: number,
  videoDurationSecs: number
): WindowSignalScores[] {
  // Sort descending by highlightScore.
  const sorted = [...windowScores].sort((a, b) => b.highlightScore - a.highlightScore);

  const selected: WindowSignalScores[] = [];

  outer: for (const candidate of sorted) {
    if (selected.length >= maxHighlights) break;

    for (const existing of selected) {
      const gap = Math.abs(candidate.startSecs - existing.startSecs);
      if (gap < minGapSecs) continue outer;
    }

    // Clip end to video duration.
    if (candidate.startSecs >= videoDurationSecs) continue;
    selected.push(candidate);
  }

  // Sort selected highlights by start time for presentation.
  return selected.sort((a, b) => a.startSecs - b.startSecs);
}

// ---------------------------------------------------------------------------
// Highlight label generation
// ---------------------------------------------------------------------------

const HIGHLIGHT_LABELS = [
  "Peak Moment",
  "Action Surge",
  "Key Reaction",
  "Crowd Eruption",
  "Critical Beat",
  "Turning Point",
  "Standout Scene",
  "Emotional Spike",
  "Big Reveal",
  "Power Play",
];

function generateHighlightLabel(
  rank: number,
  signals: Omit<WindowSignalScores, "startSecs" | "endSecs" | "highlightScore">
): string {
  // Select label based on dominant signal.
  const maxSignal = Math.max(
    signals.audioEnergyScore,
    signals.visualMotionScore,
    signals.textOverlayScore,
    signals.faceEmotionScore
  );

  if (maxSignal === signals.audioEnergyScore && signals.audioEnergyScore > 0.6) {
    return "Crowd Eruption";
  }
  if (maxSignal === signals.visualMotionScore && signals.visualMotionScore > 0.6) {
    return "Action Surge";
  }
  if (maxSignal === signals.faceEmotionScore && signals.faceEmotionScore > 0.6) {
    return "Key Reaction";
  }
  if (maxSignal === signals.textOverlayScore && signals.textOverlayScore > 0.6) {
    return "Big Reveal";
  }

  return HIGHLIGHT_LABELS[rank % HIGHLIGHT_LABELS.length];
}

// ---------------------------------------------------------------------------
// Stub data generators
// ---------------------------------------------------------------------------

function generateStubAudioWindows(videoDurationSecs: number): AudioWindowData[] {
  const windows: AudioWindowData[] = [];
  const windowCount = Math.ceil(videoDurationSecs / WINDOW_DURATION_SECS);

  // Randomly inject 3–5 high-energy spikes.
  const spikeWindows = new Set<number>();
  const spikeCount = 3 + Math.floor(Math.random() * 3);
  while (spikeWindows.size < Math.min(spikeCount, windowCount)) {
    spikeWindows.add(Math.floor(Math.random() * windowCount));
  }

  for (let w = 0; w < windowCount; w++) {
    const samplesPerWindow = 44;
    const rmsSamples = new Float32Array(samplesPerWindow);

    const isSpike = spikeWindows.has(w);
    const baseEnergy = 0.05 + Math.random() * 0.1;

    for (let s = 0; s < samplesPerWindow; s++) {
      if (isSpike && s > samplesPerWindow * 0.3 && s < samplesPerWindow * 0.7) {
        rmsSamples[s] = baseEnergy * (4 + Math.random() * 3);
      } else {
        rmsSamples[s] = baseEnergy * (0.8 + Math.random() * 0.4);
      }
    }

    windows.push({ startSecs: w * WINDOW_DURATION_SECS, rmsSamples });
  }

  return windows;
}

function generateStubVisualWindows(videoDurationSecs: number): VisualWindowData[] {
  const windows: VisualWindowData[] = [];
  const windowCount = Math.ceil(videoDurationSecs / WINDOW_DURATION_SECS);
  const framesPerWindow = WINDOW_DURATION_SECS; // ~1 fps

  // Randomly inject 4–6 motion-heavy windows.
  const motionWindows = new Set<number>();
  const motionCount = 4 + Math.floor(Math.random() * 3);
  while (motionWindows.size < Math.min(motionCount, windowCount)) {
    motionWindows.add(Math.floor(Math.random() * windowCount));
  }

  for (let w = 0; w < windowCount; w++) {
    const isHighMotion = motionWindows.has(w);
    const frames: VisualWindowData["frames"] = [];

    // Base colour for this window (shifts on high-motion windows).
    let baseR = 80 + Math.floor(Math.random() * 100);
    let baseG = 60 + Math.floor(Math.random() * 100);
    let baseB = 100 + Math.floor(Math.random() * 100);

    for (let f = 0; f < framesPerWindow; f++) {
      const width = 8;
      const height = 6;
      const pixels = new Uint8Array(width * height * 3);

      if (isHighMotion && f > 2) {
        // Shift colour dramatically on high-motion frames.
        baseR = Math.floor(Math.random() * 220) + 20;
        baseG = Math.floor(Math.random() * 220) + 20;
        baseB = Math.floor(Math.random() * 220) + 20;
      }

      for (let p = 0; p < width * height; p++) {
        pixels[p * 3] = Math.min(255, baseR + Math.floor(Math.random() * 30 - 15));
        pixels[p * 3 + 1] = Math.min(255, baseG + Math.floor(Math.random() * 30 - 15));
        pixels[p * 3 + 2] = Math.min(255, baseB + Math.floor(Math.random() * 30 - 15));
      }

      frames.push({ pixels, width, height });
    }

    windows.push({ startSecs: w * WINDOW_DURATION_SECS, frames });
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Core analysis function
// ---------------------------------------------------------------------------

/**
 * Run the complete highlight detection pipeline.
 *
 * Returns a HighlightDetectionResult suitable for serialisation.
 */
export async function runHighlightDetection(
  params: HighlightDetectionParams
): Promise<HighlightDetectionResult> {
  const jobId = shortId();
  const { videoId, videoDurationSecs } = params;
  const maxHighlights = params.maxHighlights ?? MAX_HIGHLIGHTS;

  logger.info(
    { jobId, videoId, videoDurationSecs },
    "HighlightDetector: starting analysis"
  );

  // ------ 1. Prepare window data -----------------------------------------
  const audioWindows =
    params.audioWindows && params.audioWindows.length > 0
      ? params.audioWindows
      : generateStubAudioWindows(videoDurationSecs);

  const visualWindows =
    params.visualWindows && params.visualWindows.length > 0
      ? params.visualWindows
      : generateStubVisualWindows(videoDurationSecs);

  const windowCount = Math.ceil(videoDurationSecs / WINDOW_DURATION_SECS);

  // ------ 2. Build indexed maps ------------------------------------------
  const audioMap = new Map<number, AudioWindowData>();
  for (const aw of audioWindows) {
    const windowIdx = Math.floor(aw.startSecs / WINDOW_DURATION_SECS);
    audioMap.set(windowIdx, aw);
  }

  const visualMap = new Map<number, VisualWindowData>();
  for (const vw of visualWindows) {
    const windowIdx = Math.floor(vw.startSecs / WINDOW_DURATION_SECS);
    visualMap.set(windowIdx, vw);
  }

  // ------ 3. Score each window ------------------------------------------
  const windowScores: WindowSignalScores[] = [];

  for (let w = 0; w < windowCount; w++) {
    const startSecs = w * WINDOW_DURATION_SECS;
    const scores = scoreWindow(
      startSecs,
      audioMap.get(w) ?? null,
      visualMap.get(w) ?? null
    );
    windowScores.push(scores);
  }

  logger.info(
    { jobId, windowsScored: windowScores.length },
    "HighlightDetector: windows scored"
  );

  // ------ 4. Select top highlights --------------------------------------
  const selected = selectTopHighlights(
    windowScores,
    maxHighlights,
    MIN_HIGHLIGHT_GAP_SECS,
    videoDurationSecs
  );

  // ------ 5. Build VideoHighlight records --------------------------------
  const highlights: VideoHighlight[] = selected.map((ws, rank) => {
    const clipStart = ws.startSecs;
    const clipEnd = Math.min(
      videoDurationSecs,
      clipStart + HIGHLIGHT_CLIP_DURATION_SECS
    );
    const peakFrameTimestampSecs =
      clipStart + (clipEnd - clipStart) * 0.4; // 40% into clip

    const signals = {
      audioEnergyScore: ws.audioEnergyScore,
      visualMotionScore: ws.visualMotionScore,
      textOverlayScore: ws.textOverlayScore,
      faceEmotionScore: ws.faceEmotionScore,
    };

    return {
      highlightId: highlightId(rank),
      rank,
      startSecs: clipStart,
      endSecs: clipEnd,
      durationSecs: clipEnd - clipStart,
      score: ws.highlightScore,
      signals,
      label: generateHighlightLabel(rank, signals),
      peakFrameTimestampSecs,
      shareFragment: `t=${Math.round(clipStart)}`,
    };
  });

  logger.info(
    { jobId, highlights: highlights.length },
    "HighlightDetector: highlights selected"
  );

  const result: HighlightDetectionResult = {
    jobId,
    videoId,
    totalWindowsAnalysed: windowScores.length,
    highlights,
    windowScores,
    videoDurationSecs,
    completedAt: nowIso(),
  };

  return result;
}

// ---------------------------------------------------------------------------
// Async job queue API
// ---------------------------------------------------------------------------

/** Submit a highlight detection job.  Processing is async. */
export function submitHighlightDetectionJob(
  params: HighlightDetectionParams
): HighlightDetectionJob {
  const jobId = shortId();
  const now = nowIso();

  const job: HighlightDetectionJob = {
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

  highlightJobs.set(jobId, job);
  logger.info({ jobId, videoId: params.videoId }, "HighlightDetector: job queued");

  processHighlightJob(jobId).catch((err) => {
    logger.error({ jobId, err }, "HighlightDetector: unhandled job error");
  });

  return job;
}

/** Retrieve a job by ID. */
export function getHighlightDetectionJob(jobId: string): HighlightDetectionJob | undefined {
  return highlightJobs.get(jobId);
}

/** List all jobs for a given video. */
export function listHighlightDetectionJobs(videoId?: string): HighlightDetectionJob[] {
  const all = Array.from(highlightJobs.values());
  return videoId ? all.filter((j) => j.videoId === videoId) : all;
}

async function processHighlightJob(jobId: string): Promise<void> {
  const job = highlightJobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.updatedAt = nowIso();

  try {
    const result = await runHighlightDetection(job.params);
    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();
    highlightDetectorEvents.emit("completed", job);
    logger.info(
      { jobId, highlights: result.highlights.length },
      "HighlightDetector: job completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();
    highlightDetectorEvents.emit("failed", job);
    logger.error({ jobId, err: msg }, "HighlightDetector: job failed");
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the in-memory job store (used in tests). */
export function _resetHighlightDetectionJobs(): void {
  highlightJobs.clear();
}
