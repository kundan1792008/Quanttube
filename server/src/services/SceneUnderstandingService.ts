import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface HistogramTriple {
  red: number[];
  green: number[];
  blue: number[];
}

export interface FrameSignalInput {
  timestampMs: number;
  histogram: HistogramTriple;
  motionEnergy: number;
  audioRms: number;
  speechConfidence: number;
  sentimentShift: number;
  faceSaliency: number;
  textDensity: number;
  edgeDensity: number;
  sharpness: number;
  brightness: number;
  contrast: number;
  ruleOfThirdsAlignment: number;
  objectCount: number;
}

export interface SceneBoundary {
  id: string;
  type: "hard-cut" | "soft-transition";
  timestampMs: number;
  confidence: number;
  histogramDelta: number;
  zScore: number;
}

export interface SceneSegment {
  id: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  confidence: number;
  averageMotion: number;
  averageAudioEnergy: number;
  averageSentimentShift: number;
  averageSpeechConfidence: number;
  dominantColor: "warm" | "cool" | "neutral";
  keyMoments: number[];
}

export interface HighlightMoment {
  id: string;
  timestampMs: number;
  score: number;
  confidence: number;
  reasons: string[];
  localSignals: {
    motionZ: number;
    audioZ: number;
    speechZ: number;
    sentimentZ: number;
    novelty: number;
  };
}

export interface ThumbnailCandidate {
  id: string;
  timestampMs: number;
  source: "highlight" | "scene-midpoint" | "scene-entry";
  compositionScore: number;
  qualityScore: number;
  contextScore: number;
  finalScore: number;
  tags: string[];
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ChapterSegment {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  confidence: number;
  sceneCount: number;
  highlightCount: number;
  summary: string;
  thumbnailCandidateId: string | null;
}

export interface SceneUnderstandingReport {
  reportId: string;
  videoId: string;
  generatedAt: string;
  durationMs: number;
  analysisVersion: string;
  boundaries: SceneBoundary[];
  scenes: SceneSegment[];
  highlights: HighlightMoment[];
  thumbnails: ThumbnailCandidate[];
  chapters: ChapterSegment[];
  metrics: {
    frameCount: number;
    histogramBinCount: number;
    averageCutConfidence: number;
    averageHighlightScore: number;
    chapterCoverage: number;
  };
}

export interface SceneUnderstandingConfig {
  histogramCutSensitivity: number;
  minSceneDurationMs: number;
  softTransitionWindow: number;
  highlightWindowFrames: number;
  highlightTopPercentile: number;
  maxHighlights: number;
  maxThumbnails: number;
  targetChapterDurationMs: number;
  maxChapters: number;
}

export const DEFAULT_SCENE_UNDERSTANDING_CONFIG: SceneUnderstandingConfig = {
  histogramCutSensitivity: 1.9,
  minSceneDurationMs: 1500,
  softTransitionWindow: 3,
  highlightWindowFrames: 4,
  highlightTopPercentile: 0.86,
  maxHighlights: 28,
  maxThumbnails: 18,
  targetChapterDurationMs: 90_000,
  maxChapters: 14,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildSceneUnderstandingReport(params: {
  videoId: string;
  durationMs: number;
  frameSignals: FrameSignalInput[];
  config?: Partial<SceneUnderstandingConfig>;
}): SceneUnderstandingReport {
  const { videoId, durationMs } = params;
  const frameSignals = sanitizeFrameSignals(params.frameSignals, durationMs);
  const config: SceneUnderstandingConfig = {
    ...DEFAULT_SCENE_UNDERSTANDING_CONFIG,
    ...params.config,
  };

  const boundaries = detectSceneBoundaries(frameSignals, config);
  const scenes = buildSceneSegments(frameSignals, boundaries, durationMs, config);
  const highlights = detectHighlightMoments(frameSignals, boundaries, scenes, config);
  const thumbnails = rankThumbnailCandidates(frameSignals, scenes, highlights, config);
  const chapters = generateChapters(scenes, highlights, thumbnails, durationMs, config);

  const averageCutConfidence =
    boundaries.length > 0
      ? boundaries.reduce((sum, boundary) => sum + boundary.confidence, 0) / boundaries.length
      : 0;

  const averageHighlightScore =
    highlights.length > 0
      ? highlights.reduce((sum, highlight) => sum + highlight.score, 0) / highlights.length
      : 0;

  const chapterCoverage =
    chapters.length > 0
      ? clamp(
          chapters.reduce((sum, chapter) => sum + chapter.durationMs, 0) / Math.max(durationMs, 1),
          0,
          1
        )
      : 0;

  return {
    reportId: randomUUID(),
    videoId,
    generatedAt: new Date().toISOString(),
    durationMs,
    analysisVersion: "scene-understanding-v1",
    boundaries,
    scenes,
    highlights,
    thumbnails,
    chapters,
    metrics: {
      frameCount: frameSignals.length,
      histogramBinCount: frameSignals[0]?.histogram.red.length ?? 0,
      averageCutConfidence: roundTo(averageCutConfidence, 4),
      averageHighlightScore: roundTo(averageHighlightScore, 4),
      chapterCoverage: roundTo(chapterCoverage, 4),
    },
  };
}

export function detectSceneBoundaries(
  frameSignals: FrameSignalInput[],
  config: SceneUnderstandingConfig
): SceneBoundary[] {
  if (frameSignals.length < 2) {
    return [];
  }

  const histogramDistances: number[] = [];
  for (let i = 1; i < frameSignals.length; i += 1) {
    histogramDistances.push(histogramDistance(frameSignals[i - 1].histogram, frameSignals[i].histogram));
  }

  const distanceStats = meanAndStd(histogramDistances);
  const candidateCuts: SceneBoundary[] = [];

  for (let i = 1; i < frameSignals.length; i += 1) {
    const currentDistance = histogramDistances[i - 1];
    const zScore = distanceStats.std > 0 ? (currentDistance - distanceStats.mean) / distanceStats.std : 0;

    const localWindow = collectLocalWindow(histogramDistances, i - 1, config.softTransitionWindow);
    const localMean = mean(localWindow);
    const localStd = std(localWindow, localMean) || 1;
    const localZ = (currentDistance - localMean) / localStd;

    const adaptiveThreshold =
      distanceStats.mean + config.histogramCutSensitivity * Math.max(distanceStats.std, localStd * 0.75);

    if (currentDistance < adaptiveThreshold) {
      continue;
    }

    const prevTimestamp = frameSignals[i - 1].timestampMs;
    const currentTimestamp = frameSignals[i].timestampMs;
    const interval = currentTimestamp - prevTimestamp;

    const transitionType: SceneBoundary["type"] =
      localZ > config.histogramCutSensitivity * 1.4 || interval <= config.minSceneDurationMs * 0.2
        ? "hard-cut"
        : "soft-transition";

    const confidence = clamp(
      sigmoid(zScore * 0.75) * 0.65 +
        sigmoid(localZ * 0.55) * 0.25 +
        normalize(currentDistance, distanceStats.min, distanceStats.max) * 0.1,
      0,
      1
    );

    candidateCuts.push({
      id: randomUUID(),
      type: transitionType,
      timestampMs: frameSignals[i].timestampMs,
      confidence: roundTo(confidence, 4),
      histogramDelta: roundTo(currentDistance, 6),
      zScore: roundTo(zScore, 4),
    });
  }

  if (candidateCuts.length === 0) {
    return [];
  }

  return suppressNearbyBoundaries(candidateCuts, config.minSceneDurationMs);
}

export function buildSceneSegments(
  frameSignals: FrameSignalInput[],
  boundaries: SceneBoundary[],
  durationMs: number,
  config: SceneUnderstandingConfig
): SceneSegment[] {
  if (frameSignals.length === 0 || durationMs <= 0) {
    return [];
  }

  const sortedCuts = [...boundaries].sort((a, b) => a.timestampMs - b.timestampMs);
  const breakpoints = [0, ...sortedCuts.map((b) => clamp(b.timestampMs, 0, durationMs)), durationMs];

  const scenes: SceneSegment[] = [];

  for (let i = 0; i < breakpoints.length - 1; i += 1) {
    const startMs = breakpoints[i];
    const endMs = breakpoints[i + 1];

    if (endMs - startMs < config.minSceneDurationMs * 0.45) {
      continue;
    }

    const sceneFrames = frameSignals.filter((frame) => frame.timestampMs >= startMs && frame.timestampMs <= endMs);

    if (sceneFrames.length === 0) {
      continue;
    }

    const averageMotion = mean(sceneFrames.map((frame) => frame.motionEnergy));
    const averageAudioEnergy = mean(sceneFrames.map((frame) => frame.audioRms));
    const averageSentimentShift = mean(sceneFrames.map((frame) => Math.abs(frame.sentimentShift)));
    const averageSpeechConfidence = mean(sceneFrames.map((frame) => frame.speechConfidence));

    const edgeMean = mean(sceneFrames.map((frame) => frame.edgeDensity));
    const brightnessMean = mean(sceneFrames.map((frame) => frame.brightness));
    const colorWarmth = estimateColorWarmth(sceneFrames);

    const dominantColor: SceneSegment["dominantColor"] =
      colorWarmth > 0.58 ? "warm" : colorWarmth < 0.42 ? "cool" : "neutral";

    const confidence = clamp(
      sigmoid((edgeMean - 0.45) * 2.6) * 0.25 +
        sigmoid((averageSpeechConfidence - 0.3) * 2.2) * 0.2 +
        sigmoid((averageAudioEnergy - 0.2) * 3.1) * 0.2 +
        sigmoid((averageMotion - 0.2) * 3.1) * 0.2 +
        sigmoid((brightnessMean - 0.1) * 1.4) * 0.15,
      0,
      1
    );

    const keyMoments = pickSceneKeyMoments(sceneFrames, startMs, endMs);

    scenes.push({
      id: randomUUID(),
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      confidence: roundTo(confidence, 4),
      averageMotion: roundTo(averageMotion, 4),
      averageAudioEnergy: roundTo(averageAudioEnergy, 4),
      averageSentimentShift: roundTo(averageSentimentShift, 4),
      averageSpeechConfidence: roundTo(averageSpeechConfidence, 4),
      dominantColor,
      keyMoments,
    });
  }

  if (scenes.length === 0) {
    return [
      {
        id: randomUUID(),
        startMs: 0,
        endMs: durationMs,
        durationMs,
        confidence: 0.5,
        averageMotion: 0,
        averageAudioEnergy: 0,
        averageSentimentShift: 0,
        averageSpeechConfidence: 0,
        dominantColor: "neutral",
        keyMoments: [Math.floor(durationMs * 0.5)],
      },
    ];
  }

  return mergeTinyScenes(scenes, config.minSceneDurationMs);
}

export function detectHighlightMoments(
  frameSignals: FrameSignalInput[],
  boundaries: SceneBoundary[],
  scenes: SceneSegment[],
  config: SceneUnderstandingConfig
): HighlightMoment[] {
  if (frameSignals.length === 0) {
    return [];
  }

  const motionStats = meanAndStd(frameSignals.map((f) => f.motionEnergy));
  const audioStats = meanAndStd(frameSignals.map((f) => f.audioRms));
  const speechStats = meanAndStd(frameSignals.map((f) => f.speechConfidence));
  const sentimentStats = meanAndStd(frameSignals.map((f) => Math.abs(f.sentimentShift)));

  const boundaryTimes = boundaries.map((b) => b.timestampMs);
  const highlightScores = frameSignals.map((frame) => {
    const motionZ = zscore(frame.motionEnergy, motionStats.mean, motionStats.std);
    const audioZ = zscore(frame.audioRms, audioStats.mean, audioStats.std);
    const speechZ = zscore(frame.speechConfidence, speechStats.mean, speechStats.std);
    const sentimentZ = zscore(Math.abs(frame.sentimentShift), sentimentStats.mean, sentimentStats.std);

    const novelty = computeNoveltyScore(frame.timestampMs, boundaryTimes);
    const compositionBonus =
      frame.ruleOfThirdsAlignment * 0.04 +
      frame.edgeDensity * 0.03 +
      frame.sharpness * 0.03 +
      frame.faceSaliency * 0.02;

    const weightedSignal =
      motionZ * 0.3 +
      audioZ * 0.22 +
      speechZ * 0.13 +
      sentimentZ * 0.2 +
      novelty * 0.18 +
      frame.textDensity * 0.06 +
      compositionBonus;

    return {
      frame,
      score: weightedSignal,
      localSignals: { motionZ, audioZ, speechZ, sentimentZ, novelty },
    };
  });

  const scoreStats = meanAndStd(highlightScores.map((entry) => entry.score));
  const threshold = percentile(highlightScores.map((entry) => entry.score), config.highlightTopPercentile);

  const rawHighlights: HighlightMoment[] = [];

  for (let i = 0; i < highlightScores.length; i += 1) {
    const current = highlightScores[i];
    if (current.score < threshold) {
      continue;
    }

    if (!isLocalMaximum(highlightScores.map((entry) => entry.score), i, config.highlightWindowFrames)) {
      continue;
    }

    const scoreZ = zscore(current.score, scoreStats.mean, scoreStats.std);
    const confidence = clamp(sigmoid(scoreZ * 0.85), 0, 1);

    const reasons = buildHighlightReasons(current.localSignals, current.frame);

    rawHighlights.push({
      id: randomUUID(),
      timestampMs: current.frame.timestampMs,
      score: roundTo(current.score, 4),
      confidence: roundTo(confidence, 4),
      reasons,
      localSignals: {
        motionZ: roundTo(current.localSignals.motionZ, 4),
        audioZ: roundTo(current.localSignals.audioZ, 4),
        speechZ: roundTo(current.localSignals.speechZ, 4),
        sentimentZ: roundTo(current.localSignals.sentimentZ, 4),
        novelty: roundTo(current.localSignals.novelty, 4),
      },
    });
  }

  const deduped = suppressNearbyHighlights(rawHighlights, 2_500);
  const sceneAware = rebalanceHighlightsByScene(deduped, scenes);

  return sceneAware
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxHighlights)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function rankThumbnailCandidates(
  frameSignals: FrameSignalInput[],
  scenes: SceneSegment[],
  highlights: HighlightMoment[],
  config: SceneUnderstandingConfig
): ThumbnailCandidate[] {
  if (frameSignals.length === 0) {
    return [];
  }

  const frameByTimestamp = buildNearestFrameLookup(frameSignals);
  const candidateTimestamps = new Map<number, ThumbnailCandidate["source"]>();

  for (const highlight of highlights) {
    candidateTimestamps.set(highlight.timestampMs, "highlight");
  }

  for (const scene of scenes) {
    const midpoint = Math.floor((scene.startMs + scene.endMs) / 2);
    const entry = Math.min(scene.startMs + Math.floor(scene.durationMs * 0.12), scene.endMs);
    if (!candidateTimestamps.has(midpoint)) candidateTimestamps.set(midpoint, "scene-midpoint");
    if (!candidateTimestamps.has(entry)) candidateTimestamps.set(entry, "scene-entry");
  }

  const candidates: ThumbnailCandidate[] = [];

  for (const [timestampMs, source] of candidateTimestamps.entries()) {
    const frame = frameByTimestamp(timestampMs);
    if (!frame) continue;

    const compositionScore = computeCompositionScore(frame);
    const qualityScore = computeImageQualityScore(frame);
    const contextScore = computeNarrativeContextScore(frame, highlights, scenes, timestampMs);

    const sourceBias = source === "highlight" ? 0.09 : source === "scene-entry" ? 0.03 : 0.05;
    const finalScore = clamp(
      compositionScore * 0.46 + qualityScore * 0.33 + contextScore * 0.21 + sourceBias,
      0,
      1
    );

    candidates.push({
      id: randomUUID(),
      timestampMs: frame.timestampMs,
      source,
      compositionScore: roundTo(compositionScore, 4),
      qualityScore: roundTo(qualityScore, 4),
      contextScore: roundTo(contextScore, 4),
      finalScore: roundTo(finalScore, 4),
      tags: buildThumbnailTags(frame, contextScore, compositionScore),
      crop: computeCropHint(frame),
    });
  }

  return applyThumbnailDiversity(candidates)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, config.maxThumbnails)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function generateChapters(
  scenes: SceneSegment[],
  highlights: HighlightMoment[],
  thumbnails: ThumbnailCandidate[],
  durationMs: number,
  config: SceneUnderstandingConfig
): ChapterSegment[] {
  if (durationMs <= 0) {
    return [];
  }

  if (scenes.length === 0) {
    return [
      {
        id: randomUUID(),
        title: "Chapter 1 · Opening",
        startMs: 0,
        endMs: durationMs,
        durationMs,
        confidence: 0.5,
        sceneCount: 0,
        highlightCount: highlights.length,
        summary: "Baseline chapter generated from full-duration fallback.",
        thumbnailCandidateId: thumbnails[0]?.id ?? null,
      },
    ];
  }

  const targetDuration = Math.max(20_000, config.targetChapterDurationMs);
  const chapterDrafts: Array<{ startMs: number; endMs: number; scenes: SceneSegment[] }> = [];

  let currentStart = scenes[0].startMs;
  let currentScenes: SceneSegment[] = [];

  for (const scene of scenes) {
    currentScenes.push(scene);
    const draftDuration = scene.endMs - currentStart;
    const enoughScenes = currentScenes.length >= 2;
    const enoughDuration = draftDuration >= targetDuration;

    if ((enoughScenes && enoughDuration) || draftDuration >= targetDuration * 1.5) {
      chapterDrafts.push({
        startMs: currentStart,
        endMs: scene.endMs,
        scenes: [...currentScenes],
      });
      currentStart = scene.endMs;
      currentScenes = [];
    }
  }

  if (currentScenes.length > 0) {
    chapterDrafts.push({
      startMs: currentStart,
      endMs: currentScenes[currentScenes.length - 1].endMs,
      scenes: [...currentScenes],
    });
  }

  const mergedDrafts = mergeSmallChapters(chapterDrafts, targetDuration * 0.45, config.maxChapters);

  return mergedDrafts.map((draft, index) => {
    const chapterHighlights = highlights.filter(
      (highlight) => highlight.timestampMs >= draft.startMs && highlight.timestampMs < draft.endMs
    );

    const chapterThumb = pickChapterThumbnail(thumbnails, draft.startMs, draft.endMs);

    const confidence = clamp(
      mean(draft.scenes.map((scene) => scene.confidence)) * 0.55 +
        clamp(chapterHighlights.length / 6, 0, 1) * 0.22 +
        (chapterThumb?.finalScore ?? 0.45) * 0.23,
      0,
      1
    );

    const title = buildChapterTitle(index, draft.scenes, chapterHighlights);
    const summary = buildChapterSummary(draft, chapterHighlights);

    return {
      id: randomUUID(),
      title,
      startMs: draft.startMs,
      endMs: draft.endMs,
      durationMs: Math.max(0, draft.endMs - draft.startMs),
      confidence: roundTo(confidence, 4),
      sceneCount: draft.scenes.length,
      highlightCount: chapterHighlights.length,
      summary,
      thumbnailCandidateId: chapterThumb?.id ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Pipeline utilities
// ---------------------------------------------------------------------------

function sanitizeFrameSignals(frameSignals: FrameSignalInput[], durationMs: number): FrameSignalInput[] {
  const sanitized = frameSignals
    .filter((signal) => Number.isFinite(signal.timestampMs))
    .map((signal) => ({
      ...signal,
      timestampMs: clamp(Math.floor(signal.timestampMs), 0, Math.max(0, durationMs)),
      motionEnergy: clamp(signal.motionEnergy, 0, 1),
      audioRms: clamp(signal.audioRms, 0, 1),
      speechConfidence: clamp(signal.speechConfidence, 0, 1),
      sentimentShift: clamp(signal.sentimentShift, -1, 1),
      faceSaliency: clamp(signal.faceSaliency, 0, 1),
      textDensity: clamp(signal.textDensity, 0, 1),
      edgeDensity: clamp(signal.edgeDensity, 0, 1),
      sharpness: clamp(signal.sharpness, 0, 1),
      brightness: clamp(signal.brightness, 0, 1),
      contrast: clamp(signal.contrast, 0, 1),
      ruleOfThirdsAlignment: clamp(signal.ruleOfThirdsAlignment, 0, 1),
      objectCount: clamp(signal.objectCount, 0, 20),
      histogram: normalizeHistogramTriple(signal.histogram),
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const deduped: FrameSignalInput[] = [];
  for (const signal of sanitized) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.timestampMs === signal.timestampMs) {
      deduped[deduped.length - 1] = signal;
      continue;
    }
    deduped.push(signal);
  }

  return deduped;
}

function normalizeHistogramTriple(histogram: HistogramTriple): HistogramTriple {
  return {
    red: normalizeVector(histogram.red),
    green: normalizeVector(histogram.green),
    blue: normalizeVector(histogram.blue),
  };
}

function normalizeVector(input: number[]): number[] {
  const cleaned = input.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = cleaned.reduce((sum, value) => sum + value, 0);
  if (total <= Number.EPSILON) {
    return cleaned.length > 0 ? cleaned.map(() => 1 / cleaned.length) : [];
  }
  return cleaned.map((value) => value / total);
}

function histogramDistance(a: HistogramTriple, b: HistogramTriple): number {
  return (
    bhattacharyyaDistance(a.red, b.red) * 0.34 +
    bhattacharyyaDistance(a.green, b.green) * 0.33 +
    bhattacharyyaDistance(a.blue, b.blue) * 0.33
  );
}

function bhattacharyyaDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let coefficient = 0;
  for (let i = 0; i < length; i += 1) {
    coefficient += Math.sqrt(Math.max(0, a[i] ?? 0) * Math.max(0, b[i] ?? 0));
  }

  return clamp(Math.sqrt(Math.max(0, 1 - coefficient)), 0, 1);
}

function suppressNearbyBoundaries(boundaries: SceneBoundary[], minDistanceMs: number): SceneBoundary[] {
  const sorted = [...boundaries].sort((a, b) => a.timestampMs - b.timestampMs);
  const selected: SceneBoundary[] = [];

  for (const boundary of sorted) {
    const previous = selected[selected.length - 1];
    if (!previous) {
      selected.push(boundary);
      continue;
    }

    const distance = boundary.timestampMs - previous.timestampMs;
    if (distance >= minDistanceMs) {
      selected.push(boundary);
      continue;
    }

    if (boundary.confidence > previous.confidence) {
      selected[selected.length - 1] = boundary;
    }
  }

  return selected;
}

function pickSceneKeyMoments(sceneFrames: FrameSignalInput[], startMs: number, endMs: number): number[] {
  if (sceneFrames.length === 0) {
    return [];
  }

  const weighted = sceneFrames
    .map((frame) => ({
      timestampMs: frame.timestampMs,
      score:
        frame.motionEnergy * 0.24 +
        frame.audioRms * 0.23 +
        Math.abs(frame.sentimentShift) * 0.2 +
        frame.faceSaliency * 0.1 +
        frame.ruleOfThirdsAlignment * 0.11 +
        frame.textDensity * 0.06 +
        frame.edgeDensity * 0.06,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (weighted.length === 0) {
    return [Math.floor((startMs + endMs) / 2)];
  }

  return weighted.map((frame) => frame.timestampMs);
}

function mergeTinyScenes(scenes: SceneSegment[], minSceneDurationMs: number): SceneSegment[] {
  if (scenes.length <= 1) {
    return scenes;
  }

  const merged: SceneSegment[] = [];
  for (const scene of scenes) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(scene);
      continue;
    }

    if (scene.durationMs >= minSceneDurationMs * 0.55) {
      merged.push(scene);
      continue;
    }

    const combinedDuration = previous.durationMs + scene.durationMs;
    previous.endMs = scene.endMs;
    previous.durationMs = combinedDuration;
    previous.confidence = roundTo((previous.confidence + scene.confidence) / 2, 4);
    previous.averageMotion = roundTo(weightedAverage(previous.averageMotion, scene.averageMotion, previous.durationMs, scene.durationMs), 4);
    previous.averageAudioEnergy = roundTo(weightedAverage(previous.averageAudioEnergy, scene.averageAudioEnergy, previous.durationMs, scene.durationMs), 4);
    previous.averageSentimentShift = roundTo(weightedAverage(previous.averageSentimentShift, scene.averageSentimentShift, previous.durationMs, scene.durationMs), 4);
    previous.averageSpeechConfidence = roundTo(weightedAverage(previous.averageSpeechConfidence, scene.averageSpeechConfidence, previous.durationMs, scene.durationMs), 4);

    previous.keyMoments = [...previous.keyMoments, ...scene.keyMoments]
      .sort((a, b) => a - b)
      .filter((moment, index, arr) => index === 0 || moment - arr[index - 1] > 800)
      .slice(0, 5);
  }

  return merged;
}

function computeNoveltyScore(timestampMs: number, boundaryTimes: number[]): number {
  if (boundaryTimes.length === 0) {
    return 0.2;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  for (const boundaryTime of boundaryTimes) {
    minDistance = Math.min(minDistance, Math.abs(boundaryTime - timestampMs));
  }

  const closeness = Math.exp(-minDistance / 4_500);
  return clamp(closeness, 0, 1);
}

function buildHighlightReasons(
  localSignals: { motionZ: number; audioZ: number; speechZ: number; sentimentZ: number; novelty: number },
  frame: FrameSignalInput
): string[] {
  const reasons: string[] = [];

  if (localSignals.motionZ > 1.1) reasons.push("motion-spike");
  if (localSignals.audioZ > 1.0) reasons.push("audio-spike");
  if (localSignals.speechZ > 0.9 && frame.speechConfidence > 0.55) reasons.push("speech-emphasis");
  if (localSignals.sentimentZ > 1.0) reasons.push("sentiment-shift");
  if (localSignals.novelty > 0.62) reasons.push("scene-novelty");
  if (frame.faceSaliency > 0.6) reasons.push("face-saliency");
  if (frame.textDensity > 0.5) reasons.push("text-overlay");

  if (reasons.length === 0) {
    reasons.push("multi-signal-composite");
  }

  return reasons;
}

function suppressNearbyHighlights(highlights: HighlightMoment[], minDistanceMs: number): HighlightMoment[] {
  const sorted = [...highlights].sort((a, b) => b.score - a.score);
  const selected: HighlightMoment[] = [];

  for (const highlight of sorted) {
    const conflict = selected.some(
      (existing) => Math.abs(existing.timestampMs - highlight.timestampMs) < minDistanceMs
    );

    if (!conflict) {
      selected.push(highlight);
    }
  }

  return selected.sort((a, b) => a.timestampMs - b.timestampMs);
}

function rebalanceHighlightsByScene(highlights: HighlightMoment[], scenes: SceneSegment[]): HighlightMoment[] {
  if (highlights.length === 0 || scenes.length === 0) {
    return highlights;
  }

  const byScene = new Map<string, HighlightMoment[]>();
  for (const highlight of highlights) {
    const scene = scenes.find(
      (candidate) => highlight.timestampMs >= candidate.startMs && highlight.timestampMs < candidate.endMs
    );
    const key = scene?.id ?? "unassigned";
    const list = byScene.get(key) ?? [];
    list.push(highlight);
    byScene.set(key, list);
  }

  const rebalanced: HighlightMoment[] = [];
  for (const [sceneId, sceneHighlights] of byScene.entries()) {
    if (sceneId === "unassigned") {
      rebalanced.push(...sceneHighlights);
      continue;
    }

    const scene = scenes.find((candidate) => candidate.id === sceneId);
    const limit = Math.max(1, Math.min(4, Math.floor((scene?.durationMs ?? 15_000) / 30_000) + 1));

    rebalanced.push(...sceneHighlights.sort((a, b) => b.score - a.score).slice(0, limit));
  }

  return rebalanced.sort((a, b) => a.timestampMs - b.timestampMs);
}

function buildNearestFrameLookup(frameSignals: FrameSignalInput[]): (timestampMs: number) => FrameSignalInput | null {
  const sorted = [...frameSignals].sort((a, b) => a.timestampMs - b.timestampMs);

  return (timestampMs: number) => {
    if (sorted.length === 0) {
      return null;
    }

    let left = 0;
    let right = sorted.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const value = sorted[mid].timestampMs;
      if (value === timestampMs) {
        return sorted[mid];
      }
      if (value < timestampMs) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    const candidates = [sorted[Math.max(0, right)], sorted[Math.min(sorted.length - 1, left)]].filter(
      (candidate): candidate is FrameSignalInput => candidate !== undefined
    );

    if (candidates.length === 0) {
      return null;
    }

    return candidates.reduce((best, candidate) =>
      Math.abs(candidate.timestampMs - timestampMs) < Math.abs(best.timestampMs - timestampMs)
        ? candidate
        : best
    );
  };
}

function computeCompositionScore(frame: FrameSignalInput): number {
  const thirds = frame.ruleOfThirdsAlignment;
  const face = frame.faceSaliency;
  const edge = frame.edgeDensity;
  const contrast = frame.contrast;
  const brightnessTarget = 1 - Math.abs(frame.brightness - 0.56) * 1.8;
  const objectBalance = 1 - Math.abs(frame.objectCount - 4.5) / 10;

  const score =
    thirds * 0.28 +
    face * 0.18 +
    edge * 0.14 +
    contrast * 0.16 +
    clamp(brightnessTarget, 0, 1) * 0.12 +
    clamp(objectBalance, 0, 1) * 0.12;

  return clamp(score, 0, 1);
}

function computeImageQualityScore(frame: FrameSignalInput): number {
  const sharpness = frame.sharpness;
  const contrast = frame.contrast;
  const textPenalty = frame.textDensity > 0.65 ? (frame.textDensity - 0.65) * 0.45 : 0;
  const exposurePenalty = Math.abs(frame.brightness - 0.52) * 0.25;
  const noisePenalty = frame.edgeDensity > 0.88 ? (frame.edgeDensity - 0.88) * 0.35 : 0;

  return clamp(sharpness * 0.48 + contrast * 0.37 + (1 - exposurePenalty - noisePenalty - textPenalty) * 0.15, 0, 1);
}

function computeNarrativeContextScore(
  frame: FrameSignalInput,
  highlights: HighlightMoment[],
  scenes: SceneSegment[],
  timestampMs: number
): number {
  const nearestHighlightDistance = highlights.reduce((best, highlight) => {
    return Math.min(best, Math.abs(highlight.timestampMs - timestampMs));
  }, Number.POSITIVE_INFINITY);

  const highlightProximity = Number.isFinite(nearestHighlightDistance)
    ? clamp(Math.exp(-nearestHighlightDistance / 8_000), 0, 1)
    : 0.1;

  const scene = scenes.find((candidate) => timestampMs >= candidate.startMs && timestampMs < candidate.endMs);
  const sceneConfidence = scene?.confidence ?? 0.45;
  const keyMomentBoost = scene?.keyMoments.some((moment) => Math.abs(moment - timestampMs) < 1_200) ? 0.16 : 0;
  const speechBoost = frame.speechConfidence > 0.56 ? 0.08 : 0;

  return clamp(highlightProximity * 0.42 + sceneConfidence * 0.44 + keyMomentBoost + speechBoost, 0, 1);
}

function buildThumbnailTags(
  frame: FrameSignalInput,
  contextScore: number,
  compositionScore: number
): string[] {
  const tags: string[] = [];

  if (frame.faceSaliency > 0.62) tags.push("faces");
  if (frame.motionEnergy > 0.65) tags.push("action");
  if (frame.speechConfidence > 0.6) tags.push("dialogue");
  if (Math.abs(frame.sentimentShift) > 0.65) tags.push("emotion");
  if (frame.textDensity > 0.58) tags.push("caption");
  if (contextScore > 0.72) tags.push("high-context");
  if (compositionScore > 0.74) tags.push("strong-composition");

  if (tags.length === 0) {
    tags.push("balanced");
  }

  return tags;
}

function computeCropHint(frame: FrameSignalInput): { x: number; y: number; width: number; height: number } {
  const centerX = clamp(0.5 + (frame.sentimentShift * 0.08 + frame.faceSaliency * 0.04 - frame.textDensity * 0.03), 0.2, 0.8);
  const centerY = clamp(0.5 - (frame.faceSaliency * 0.08) + frame.textDensity * 0.06, 0.2, 0.8);
  const width = clamp(0.62 - frame.textDensity * 0.2 + frame.faceSaliency * 0.08, 0.42, 0.78);
  const height = clamp(0.62 - frame.textDensity * 0.18 + frame.motionEnergy * 0.07, 0.42, 0.8);

  return {
    x: roundTo(clamp(centerX - width / 2, 0, 1 - width), 4),
    y: roundTo(clamp(centerY - height / 2, 0, 1 - height), 4),
    width: roundTo(width, 4),
    height: roundTo(height, 4),
  };
}

function applyThumbnailDiversity(candidates: ThumbnailCandidate[]): ThumbnailCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
  const selected: ThumbnailCandidate[] = [];

  for (const candidate of sorted) {
    const conflict = selected.some(
      (existing) => Math.abs(existing.timestampMs - candidate.timestampMs) < 4_500
    );

    if (!conflict) {
      selected.push(candidate);
      continue;
    }

    const adjust = { ...candidate, finalScore: roundTo(candidate.finalScore * 0.96, 4) };
    const stillWorthIt = adjust.finalScore >= 0.48;
    if (stillWorthIt) {
      selected.push(adjust);
    }
  }

  return selected;
}

function mergeSmallChapters(
  drafts: Array<{ startMs: number; endMs: number; scenes: SceneSegment[] }>,
  minDurationMs: number,
  maxChapters: number
): Array<{ startMs: number; endMs: number; scenes: SceneSegment[] }> {
  if (drafts.length <= 1) {
    return drafts;
  }

  const merged = [...drafts];

  for (let i = 0; i < merged.length && merged.length > 1; i += 1) {
    const draft = merged[i];
    const duration = draft.endMs - draft.startMs;

    if (duration >= minDurationMs) {
      continue;
    }

    if (i === 0) {
      const next = merged[i + 1];
      next.startMs = draft.startMs;
      next.scenes = [...draft.scenes, ...next.scenes];
      merged.splice(i, 1);
      i -= 1;
      continue;
    }

    const previous = merged[i - 1];
    previous.endMs = draft.endMs;
    previous.scenes = [...previous.scenes, ...draft.scenes];
    merged.splice(i, 1);
    i -= 1;
  }

  while (merged.length > maxChapters && merged.length > 1) {
    const last = merged.pop();
    if (!last) {
      break;
    }
    const prev = merged[merged.length - 1];
    prev.endMs = last.endMs;
    prev.scenes = [...prev.scenes, ...last.scenes];
  }

  return merged;
}

function pickChapterThumbnail(
  thumbnails: ThumbnailCandidate[],
  startMs: number,
  endMs: number
): ThumbnailCandidate | null {
  const inRange = thumbnails.filter((thumbnail) => thumbnail.timestampMs >= startMs && thumbnail.timestampMs < endMs);

  if (inRange.length === 0) {
    return null;
  }

  return inRange.sort((a, b) => b.finalScore - a.finalScore)[0] ?? null;
}

function buildChapterTitle(index: number, scenes: SceneSegment[], highlights: HighlightMoment[]): string {
  const chapterNumber = index + 1;
  const warmScenes = scenes.filter((scene) => scene.dominantColor === "warm").length;
  const coolScenes = scenes.filter((scene) => scene.dominantColor === "cool").length;
  const speechHeavy = scenes.filter((scene) => scene.averageSpeechConfidence > 0.55).length;
  const highImpact = highlights.filter((highlight) => highlight.score > 1.2).length;

  if (highImpact >= 3) return `Chapter ${chapterNumber} · Climax Pulse`;
  if (speechHeavy >= Math.ceil(scenes.length * 0.6)) return `Chapter ${chapterNumber} · Dialogue Arc`;
  if (warmScenes > coolScenes + 1) return `Chapter ${chapterNumber} · Warm Momentum`;
  if (coolScenes > warmScenes + 1) return `Chapter ${chapterNumber} · Cool Tension`;
  return `Chapter ${chapterNumber} · Narrative Beat`;
}

function buildChapterSummary(
  draft: { startMs: number; endMs: number; scenes: SceneSegment[] },
  highlights: HighlightMoment[]
): string {
  const sceneDensity = draft.scenes.length;
  const highConfidenceScenes = draft.scenes.filter((scene) => scene.confidence > 0.66).length;
  const speechMoments = draft.scenes.filter((scene) => scene.averageSpeechConfidence > 0.5).length;
  const highlightIntensity = highlights.length > 0 ? mean(highlights.map((highlight) => highlight.score)) : 0;

  const descriptors: string[] = [];
  descriptors.push(`${sceneDensity} scenes`);
  descriptors.push(`${highlights.length} highlights`);

  if (highConfidenceScenes > 0) descriptors.push(`${highConfidenceScenes} high-confidence transitions`);
  if (speechMoments > 0) descriptors.push(`${speechMoments} dialogue-led segments`);
  if (highlightIntensity > 1.1) descriptors.push("elevated intensity profile");

  return descriptors.join(", ");
}

function estimateColorWarmth(sceneFrames: FrameSignalInput[]): number {
  const warm = sceneFrames.reduce((sum, frame) => {
    const redBias = mean(frame.histogram.red.slice(Math.floor(frame.histogram.red.length * 0.6)));
    const blueBias = mean(frame.histogram.blue.slice(Math.floor(frame.histogram.blue.length * 0.6)));
    return sum + (0.5 + (redBias - blueBias) * 1.8);
  }, 0);

  return clamp(warm / Math.max(1, sceneFrames.length), 0, 1);
}

function collectLocalWindow(values: number[], index: number, radius: number): number[] {
  const start = Math.max(0, index - radius);
  const end = Math.min(values.length - 1, index + radius);
  const window: number[] = [];

  for (let i = start; i <= end; i += 1) {
    window.push(values[i]);
  }

  return window;
}

function isLocalMaximum(values: number[], index: number, radius: number): boolean {
  const start = Math.max(0, index - radius);
  const end = Math.min(values.length - 1, index + radius);
  const current = values[index];

  for (let i = start; i <= end; i += 1) {
    if (i === index) continue;
    if (values[i] > current) {
      return false;
    }
  }

  return true;
}

function weightedAverage(a: number, b: number, weightA: number, weightB: number): number {
  const total = weightA + weightB;
  if (total <= 0) return (a + b) / 2;
  return (a * weightA + b * weightB) / total;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q = clamp(quantile, 0, 1);
  const index = Math.floor((sorted.length - 1) * q);
  return sorted[index];
}

function zscore(value: number, meanValue: number, stdValue: number): number {
  if (!Number.isFinite(stdValue) || stdValue <= Number.EPSILON) {
    return 0;
  }
  return (value - meanValue) / stdValue;
}

function meanAndStd(values: number[]): { mean: number; std: number; min: number; max: number } {
  if (values.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0 };
  }

  const avg = mean(values);
  const deviation = std(values, avg);
  const min = values.reduce((acc, value) => Math.min(acc, value), Number.POSITIVE_INFINITY);
  const max = values.reduce((acc, value) => Math.max(acc, value), Number.NEGATIVE_INFINITY);

  return { mean: avg, std: deviation, min, max };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[], meanValue: number): number {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - meanValue) * (value - meanValue), 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

function normalize(value: number, minValue: number, maxValue: number): number {
  const range = maxValue - minValue;
  if (!Number.isFinite(range) || range <= Number.EPSILON) {
    return 0;
  }
  return clamp((value - minValue) / range, 0, 1);
}

function clamp(value: number, minValue: number, maxValue: number): number {
  if (Number.isNaN(value)) return minValue;
  return Math.min(maxValue, Math.max(minValue, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
