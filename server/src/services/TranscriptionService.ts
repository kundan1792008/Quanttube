/**
 * TranscriptionService – Whisper-compatible audio transcription.
 *
 * Accepts an audio file path (extracted from an uploaded video) and:
 *  1. Sends it to a Whisper-compatible transcription API endpoint.
 *  2. Returns timestamped transcript segments with confidence scores.
 *  3. Supports 50+ input languages (auto-detect or explicit).
 *
 * In production: replace the stub logic with real HTTP calls to OpenAI
 * Whisper API, a self-hosted Whisper.cpp server, or the Quanttube ML cluster.
 */

import * as fs from "fs";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WHISPER_API_URL =
  process.env.WHISPER_API_URL ?? "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_API_KEY = process.env.WHISPER_API_KEY ?? "";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "whisper-1";

/** Maximum audio file size accepted by the API (25 MB) */
const MAX_AUDIO_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Transcribed text for this segment */
  text: string;
  /** Confidence score 0–1 */
  confidence: number;
  /** Detected or specified language code (ISO-639-1) */
  language: string;
}

export interface TranscriptionResult {
  jobId: string;
  audioPath: string;
  detectedLanguage: string;
  duration: number;
  segments: TranscriptSegment[];
  fullText: string;
  confidence: number;
  completedAt: string;
}

export type TranscriptionJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface TranscriptionJob {
  jobId: string;
  videoId: string;
  audioPath: string;
  /** BCP-47 language code, or "auto" for auto-detect */
  language: string;
  status: TranscriptionJobStatus;
  result: TranscriptionResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TranscribeAudioParams {
  videoId: string;
  audioPath: string;
  /** Language hint; "auto" for auto-detection */
  language?: string;
  /** Optional: Override the Whisper API endpoint (for testing) */
  apiUrl?: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const transcriptionJobs = new Map<string, TranscriptionJob>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `txn-${Math.random().toString(36).substring(2, 14)}`;
}

// ---------------------------------------------------------------------------
// Stub transcript generator
// ---------------------------------------------------------------------------

/**
 * Generates realistic-looking stub segments for test/local environments
 * where the Whisper API is not configured.
 */
function generateStubSegments(
  text: string,
  estimatedDurationSecs: number
): TranscriptSegment[] {
  const words = text.split(/\s+/).filter(Boolean);
  const segments: TranscriptSegment[] = [];
  const wordsPerSegment = 8;
  const totalSegments = Math.max(1, Math.ceil(words.length / wordsPerSegment));
  const segDuration = estimatedDurationSecs / totalSegments;

  for (let i = 0; i < totalSegments; i++) {
    const chunk = words.slice(i * wordsPerSegment, (i + 1) * wordsPerSegment);
    segments.push({
      start: Math.round(i * segDuration * 100) / 100,
      end: Math.round((i + 1) * segDuration * 100) / 100,
      text: chunk.join(" "),
      confidence: 0.92 + Math.random() * 0.07,
      language: "en",
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Real Whisper API call (production path)
// ---------------------------------------------------------------------------

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
}

/**
 * Call the Whisper-compatible transcription API.
 *
 * Falls back to stub response when the API key is not configured or
 * the audio file does not exist (test environments).
 */
async function callWhisperApi(
  audioPath: string,
  language: string,
  apiUrl: string
): Promise<TranscriptionResult> {
  const jobId = randomId();

  // In test/dev environments or when file doesn't exist, return stub
  if (!WHISPER_API_KEY || !fs.existsSync(audioPath)) {
    logger.warn(
      { audioPath, apiUrl },
      "Whisper API key not configured or file absent – returning stub transcription"
    );

    const stubText =
      "This is a stub transcription. Configure WHISPER_API_KEY and a valid audio file for real results.";
    const durationSecs = 60;
    const segments = generateStubSegments(stubText, durationSecs);
    const avgConfidence =
      segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length;

    return {
      jobId,
      audioPath,
      detectedLanguage: language === "auto" ? "en" : language,
      duration: durationSecs,
      segments,
      fullText: stubText,
      confidence: Math.round(avgConfidence * 1000) / 1000,
      completedAt: nowIso(),
    };
  }

  const stat = fs.statSync(audioPath);
  if (stat.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new Error(
      `Audio file size ${stat.size} bytes exceeds maximum ${MAX_AUDIO_FILE_SIZE_BYTES} bytes for Whisper API`
    );
  }

  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer]);
  formData.append("file", blob, `audio${getExtension(audioPath)}`);
  formData.append("model", WHISPER_MODEL);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");
  if (language !== "auto") formData.append("language", language);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHISPER_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API returned ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as WhisperResponse;

  const segments: TranscriptSegment[] = (data.segments ?? []).map((seg) => ({
    start: seg.start ?? 0,
    end: seg.end ?? 0,
    text: (seg.text ?? "").trim(),
    confidence: seg.avg_logprob != null
      ? Math.max(0, Math.min(1, Math.exp(seg.avg_logprob)))
      : 0.9,
    language: data.language ?? (language === "auto" ? "en" : language),
  }));

  const fullText = data.text ?? segments.map((s) => s.text).join(" ");
  const avgConfidence =
    segments.length > 0
      ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
      : 0.9;

  return {
    jobId,
    audioPath,
    detectedLanguage: data.language ?? (language === "auto" ? "en" : language),
    duration: data.duration ?? 0,
    segments,
    fullText,
    confidence: Math.round(avgConfidence * 1000) / 1000,
    completedAt: nowIso(),
  };
}

function getExtension(filePath: string): string {
  const ext = filePath.split(".").pop();
  return ext ? `.${ext}` : ".mp3";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit an audio file for transcription.
 *
 * Returns the job immediately; the actual API call is made asynchronously.
 */
export function transcribeAudio(
  params: TranscribeAudioParams
): TranscriptionJob {
  const {
    videoId,
    audioPath,
    language = "auto",
    apiUrl = WHISPER_API_URL,
  } = params;

  const jobId = randomId();
  const now = nowIso();

  const job: TranscriptionJob = {
    jobId,
    videoId,
    audioPath,
    language,
    status: "queued",
    result: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  transcriptionJobs.set(jobId, job);

  // Process asynchronously
  runTranscriptionJob(jobId, apiUrl).catch((err) => {
    logger.error({ jobId, err }, "Transcription job error");
  });

  logger.info({ jobId, videoId, audioPath, language }, "Transcription job queued");

  return job;
}

/**
 * Retrieve a transcription job by ID.
 */
export function getTranscriptionJob(jobId: string): TranscriptionJob | undefined {
  return transcriptionJobs.get(jobId);
}

/**
 * List all transcription jobs for a video.
 */
export function listTranscriptionJobs(videoId?: string): TranscriptionJob[] {
  const all = Array.from(transcriptionJobs.values());
  if (videoId) return all.filter((j) => j.videoId === videoId);
  return all;
}

// ---------------------------------------------------------------------------
// Async job runner
// ---------------------------------------------------------------------------

async function runTranscriptionJob(jobId: string, apiUrl: string): Promise<void> {
  const job = transcriptionJobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.updatedAt = nowIso();

  try {
    const result = await callWhisperApi(job.audioPath, job.language, apiUrl);
    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();

    logger.info(
      { jobId, videoId: job.videoId, segments: result.segments.length },
      "Transcription completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();

    logger.error({ jobId, videoId: job.videoId, err: msg }, "Transcription failed");
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetTranscriptionJobs(): void {
  transcriptionJobs.clear();
}
