/**
 * VoiceSynthesisService – Speaker-cloned voice synthesis with lip-sync.
 *
 * Responsibilities:
 *  1. Clone the original speaker's voice characteristics from a reference
 *     audio segment.
 *  2. Generate dubbed audio in the target language matching the cloned voice.
 *  3. Implement lip-sync timing adjustment (stretch/compress syllables to
 *     match mouth movements).
 *  4. Mix the dubbed vocal track with the original background audio/music.
 *
 * Production: wire up to ElevenLabs, Coqui TTS, or the Quanttube voice ML
 * cluster.  The stub implementation mirrors the expected API contract.
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../logger";
import type { TranslatedSegment } from "./TranslationService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTS_API_URL =
  process.env.TTS_API_URL ?? "https://api.elevenlabs.io/v1/text-to-speech";
const TTS_API_KEY = process.env.TTS_API_KEY ?? "";

const SYNTHESIS_OUTPUT_ROOT =
  process.env.SYNTHESIS_OUTPUT_ROOT ?? "/tmp/quanttube-synthesis";

/** Default speaking rate (1.0 = normal) */
const DEFAULT_SPEAKING_RATE = 1.0;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface VoiceProfile {
  voiceId: string;
  /** Pitch factor relative to original (1.0 = unchanged) */
  pitchFactor: number;
  /** Energy/loudness factor */
  energyFactor: number;
  /** Approximate speaking rate of the original voice (words per minute) */
  speakingRateWpm: number;
  /** Base timbre vector (stub: numeric array representing voice characteristics) */
  timbreVector: number[];
  createdAt: string;
}

export interface SynthesisSegment {
  start: number;
  end: number;
  text: string;
  /** Path to the synthesized audio file for this segment */
  audioPath: string | null;
  /** Duration of the synthesized audio in seconds */
  synthesizedDurationSecs: number;
  /** Whether timing was stretched/compressed for lip-sync */
  lipSyncAdjusted: boolean;
  /** The stretch ratio applied (1.0 = no change) */
  stretchRatio: number;
}

export interface SynthesisResult {
  jobId: string;
  videoId: string;
  targetLanguage: string;
  /** Combined dubbed audio file path */
  dubbedAudioPath: string | null;
  /** Mixed audio (dubbing + background) path */
  mixedAudioPath: string | null;
  voiceProfile: VoiceProfile;
  segments: SynthesisSegment[];
  totalDurationSecs: number;
  completedAt: string;
}

export type SynthesisJobStatus =
  | "queued"
  | "cloning_voice"
  | "synthesizing"
  | "mixing"
  | "completed"
  | "failed";

export interface SynthesisJob {
  jobId: string;
  videoId: string;
  translationJobId: string;
  targetLanguage: string;
  /** Path to reference audio (original voice sample for cloning) */
  referenceAudioPath: string;
  /** Path to original background audio (music/ambient without vocals) */
  backgroundAudioPath: string | null;
  status: SynthesisJobStatus;
  result: SynthesisResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SynthesizeAudioParams {
  videoId: string;
  translationJobId: string;
  translatedSegments: TranslatedSegment[];
  targetLanguage: string;
  referenceAudioPath: string;
  backgroundAudioPath?: string;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const synthesisJobs = new Map<string, SynthesisJob>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `syn-${Math.random().toString(36).substring(2, 14)}`;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Voice profile extraction (stub)
// ---------------------------------------------------------------------------

/**
 * Extract voice characteristics from a reference audio sample.
 *
 * In production this would:
 *  1. Run the audio through a speaker encoder (e.g. SpeakerNet, ECAPA-TDNN).
 *  2. Extract pitch track, formant frequencies, energy envelope.
 *  3. Store the embedding vector for conditioning the TTS model.
 *
 * Stub: returns a deterministic pseudo-profile derived from the file path.
 */
export async function extractVoiceProfile(
  referenceAudioPath: string
): Promise<VoiceProfile> {
  logger.info({ referenceAudioPath }, "Extracting voice profile");

  // Deterministic stub – use path hash for reproducibility in tests
  const hash = referenceAudioPath
    .split("")
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);

  const pitchFactor = 0.9 + (hash % 20) / 100;       // 0.9 – 1.1
  const energyFactor = 0.85 + (hash % 30) / 100;     // 0.85 – 1.15
  const speakingRateWpm = 120 + (hash % 60);          // 120 – 180 wpm

  // 64-dimensional timbre vector (stub)
  const timbreVector = Array.from({ length: 64 }, (_, i) =>
    Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5
  );

  return {
    voiceId: `voice-${(hash % 0xffffff).toString(16).padStart(6, "0")}`,
    pitchFactor,
    energyFactor,
    speakingRateWpm,
    timbreVector,
    createdAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Lip-sync timing adjustment
// ---------------------------------------------------------------------------

/**
 * Compute the stretch ratio needed to make synthesized audio match the
 * mouth-movement window of the source segment.
 *
 * targetDurationSecs: available window from source timing
 * synthesizedDurationSecs: actual length of TTS output
 *
 * Returns: stretch ratio (< 1.0 = speed up, > 1.0 = slow down)
 * Clamped to [0.6, 1.5] to avoid perceptible distortion.
 */
export function computeLipSyncStretchRatio(
  targetDurationSecs: number,
  synthesizedDurationSecs: number
): number {
  if (synthesizedDurationSecs <= 0) return 1.0;
  const ratio = targetDurationSecs / synthesizedDurationSecs;
  return Math.max(0.6, Math.min(1.5, ratio));
}

/**
 * Build the ffmpeg command to apply time-stretch to an audio segment.
 *
 * Uses the `atempo` filter which supports ratios in [0.5, 2.0].
 * For ratios outside that range we chain multiple atempo filters.
 */
export function buildAtempoCommand(
  inputPath: string,
  outputPath: string,
  stretchRatio: number
): string {
  // atempo works in [0.5, 2.0]; chain filters for edge cases
  const filters: string[] = [];
  let remaining = stretchRatio;

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2.0) {
    filters.push("atempo=2.0");
    remaining /= 2.0;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);

  const filterChain = filters.join(",");

  return `ffmpeg -i "${inputPath}" -filter:a "${filterChain}" -y "${outputPath}"`;
}

// ---------------------------------------------------------------------------
// Audio mixing
// ---------------------------------------------------------------------------

/**
 * Build the ffmpeg command to mix dubbed vocal track with background audio.
 *
 * The dubbed vocals are brought to full volume; background audio is attenuated
 * to 20% to keep it present but unobtrusive.
 */
export function buildAudioMixCommand(
  dubbedVocalPath: string,
  backgroundAudioPath: string,
  outputPath: string,
  backgroundVolume = 0.2
): string {
  return (
    `ffmpeg -i "${dubbedVocalPath}" -i "${backgroundAudioPath}" ` +
    `-filter_complex "[0:a]volume=1.0[vocals];[1:a]volume=${backgroundVolume}[bg];` +
    `[vocals][bg]amix=inputs=2:duration=first:dropout_transition=2[out]" ` +
    `-map "[out]" -c:a aac -b:a 192k -y "${outputPath}"`
  );
}

// ---------------------------------------------------------------------------
// TTS API stub
// ---------------------------------------------------------------------------

/**
 * Synthesize a segment of text using the TTS API.
 *
 * In production: POST to ElevenLabs / Coqui / Quanttube TTS service with
 * voice embedding, speaking rate, and text.
 *
 * Stub: writes a placeholder file and returns a realistic duration estimate.
 */
async function synthesizeSegmentAudio(
  text: string,
  targetLanguage: string,
  voiceProfile: VoiceProfile,
  outputPath: string,
  targetDurationSecs: number
): Promise<{ audioPath: string; synthesizedDurationSecs: number }> {
  ensureDir(path.dirname(outputPath));

  if (!TTS_API_KEY) {
    // Stub mode – write a tiny dummy file
    fs.writeFileSync(
      outputPath,
      `STUB_AUDIO:lang=${targetLanguage}:voice=${voiceProfile.voiceId}:text=${text.slice(0, 40)}`
    );

    // Estimate synthesized duration based on word count and speaking rate
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const synthesizedDurationSecs =
      wordCount / (voiceProfile.speakingRateWpm / 60);

    return { audioPath: outputPath, synthesizedDurationSecs };
  }

  // Production: call TTS API
  const payload = {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
      speaking_rate: DEFAULT_SPEAKING_RATE,
    },
  };

  const response = await fetch(`${TTS_API_URL}/${voiceProfile.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": TTS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`TTS API ${response.status}: ${await response.text()}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, audioBuffer);

  // Approximate duration from bitrate (128 kbps mp3)
  const synthesizedDurationSecs = (audioBuffer.length * 8) / (128 * 1000);

  void targetDurationSecs; // passed for future adaptive-rate feature

  return { audioPath: outputPath, synthesizedDurationSecs };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a voice synthesis job.
 */
export function synthesizeAudio(params: SynthesizeAudioParams): SynthesisJob {
  const {
    videoId,
    translationJobId,
    translatedSegments,
    targetLanguage,
    referenceAudioPath,
    backgroundAudioPath,
  } = params;

  const jobId = randomId();
  const now = nowIso();

  const job: SynthesisJob = {
    jobId,
    videoId,
    translationJobId,
    targetLanguage,
    referenceAudioPath,
    backgroundAudioPath: backgroundAudioPath ?? null,
    status: "queued",
    result: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  synthesisJobs.set(jobId, job);

  runSynthesisJob(jobId, translatedSegments).catch((err) => {
    logger.error({ jobId, err }, "Synthesis job error");
  });

  logger.info(
    { jobId, videoId, targetLanguage, segments: translatedSegments.length },
    "Synthesis job queued"
  );

  return job;
}

/**
 * Retrieve a synthesis job by ID.
 */
export function getSynthesisJob(jobId: string): SynthesisJob | undefined {
  return synthesisJobs.get(jobId);
}

/**
 * List synthesis jobs, optionally filtered by videoId.
 */
export function listSynthesisJobs(videoId?: string): SynthesisJob[] {
  const all = Array.from(synthesisJobs.values());
  if (videoId) return all.filter((j) => j.videoId === videoId);
  return all;
}

// ---------------------------------------------------------------------------
// Async runner
// ---------------------------------------------------------------------------

async function runSynthesisJob(
  jobId: string,
  translatedSegments: TranslatedSegment[]
): Promise<void> {
  const job = synthesisJobs.get(jobId);
  if (!job) return;

  try {
    // Step 1: Extract voice profile
    job.status = "cloning_voice";
    job.updatedAt = nowIso();

    const voiceProfile = await extractVoiceProfile(job.referenceAudioPath);

    // Step 2: Synthesize each segment
    job.status = "synthesizing";
    job.updatedAt = nowIso();

    const outputDir = path.join(SYNTHESIS_OUTPUT_ROOT, job.videoId, job.jobId);
    ensureDir(outputDir);

    const synthesisSegments: SynthesisSegment[] = [];
    let totalDuration = 0;

    for (let i = 0; i < translatedSegments.length; i++) {
      const seg = translatedSegments[i]!;
      const targetDuration = seg.end - seg.start;
      const segOutputPath = path.join(outputDir, `seg_${String(i).padStart(5, "0")}.mp3`);

      const { audioPath, synthesizedDurationSecs } = await synthesizeSegmentAudio(
        seg.text,
        job.targetLanguage,
        voiceProfile,
        segOutputPath,
        targetDuration
      );

      const stretchRatio = computeLipSyncStretchRatio(targetDuration, synthesizedDurationSecs);
      const lipSyncAdjusted = Math.abs(stretchRatio - 1.0) > 0.05;

      synthesisSegments.push({
        start: seg.start,
        end: seg.end,
        text: seg.text,
        audioPath,
        synthesizedDurationSecs,
        lipSyncAdjusted,
        stretchRatio,
      });

      totalDuration = Math.max(totalDuration, seg.end);
    }

    // Step 3: Concatenate segment audio files into one dubbed track
    job.status = "mixing";
    job.updatedAt = nowIso();

    const dubbedAudioPath = path.join(outputDir, "dubbed_vocals.aac");
    const mixedAudioPath = path.join(outputDir, "dubbed_mixed.aac");

    // In stub mode, create placeholder files
    if (!TTS_API_KEY) {
      fs.writeFileSync(dubbedAudioPath, `STUB_DUBBED:${job.targetLanguage}:${job.videoId}`);
      if (job.backgroundAudioPath) {
        fs.writeFileSync(mixedAudioPath, `STUB_MIXED:${job.targetLanguage}:${job.videoId}`);
      }
    }

    const result: SynthesisResult = {
      jobId,
      videoId: job.videoId,
      targetLanguage: job.targetLanguage,
      dubbedAudioPath,
      mixedAudioPath: job.backgroundAudioPath ? mixedAudioPath : null,
      voiceProfile,
      segments: synthesisSegments,
      totalDurationSecs: totalDuration,
      completedAt: nowIso(),
    };

    job.result = result;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();

    logger.info(
      { jobId, videoId: job.videoId, targetLanguage: job.targetLanguage },
      "Voice synthesis completed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMessage = msg;
    job.updatedAt = nowIso();

    logger.error({ jobId, err: msg }, "Voice synthesis failed");
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetSynthesisJobs(): void {
  synthesisJobs.clear();
}
