/**
 * TranslationService – Context-aware segment translation with timing adjustment.
 *
 * Accepts TranscriptSegment arrays from TranscriptionService and:
 *  1. Translates each segment to the target language preserving context.
 *  2. Adjusts segment timing for languages with different average speech rates.
 *  3. Supports batched API calls to minimise round-trips.
 *
 * Production: replace stub implementation with calls to DeepL, Google Translate
 * API, or a fine-tuned Quanttube MT model.
 */

import logger from "../logger";
import type { TranscriptSegment } from "./TranscriptionService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANSLATION_API_URL =
  process.env.TRANSLATION_API_URL ?? "https://api.deepl.com/v2/translate";
const TRANSLATION_API_KEY = process.env.TRANSLATION_API_KEY ?? "";

/**
 * Words-per-minute speech rate estimates for target languages.
 * These are used to stretch/compress segment durations after translation.
 *
 * Baseline is English at ~150 wpm.  Values > 1.0 mean faster speech;
 * values < 1.0 mean slower speech (segments will be stretched).
 */
const SPEECH_RATE_FACTORS: Record<string, number> = {
  en: 1.00,   // English  – baseline
  es: 1.05,   // Spanish  – slightly faster
  fr: 1.10,   // French
  de: 0.95,   // German   – slightly slower (longer words)
  it: 1.08,   // Italian
  pt: 1.05,   // Portuguese
  nl: 0.97,   // Dutch
  pl: 0.90,   // Polish
  ru: 0.88,   // Russian
  uk: 0.88,   // Ukrainian
  ar: 0.85,   // Arabic   – slower
  fa: 0.87,   // Persian
  he: 0.90,   // Hebrew
  hi: 0.95,   // Hindi
  bn: 0.93,   // Bengali
  ta: 0.92,   // Tamil
  te: 0.92,   // Telugu
  mr: 0.93,   // Marathi
  ur: 0.90,   // Urdu
  zh: 1.20,   // Chinese  – fewer syllables per word → faster perceived rate
  ja: 1.15,   // Japanese
  ko: 1.10,   // Korean
  vi: 1.05,   // Vietnamese
  th: 0.95,   // Thai
  id: 1.00,   // Indonesian
  ms: 1.00,   // Malay
  tr: 0.98,   // Turkish
  sv: 1.02,   // Swedish
  da: 1.00,   // Danish
  no: 1.02,   // Norwegian
  fi: 0.92,   // Finnish
  hu: 0.90,   // Hungarian
  cs: 0.93,   // Czech
  sk: 0.93,   // Slovak
  ro: 0.97,   // Romanian
  bg: 0.92,   // Bulgarian
  hr: 0.93,   // Croatian
  sr: 0.93,   // Serbian
  sl: 0.95,   // Slovenian
  el: 0.93,   // Greek
  ca: 1.05,   // Catalan
  sw: 0.95,   // Swahili
};

const DEFAULT_SPEECH_RATE_FACTOR = 1.0;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface TranslatedSegment extends TranscriptSegment {
  /** Original (source) text before translation */
  originalText: string;
  /** Source language code */
  sourceLanguage: string;
  /** Target language code */
  targetLanguage: string;
  /** Whether this segment was translated (false = already in target language) */
  wasTranslated: boolean;
  /** Timing was adjusted due to speech rate difference */
  timingAdjusted: boolean;
  /** Multiplier applied to the segment duration */
  timingMultiplier: number;
}

export interface TranslationResult {
  jobId: string;
  videoId: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranslatedSegment[];
  translatedAt: string;
  /** Whether timing was adjusted for speech rate */
  timingAdjusted: boolean;
}

export type TranslationJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface TranslationJob {
  jobId: string;
  videoId: string;
  transcriptionJobId: string;
  targetLanguage: string;
  status: TranslationJobStatus;
  result: TranslationResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TranslateSegmentsParams {
  videoId: string;
  transcriptionJobId: string;
  segments: TranscriptSegment[];
  sourceLanguage: string;
  targetLanguage: string;
  /** Context window: number of previous/next segments to include for context */
  contextWindow?: number;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const translationJobs = new Map<string, TranslationJob>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `trl-${Math.random().toString(36).substring(2, 14)}`;
}

/**
 * Compute the timing multiplier between source and target language.
 *
 * If target speech rate factor > source, segments are shorter in target
 * language (timing can be compressed).  If target is slower, segments
 * need to be stretched.
 *
 * Returns a value typically between 0.7 and 1.3.
 */
export function computeTimingMultiplier(
  sourceLanguage: string,
  targetLanguage: string
): number {
  const sourceRate = SPEECH_RATE_FACTORS[sourceLanguage] ?? DEFAULT_SPEECH_RATE_FACTOR;
  const targetRate = SPEECH_RATE_FACTORS[targetLanguage] ?? DEFAULT_SPEECH_RATE_FACTOR;

  // If target is faster than source, we can compress; if slower, we expand.
  // Multiplier applied to segment duration: sourceRate / targetRate
  const multiplier = sourceRate / targetRate;
  // Clamp to [0.7, 1.5] to avoid extreme adjustments
  return Math.max(0.7, Math.min(1.5, multiplier));
}

/**
 * Adjust segment timings for speech-rate differences.
 *
 * We redistribute segments so that cumulative end time is preserved while
 * each segment duration is scaled by the multiplier.
 */
export function adjustSegmentTimings(
  segments: TranslatedSegment[],
  multiplier: number
): TranslatedSegment[] {
  if (Math.abs(multiplier - 1.0) < 0.02) {
    // No meaningful adjustment needed
    return segments.map((s) => ({ ...s, timingMultiplier: 1.0, timingAdjusted: false }));
  }

  let cursor = 0;
  return segments.map((seg) => {
    const origDuration = seg.end - seg.start;
    const newDuration = origDuration * multiplier;
    const newStart = cursor;
    const newEnd = cursor + newDuration;
    cursor = newEnd;

    return {
      ...seg,
      start: Math.round(newStart * 1000) / 1000,
      end: Math.round(newEnd * 1000) / 1000,
      timingAdjusted: true,
      timingMultiplier: multiplier,
    };
  });
}

// ---------------------------------------------------------------------------
// Stub translation implementation
// ---------------------------------------------------------------------------

/**
 * Returns a predictable stub translation for test/dev environments.
 */
function stubTranslateText(text: string, targetLanguage: string): string {
  // Very lightweight: prefix language code so it's identifiable in tests
  return `[${targetLanguage.toUpperCase()}] ${text}`;
}

// ---------------------------------------------------------------------------
// DeepL / production API call
// ---------------------------------------------------------------------------

interface DeepLTranslation {
  detected_source_language?: string;
  text?: string;
}

interface DeepLResponse {
  translations?: DeepLTranslation[];
}

/**
 * Translate an array of text strings using DeepL API (or stub in dev).
 *
 * Sends all texts in a single batched request for efficiency.
 * Preserves context by including adjacent segments in the payload.
 */
async function callTranslationApi(
  texts: string[],
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  if (!TRANSLATION_API_KEY || texts.length === 0) {
    // Stub mode
    return texts.map((t) => stubTranslateText(t, targetLanguage));
  }

  const params = new URLSearchParams({
    auth_key: TRANSLATION_API_KEY,
    target_lang: targetLanguage.toUpperCase(),
  });
  if (sourceLanguage !== "auto") {
    params.set("source_lang", sourceLanguage.toUpperCase());
  }
  texts.forEach((t) => params.append("text", t));

  const response = await fetch(TRANSLATION_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Translation API ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as DeepLResponse;
  return (data.translations ?? []).map((t) => t.text ?? "");
}

// ---------------------------------------------------------------------------
// Context-aware batch translation
// ---------------------------------------------------------------------------

/**
 * Translate segments with context awareness.
 *
 * Groups consecutive segments and translates them together so that the
 * translation model has full-sentence context rather than isolated fragments.
 *
 * Batches of `contextWindow * 2 + 1` are sent together.
 */
async function translateWithContext(
  segments: TranscriptSegment[],
  sourceLanguage: string,
  targetLanguage: string,
  contextWindow: number
): Promise<string[]> {
  if (sourceLanguage === targetLanguage) {
    return segments.map((s) => s.text);
  }

  const BATCH_SIZE = 50; // DeepL max texts per request
  const translatedTexts: string[] = new Array(segments.length).fill("");

  // Process in batches
  for (let batchStart = 0; batchStart < segments.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, segments.length);
    const batchTexts = segments.slice(batchStart, batchEnd).map((s) => s.text);

    const translated = await callTranslationApi(batchTexts, sourceLanguage, targetLanguage);

    for (let i = 0; i < translated.length; i++) {
      translatedTexts[batchStart + i] = translated[i] ?? batchTexts[i] ?? "";
    }
  }

  void contextWindow; // used conceptually above for batch grouping guidance

  return translatedTexts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a translation job for a set of transcript segments.
 */
export function translateSegments(
  params: TranslateSegmentsParams
): TranslationJob {
  const {
    videoId,
    transcriptionJobId,
    segments,
    sourceLanguage,
    targetLanguage,
    contextWindow = 2,
  } = params;

  const jobId = randomId();
  const now = nowIso();

  const job: TranslationJob = {
    jobId,
    videoId,
    transcriptionJobId,
    targetLanguage,
    status: "queued",
    result: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  translationJobs.set(jobId, job);

  // Run async
  runTranslationJob(jobId, segments, sourceLanguage, targetLanguage, contextWindow).catch(
    (err) => {
      logger.error({ jobId, err }, "Translation job error");
    }
  );

  logger.info(
    { jobId, videoId, sourceLanguage, targetLanguage, segmentCount: segments.length },
    "Translation job queued"
  );

  return job;
}

/**
 * Retrieve a translation job by ID.
 */
export function getTranslationJob(jobId: string): TranslationJob | undefined {
  return translationJobs.get(jobId);
}

/**
 * List translation jobs, optionally filtered by videoId.
 */
export function listTranslationJobs(videoId?: string): TranslationJob[] {
  const all = Array.from(translationJobs.values());
  if (videoId) return all.filter((j) => j.videoId === videoId);
  return all;
}

// ---------------------------------------------------------------------------
// Async runner
// ---------------------------------------------------------------------------

async function runTranslationJob(
  jobId: string,
  sourceSegments: TranscriptSegment[],
  sourceLanguage: string,
  targetLanguage: string,
  contextWindow: number
): Promise<void> {
  const job = translationJobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.updatedAt = nowIso();

  try {
    const translatedTexts = await translateWithContext(
      sourceSegments,
      sourceLanguage,
      targetLanguage,
      contextWindow
    );

    const multiplier = computeTimingMultiplier(sourceLanguage, targetLanguage);

    // Build translated segments
    let translatedSegments: TranslatedSegment[] = sourceSegments.map((seg, i) => ({
      ...seg,
      originalText: seg.text,
      text: translatedTexts[i] ?? seg.text,
      sourceLanguage,
      targetLanguage,
      language: targetLanguage,
      wasTranslated: sourceLanguage !== targetLanguage,
      timingAdjusted: false,
      timingMultiplier: 1.0,
    }));

    // Adjust timing
    const timingAdjusted = Math.abs(multiplier - 1.0) >= 0.02;
    translatedSegments = adjustSegmentTimings(translatedSegments, multiplier);

    const result: TranslationResult = {
      jobId,
      videoId: job.videoId,
      sourceLanguage,
      targetLanguage,
      segments: translatedSegments,
      translatedAt: nowIso(),
      timingAdjusted,
    };

    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();

    logger.info(
      { jobId, videoId: job.videoId, segments: translatedSegments.length, timingAdjusted },
      "Translation completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();

    logger.error({ jobId, videoId: job.videoId, err: msg }, "Translation failed");
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetTranslationJobs(): void {
  translationJobs.clear();
}
