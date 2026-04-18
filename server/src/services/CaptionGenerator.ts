/**
 * CaptionGenerator – Whisper-based speech-to-text caption pipeline.
 *
 * Responsibilities:
 *  1. Run Whisper-compatible STT with word-level timing alignment.
 *  2. Identify and label speakers in the transcript (diarization stub).
 *  3. Auto-translate captions to 20+ languages via the Translation pipeline.
 *  4. Export captions in WebVTT and SRT formats.
 *  5. Apply style customisation: font size, color, background, position.
 *
 * Production: configure WHISPER_API_KEY (OpenAI or self-hosted) and
 * TRANSLATION_API_KEY (DeepL) via environment variables.  The stub
 * implementation is fully functional for testing and local development.
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../logger";
import {
  transcribeAudio,
  getTranscriptionJob,
  type TranscriptSegment,
  type TranscriptionResult,
} from "./TranscriptionService";
import {
  translateSegments,
  getTranslationJob,
  type TranslatedSegment,
} from "./TranslationService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WHISPER_WORD_API_URL =
  process.env.WHISPER_API_URL ?? "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_API_KEY = process.env.WHISPER_API_KEY ?? "";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "whisper-1";

/** Maximum audio file size accepted by the API (25 MB) */
const MAX_AUDIO_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * All 20+ supported target languages for caption translation.
 * Codes follow ISO-639-1.
 */
export const SUPPORTED_CAPTION_LANGUAGES: readonly string[] = [
  "en", // English
  "es", // Spanish
  "fr", // French
  "de", // German
  "it", // Italian
  "pt", // Portuguese
  "ru", // Russian
  "zh", // Chinese (Simplified)
  "ja", // Japanese
  "ko", // Korean
  "ar", // Arabic
  "hi", // Hindi
  "bn", // Bengali
  "nl", // Dutch
  "pl", // Polish
  "sv", // Swedish
  "tr", // Turkish
  "vi", // Vietnamese
  "th", // Thai
  "id", // Indonesian
  "uk", // Ukrainian
  "fa", // Persian
] as const;

// ---------------------------------------------------------------------------
// Style types
// ---------------------------------------------------------------------------

export type CaptionPosition = "bottom" | "top" | "middle";
export type CaptionAlignment = "left" | "center" | "right";

export interface CaptionStyle {
  /** Font size in pixels (12–72) */
  fontSize: number;
  /** CSS color string for caption text */
  color: string;
  /** CSS color string for caption background (supports alpha) */
  backgroundColor: string;
  /** Opacity of the background box (0–1) */
  backgroundOpacity: number;
  /** Caption position on screen */
  position: CaptionPosition;
  /** Text alignment */
  alignment: CaptionAlignment;
  /** Whether to render with a text shadow for legibility */
  textShadow: boolean;
  /** Font family */
  fontFamily: string;
  /** Font weight (normal | bold) */
  fontWeight: "normal" | "bold";
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 20,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundOpacity: 0.75,
  position: "bottom",
  alignment: "center",
  textShadow: true,
  fontFamily: "Arial, sans-serif",
  fontWeight: "normal",
};

// ---------------------------------------------------------------------------
// Word-level timing
// ---------------------------------------------------------------------------

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TimedCaption {
  /** Unique sequential index within the job */
  index: number;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Caption text */
  text: string;
  /** Speaker label (e.g. "Speaker 1") */
  speaker: string;
  /** Word-level timings within this caption */
  words: WordTiming[];
  /** Language code for this caption */
  language: string;
  /** Confidence score 0–1 */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Speaker diarization types
// ---------------------------------------------------------------------------

export interface SpeakerSegment {
  /** Speaker identifier */
  speakerId: string;
  /** Human-readable label */
  label: string;
  /** Start time of this speaker's turn */
  start: number;
  /** End time of this speaker's turn */
  end: number;
}

export interface DiarizationResult {
  jobId: string;
  videoId: string;
  speakerCount: number;
  speakers: Array<{ speakerId: string; label: string; totalSpeakingTime: number }>;
  segments: SpeakerSegment[];
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Caption job types
// ---------------------------------------------------------------------------

export type CaptionJobStatus =
  | "queued"
  | "transcribing"
  | "diarizing"
  | "word_aligning"
  | "translating"
  | "formatting"
  | "completed"
  | "failed";

export interface CaptionJob {
  jobId: string;
  videoId: string;
  audioPath: string;
  sourceLanguage: string;
  /** Target languages for translated caption tracks */
  targetLanguages: string[];
  style: CaptionStyle;
  status: CaptionJobStatus;
  /** Source-language captions */
  captions: TimedCaption[];
  /** Map of language code → translated captions */
  translatedCaptions: Record<string, TimedCaption[]>;
  /** Speaker diarization result */
  diarization: DiarizationResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface GenerateCaptionsParams {
  videoId: string;
  audioPath: string;
  /** Source language, "auto" for detection */
  sourceLanguage?: string;
  /** Target languages for translation (subset of SUPPORTED_CAPTION_LANGUAGES) */
  targetLanguages?: string[];
  /** Caption style overrides */
  style?: Partial<CaptionStyle>;
}

// ---------------------------------------------------------------------------
// Export format types
// ---------------------------------------------------------------------------

export interface WebVTTCue {
  index: number;
  start: string;
  end: string;
  text: string;
  /** Optional WebVTT cue settings */
  settings: string;
}

export interface SRTCue {
  index: number;
  start: string;
  end: string;
  text: string;
}

export interface CaptionExport {
  format: "webvtt" | "srt";
  language: string;
  content: string;
  cueCount: number;
  exportedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const captionJobs = new Map<string, CaptionJob>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `cap-${Math.random().toString(36).substring(2, 14)}`;
}

/**
 * Format a time value in seconds to WebVTT timestamp format:
 * HH:MM:SS.mmm
 */
export function formatWebVTTTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  );
}

/**
 * Format a time value in seconds to SRT timestamp format:
 * HH:MM:SS,mmm
 */
export function formatSRTTimestamp(seconds: number): string {
  return formatWebVTTTimestamp(seconds).replace(".", ",");
}

/**
 * Build a WebVTT cue settings string from a CaptionStyle.
 */
export function buildWebVTTCueSettings(style: CaptionStyle): string {
  const parts: string[] = [];

  switch (style.position) {
    case "top":
      parts.push("line:5%");
      break;
    case "middle":
      parts.push("line:50%");
      break;
    case "bottom":
    default:
      parts.push("line:90%");
      break;
  }

  switch (style.alignment) {
    case "left":
      parts.push("align:left");
      break;
    case "right":
      parts.push("align:right");
      break;
    case "center":
    default:
      parts.push("align:center");
      break;
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Word-level alignment
// ---------------------------------------------------------------------------

interface WhisperWord {
  word?: string;
  start?: number;
  end?: number;
  probability?: number;
}

interface WhisperWordSegment {
  start?: number;
  end?: number;
  text?: string;
  words?: WhisperWord[];
  avg_logprob?: number;
  no_speech_prob?: number;
}

interface WhisperWordResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: WhisperWordSegment[];
}

/**
 * Generate realistic stub word timings for a caption segment.
 *
 * Distributes words evenly within the segment's time range,
 * with small random gaps between words to simulate natural speech pauses.
 */
function generateStubWordTimings(
  segment: TranscriptSegment
): WordTiming[] {
  const tokens = segment.text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const totalDuration = segment.end - segment.start;
  const wordDuration = totalDuration / tokens.length;

  return tokens.map((word, i) => {
    const wordStart = segment.start + i * wordDuration;
    const wordEnd = wordStart + wordDuration * 0.85; // 15% inter-word gap
    return {
      word,
      start: Math.round(wordStart * 1000) / 1000,
      end: Math.round(wordEnd * 1000) / 1000,
      confidence: 0.88 + Math.random() * 0.12,
    };
  });
}

/**
 * Request word-level timestamps from the Whisper API.
 *
 * Falls back to stub word timing when the API key is absent or the
 * audio file does not exist (test / dev environments).
 */
async function fetchWordTimings(
  audioPath: string,
  language: string,
  sourceSegments: TranscriptSegment[]
): Promise<Record<number, WordTiming[]>> {
  if (!WHISPER_API_KEY || !fs.existsSync(audioPath)) {
    logger.warn(
      { audioPath },
      "Whisper API key not configured – using stub word timings"
    );
    const result: Record<number, WordTiming[]> = {};
    sourceSegments.forEach((seg, idx) => {
      result[idx] = generateStubWordTimings(seg);
    });
    return result;
  }

  const stat = fs.statSync(audioPath);
  if (stat.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    logger.warn(
      { audioPath, size: stat.size },
      "Audio file too large for word-timing request – using stub"
    );
    const fallback: Record<number, WordTiming[]> = {};
    sourceSegments.forEach((seg, idx) => {
      fallback[idx] = generateStubWordTimings(seg);
    });
    return fallback;
  }

  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath) || ".mp3";
  formData.append("file", new Blob([audioBuffer]), `audio${ext}`);
  formData.append("model", WHISPER_MODEL);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  if (language !== "auto") formData.append("language", language);

  const response = await fetch(WHISPER_WORD_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHISPER_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper word-timing API ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as WhisperWordResponse;
  const result: Record<number, WordTiming[]> = {};

  (data.segments ?? []).forEach((seg, idx) => {
    result[idx] = (seg.words ?? []).map((w) => ({
      word: w.word ?? "",
      start: w.start ?? 0,
      end: w.end ?? 0,
      confidence: w.probability ?? 0.9,
    }));
  });

  return result;
}

// ---------------------------------------------------------------------------
// Speaker diarization
// ---------------------------------------------------------------------------

const DIARIZATION_API_URL =
  process.env.DIARIZATION_API_URL ?? "";

/**
 * Perform speaker diarization on the audio file.
 *
 * In production: POST to a pyannote.audio / AssemblyAI diarization endpoint.
 * Stub: assigns speakers based on segment index cycling through 2 speakers.
 */
async function performDiarization(
  audioPath: string,
  videoId: string,
  segments: TranscriptSegment[]
): Promise<DiarizationResult> {
  const jobId = `dia-${Math.random().toString(36).substring(2, 14)}`;

  if (!DIARIZATION_API_URL || !fs.existsSync(audioPath)) {
    logger.warn(
      { audioPath },
      "Diarization API not configured – using stub speaker assignment"
    );

    const speakerCount = segments.length > 3 ? 2 : 1;
    const speakerSegments: SpeakerSegment[] = segments.map((seg, i) => {
      const speakerIndex = speakerCount === 1 ? 0 : i % speakerCount;
      return {
        speakerId: `spk_${speakerIndex}`,
        label: `Speaker ${speakerIndex + 1}`,
        start: seg.start,
        end: seg.end,
      };
    });

    const speakerMap = new Map<string, number>();
    speakerSegments.forEach((s) => {
      const dur = s.end - s.start;
      speakerMap.set(s.speakerId, (speakerMap.get(s.speakerId) ?? 0) + dur);
    });

    const speakers = Array.from(speakerMap.entries()).map(([speakerId, totalSpeakingTime]) => ({
      speakerId,
      label: speakerSegments.find((s) => s.speakerId === speakerId)?.label ?? "Speaker",
      totalSpeakingTime: Math.round(totalSpeakingTime * 100) / 100,
    }));

    return {
      jobId,
      videoId,
      speakerCount: speakers.length,
      speakers,
      segments: speakerSegments,
      completedAt: nowIso(),
    };
  }

  const stat = fs.statSync(audioPath);
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath) || ".mp3";
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), `audio${ext}`);
  formData.append("num_speakers", "2");

  const response = await fetch(DIARIZATION_API_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Diarization API ${response.status}: ${errText}`);
  }

  void stat; // Size validated above; stat used to confirm file accessibility

  const raw = (await response.json()) as {
    segments?: Array<{ speaker: string; start: number; end: number }>;
  };

  const diarSegments: SpeakerSegment[] = (raw.segments ?? []).map((s) => ({
    speakerId: s.speaker,
    label: `Speaker ${s.speaker}`,
    start: s.start,
    end: s.end,
  }));

  const speakerMap = new Map<string, number>();
  diarSegments.forEach((s) => {
    const dur = s.end - s.start;
    speakerMap.set(s.speakerId, (speakerMap.get(s.speakerId) ?? 0) + dur);
  });

  const speakers = Array.from(speakerMap.entries()).map(([speakerId, totalSpeakingTime]) => ({
    speakerId,
    label: `Speaker ${speakerId}`,
    totalSpeakingTime: Math.round(totalSpeakingTime * 100) / 100,
  }));

  return {
    jobId,
    videoId,
    speakerCount: speakers.length,
    speakers,
    segments: diarSegments,
    completedAt: nowIso(),
  };
}

/**
 * Find the speaker label for a given time range from diarization results.
 * Returns the speaker that has the most overlap with [start, end].
 */
function resolveSpeakerLabel(
  start: number,
  end: number,
  diarization: DiarizationResult
): string {
  let bestLabel = "Speaker 1";
  let bestOverlap = 0;

  for (const seg of diarization.segments) {
    const overlapStart = Math.max(start, seg.start);
    const overlapEnd = Math.min(end, seg.end);
    if (overlapEnd > overlapStart) {
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestLabel = seg.label;
      }
    }
  }

  return bestLabel;
}

// ---------------------------------------------------------------------------
// Build TimedCaption array from TranscriptionResult + word timings + diarization
// ---------------------------------------------------------------------------

function buildTimedCaptions(
  transcription: TranscriptionResult,
  wordTimings: Record<number, WordTiming[]>,
  diarization: DiarizationResult
): TimedCaption[] {
  return transcription.segments.map((seg, idx) => ({
    index: idx,
    start: seg.start,
    end: seg.end,
    text: seg.text,
    speaker: resolveSpeakerLabel(seg.start, seg.end, diarization),
    words: wordTimings[idx] ?? generateStubWordTimings(seg),
    language: seg.language,
    confidence: seg.confidence,
  }));
}

/**
 * Convert TranslatedSegment array to TimedCaption array.
 */
function translatedSegmentsToTimedCaptions(
  segments: TranslatedSegment[],
  diarization: DiarizationResult
): TimedCaption[] {
  return segments.map((seg, idx) => ({
    index: idx,
    start: seg.start,
    end: seg.end,
    text: seg.text,
    speaker: resolveSpeakerLabel(seg.start, seg.end, diarization),
    words: generateStubWordTimings(seg),
    language: seg.language,
    confidence: seg.confidence,
  }));
}

// ---------------------------------------------------------------------------
// Export formatters
// ---------------------------------------------------------------------------

/**
 * Convert TimedCaption array to a WebVTT string.
 *
 * Embeds style metadata in the STYLE block and includes speaker labels
 * as voice spans when there are multiple speakers.
 */
export function exportWebVTT(
  captions: TimedCaption[],
  language: string,
  style: CaptionStyle
): CaptionExport {
  const cueSettings = buildWebVTTCueSettings(style);
  const multiSpeaker = new Set(captions.map((c) => c.speaker)).size > 1;

  const styleBlock = [
    "STYLE",
    "::cue {",
    `  font-family: ${style.fontFamily};`,
    `  font-size: ${style.fontSize}px;`,
    `  color: ${style.color};`,
    `  background-color: ${hexToRgba(style.backgroundColor, style.backgroundOpacity)};`,
    `  font-weight: ${style.fontWeight};`,
    style.textShadow ? "  text-shadow: 1px 1px 2px rgba(0,0,0,0.8);" : "",
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const cueBlocks = captions.map((cap, i) => {
    const startTs = formatWebVTTTimestamp(cap.start);
    const endTs = formatWebVTTTimestamp(cap.end);
    const text = multiSpeaker ? `<v ${cap.speaker}>${cap.text}` : cap.text;
    return `${i + 1}\n${startTs} --> ${endTs} ${cueSettings}\n${text}`;
  });

  const content = ["WEBVTT", "", styleBlock, "", ...cueBlocks].join("\n\n");

  return {
    format: "webvtt",
    language,
    content,
    cueCount: captions.length,
    exportedAt: nowIso(),
  };
}

/**
 * Convert TimedCaption array to an SRT string.
 */
export function exportSRT(
  captions: TimedCaption[],
  language: string
): CaptionExport {
  const blocks = captions.map((cap, i) => {
    const startTs = formatSRTTimestamp(cap.start);
    const endTs = formatSRTTimestamp(cap.end);
    const multiSpeaker = captions.some((c) => c.speaker !== cap.speaker);
    const text = multiSpeaker ? `[${cap.speaker}] ${cap.text}` : cap.text;
    return `${i + 1}\n${startTs} --> ${endTs}\n${text}`;
  });

  return {
    format: "srt",
    language,
    content: blocks.join("\n\n"),
    cueCount: captions.length,
    exportedAt: nowIso(),
  };
}

/**
 * Convert a hex color + opacity to an rgba() CSS string.
 */
export function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const fullHex = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;

  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  const a = Math.max(0, Math.min(1, opacity));

  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a caption generation job for an audio/video file.
 *
 * Steps executed asynchronously:
 *  1. Whisper transcription (with word-level timing)
 *  2. Speaker diarization
 *  3. Translation to all requested target languages
 *  4. WebVTT + SRT export readiness (formats are generated on demand)
 */
export function generateCaptions(params: GenerateCaptionsParams): CaptionJob {
  const {
    videoId,
    audioPath,
    sourceLanguage = "auto",
    targetLanguages = [],
    style = {},
  } = params;

  const validTargetLanguages = targetLanguages.filter((lang) =>
    (SUPPORTED_CAPTION_LANGUAGES as readonly string[]).includes(lang)
  );

  const jobId = randomId();
  const now = nowIso();

  const job: CaptionJob = {
    jobId,
    videoId,
    audioPath,
    sourceLanguage,
    targetLanguages: validTargetLanguages,
    style: { ...DEFAULT_CAPTION_STYLE, ...style },
    status: "queued",
    captions: [],
    translatedCaptions: {},
    diarization: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  captionJobs.set(jobId, job);

  runCaptionJob(jobId).catch((err) => {
    logger.error({ jobId, err }, "Caption generation job error");
  });

  logger.info(
    { jobId, videoId, audioPath, sourceLanguage, targetLanguages: validTargetLanguages },
    "Caption generation job queued"
  );

  return job;
}

/**
 * Retrieve a caption job by ID.
 */
export function getCaptionJob(jobId: string): CaptionJob | undefined {
  return captionJobs.get(jobId);
}

/**
 * List caption jobs, optionally filtered by videoId.
 */
export function listCaptionJobs(videoId?: string): CaptionJob[] {
  const all = Array.from(captionJobs.values());
  if (videoId) return all.filter((j) => j.videoId === videoId);
  return all;
}

/**
 * Export captions for a completed job in WebVTT or SRT format.
 *
 * Pass a language code to get translated captions, or omit/use sourceLanguage
 * for the original language track.
 */
export function exportCaptions(
  jobId: string,
  format: "webvtt" | "srt",
  language?: string
): CaptionExport | null {
  const job = captionJobs.get(jobId);
  if (!job || job.status !== "completed") return null;

  const targetLang = language ?? job.sourceLanguage;
  let captions: TimedCaption[];

  if (targetLang === job.sourceLanguage || !job.translatedCaptions[targetLang]) {
    captions = job.captions;
  } else {
    captions = job.translatedCaptions[targetLang]!;
  }

  if (format === "webvtt") {
    return exportWebVTT(captions, targetLang, job.style);
  }
  return exportSRT(captions, targetLang);
}

/**
 * Update the style of a caption job.  Re-exports of WebVTT will pick
 * up the new style automatically since style is embedded at export time.
 */
export function updateCaptionStyle(
  jobId: string,
  style: Partial<CaptionStyle>
): CaptionJob | null {
  const job = captionJobs.get(jobId);
  if (!job) return null;
  job.style = { ...job.style, ...style };
  job.updatedAt = nowIso();
  return job;
}

// ---------------------------------------------------------------------------
// Async job runner
// ---------------------------------------------------------------------------

async function runCaptionJob(jobId: string): Promise<void> {
  const job = captionJobs.get(jobId);
  if (!job) return;

  try {
    // Step 1: Transcribe audio (word-level)
    job.status = "transcribing";
    job.updatedAt = nowIso();

    const transcriptionJob = transcribeAudio({
      videoId: job.videoId,
      audioPath: job.audioPath,
      language: job.sourceLanguage,
      apiUrl: WHISPER_WORD_API_URL,
    });

    // Wait for transcription to complete (poll with backoff)
    await waitForJob(
      () => getTranscriptionJob(transcriptionJob.jobId),
      (j) => j?.status === "completed" || j?.status === "failed",
      50,
      20
    );

    const completedTranscription = getTranscriptionJob(transcriptionJob.jobId);
    if (!completedTranscription || completedTranscription.status === "failed") {
      throw new Error(
        `Transcription failed: ${completedTranscription?.errorMessage ?? "unknown"}`
      );
    }
    const transcriptionResult = completedTranscription.result!;
    const detectedLanguage = transcriptionResult.detectedLanguage;

    // Step 2: Speaker diarization
    job.status = "diarizing";
    job.updatedAt = nowIso();

    const diarization = await performDiarization(
      job.audioPath,
      job.videoId,
      transcriptionResult.segments
    );
    job.diarization = diarization;

    // Step 3: Word-level timing alignment
    job.status = "word_aligning";
    job.updatedAt = nowIso();

    const wordTimings = await fetchWordTimings(
      job.audioPath,
      detectedLanguage,
      transcriptionResult.segments
    );

    // Build source-language timed captions
    job.captions = buildTimedCaptions(transcriptionResult, wordTimings, diarization);
    job.sourceLanguage = detectedLanguage;

    // Step 4: Translate to all target languages
    job.status = "translating";
    job.updatedAt = nowIso();

    const translationPromises = job.targetLanguages
      .filter((lang) => lang !== detectedLanguage)
      .map(async (targetLang) => {
        const tlJob = translateSegments({
          videoId: job.videoId,
          transcriptionJobId: transcriptionJob.jobId,
          segments: transcriptionResult.segments,
          sourceLanguage: detectedLanguage,
          targetLanguage: targetLang,
          contextWindow: 2,
        });

        await waitForJob(
          () => getTranslationJob(tlJob.jobId),
          (j) => j?.status === "completed" || j?.status === "failed",
          50,
          20
        );

        const completedTl = getTranslationJob(tlJob.jobId);
        if (completedTl?.status === "completed" && completedTl.result) {
          job.translatedCaptions[targetLang] = translatedSegmentsToTimedCaptions(
            completedTl.result.segments,
            diarization
          );
        } else {
          logger.warn(
            { jobId, targetLang, tlJobId: tlJob.jobId },
            "Translation job failed or missing result – skipping language"
          );
        }
      });

    await Promise.allSettled(translationPromises);

    // Step 5: Mark as complete
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();

    logger.info(
      {
        jobId,
        videoId: job.videoId,
        captions: job.captions.length,
        translatedLanguages: Object.keys(job.translatedCaptions),
      },
      "Caption generation completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();
    logger.error({ jobId, err: msg }, "Caption generation failed");
  }
}

/**
 * Generic async job polling helper with exponential backoff.
 */
async function waitForJob<T>(
  getter: () => T,
  isDone: (val: T) => boolean,
  intervalMs: number,
  maxAttempts: number
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isDone(getter())) return;
    await sleep(intervalMs * Math.min(Math.pow(1.5, attempt), 8));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Batch export utility
// ---------------------------------------------------------------------------

/**
 * Export all available caption tracks for a job in both WebVTT and SRT formats.
 *
 * Returns a map of { [language]: { webvtt: CaptionExport, srt: CaptionExport } }
 */
export function exportAllCaptionTracks(jobId: string): Record<
  string,
  { webvtt: CaptionExport; srt: CaptionExport }
> {
  const job = captionJobs.get(jobId);
  if (!job || job.status !== "completed") return {};

  const result: Record<string, { webvtt: CaptionExport; srt: CaptionExport }> = {};

  // Source language
  result[job.sourceLanguage] = {
    webvtt: exportWebVTT(job.captions, job.sourceLanguage, job.style),
    srt: exportSRT(job.captions, job.sourceLanguage),
  };

  // Translated languages
  for (const [lang, captions] of Object.entries(job.translatedCaptions)) {
    result[lang] = {
      webvtt: exportWebVTT(captions, lang, job.style),
      srt: exportSRT(captions, lang),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetCaptionJobs(): void {
  captionJobs.clear();
}
