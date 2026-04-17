/**
 * AudioRemixService – AI-powered audio manipulation pipeline.
 *
 * Handles music replacement, SFX injection at specific timestamps,
 * time-stretching (speed change) without pitch shift, and voice cloning
 * with lip-sync preservation.
 */

import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MUSIC_GENRES = [
  "lo-fi",
  "epic-orchestral",
  "synthwave",
  "acoustic",
  "hip-hop",
  "jazz",
  "ambient",
  "rock",
  "electronic",
  "classical",
] as const;

export const SOUND_EFFECTS = [
  "explosion",
  "crowd-cheer",
  "dramatic-sting",
  "notification-ping",
  "thunder",
  "wind",
  "rain-drops",
  "laugh-track",
  "suspense-riser",
  "whoosh",
] as const;

export type MusicGenre = (typeof MUSIC_GENRES)[number];
export type SoundEffectId = (typeof SOUND_EFFECTS)[number];

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export type AudioJobType =
  | "music-change"
  | "sfx-injection"
  | "speed-change"
  | "voice-clone";

export type AudioJobStatus = "queued" | "processing" | "completed" | "failed";

interface BaseAudioJob {
  jobId: string;
  videoId: string;
  type: AudioJobType;
  status: AudioJobStatus;
  /** 0-100 */
  progress: number;
  /** URL to the processed audio/video once complete. */
  outputUrl: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface MusicChangeJob extends BaseAudioJob {
  type: "music-change";
  genre: MusicGenre;
  /** Whether the original speech track was preserved. */
  speechPreserved: boolean;
}

export interface SfxTimestamp {
  /** Start position in the video (seconds). */
  timestampSeconds: number;
  effectId: SoundEffectId;
  /** Volume multiplier (0.0–2.0, default 1.0). */
  volume: number;
}

export interface SfxInjectionJob extends BaseAudioJob {
  type: "sfx-injection";
  timestamps: SfxTimestamp[];
}

export interface SpeedChangeJob extends BaseAudioJob {
  type: "speed-change";
  /** Playback speed multiplier, e.g. 0.5 (half) or 2.0 (double). */
  factor: number;
  /** Whether pitch compensation (time-stretch) was applied. */
  pitchCompensated: boolean;
}

export interface VoiceCloneJob extends BaseAudioJob {
  type: "voice-clone";
  targetVoiceId: string;
  /** Estimated lip-sync offset in milliseconds after completion. */
  lipSyncOffsetMs: number | null;
}

export type AudioJob =
  | MusicChangeJob
  | SfxInjectionJob
  | SpeedChangeJob
  | VoiceCloneJob;

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const audioJobs = new Map<string, AudioJob>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function buildAudioOutputUrl(jobId: string, type: AudioJobType): string {
  return `https://cdn.quanttube.app/audio-remixes/${type}/${jobId}/output.mp4`;
}

/**
 * Simulate async audio processing with incremental progress updates.
 */
function simulateAudioProcessing(
  jobId: string,
  steps = 4,
  onComplete?: (job: AudioJob) => void
): void {
  // Defer so the caller receives the job in "queued" state first.
  setImmediate(() => {
    const job = audioJobs.get(jobId);
    if (!job) return;

    job.status = "processing";
    job.progress = 0;
    job.updatedAt = now();

    let step = 0;
    const interval = setInterval(() => {
      const currentJob = audioJobs.get(jobId);
      if (!currentJob) {
        clearInterval(interval);
        return;
      }

      step += 1;
      currentJob.progress = Math.min(100, Math.round((step / steps) * 100));
      currentJob.updatedAt = now();

      if (step >= steps) {
        currentJob.status = "completed";
        currentJob.progress = 100;
        currentJob.outputUrl = buildAudioOutputUrl(jobId, currentJob.type);
        clearInterval(interval);
        if (onComplete) onComplete(currentJob);
      }
    }, 50);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace background music in a video with a track from the selected genre
 * while preserving the original speech using source separation.
 */
export function changeMusic(
  videoId: string,
  genre: MusicGenre
): MusicChangeJob | { error: string } {
  if (!videoId || !videoId.trim()) {
    return { error: "videoId is required" };
  }
  if (!MUSIC_GENRES.includes(genre)) {
    return {
      error: `genre must be one of: ${MUSIC_GENRES.join(", ")}`,
    };
  }

  const job: MusicChangeJob = {
    jobId: uuidv4(),
    videoId: videoId.trim(),
    type: "music-change",
    genre,
    speechPreserved: true,
    status: "queued",
    progress: 0,
    outputUrl: null,
    createdAt: now(),
    updatedAt: now(),
    error: null,
  };

  audioJobs.set(job.jobId, job);
  simulateAudioProcessing(job.jobId, 4);
  return job;
}

/**
 * Inject sound effects at specific timestamps in the video.
 */
export function addSoundEffects(
  videoId: string,
  timestamps: Array<{ timestampSeconds: number; effectId: SoundEffectId; volume?: number }>
): SfxInjectionJob | { error: string } {
  if (!videoId || !videoId.trim()) {
    return { error: "videoId is required" };
  }
  if (!Array.isArray(timestamps) || timestamps.length === 0) {
    return { error: "timestamps must be a non-empty array" };
  }

  const normalised: SfxTimestamp[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    if (typeof t.timestampSeconds !== "number" || t.timestampSeconds < 0) {
      return { error: `timestamps[${i}].timestampSeconds must be a non-negative number` };
    }
    if (!SOUND_EFFECTS.includes(t.effectId)) {
      return {
        error: `timestamps[${i}].effectId "${t.effectId}" is invalid. Valid: ${SOUND_EFFECTS.join(", ")}`,
      };
    }
    const volume = t.volume !== undefined ? t.volume : 1.0;
    if (typeof volume !== "number" || volume < 0 || volume > 2) {
      return { error: `timestamps[${i}].volume must be between 0 and 2` };
    }
    normalised.push({ timestampSeconds: t.timestampSeconds, effectId: t.effectId, volume });
  }

  const job: SfxInjectionJob = {
    jobId: uuidv4(),
    videoId: videoId.trim(),
    type: "sfx-injection",
    timestamps: normalised,
    status: "queued",
    progress: 0,
    outputUrl: null,
    createdAt: now(),
    updatedAt: now(),
    error: null,
  };

  audioJobs.set(job.jobId, job);
  simulateAudioProcessing(job.jobId, 3);
  return job;
}

/**
 * Time-stretch a video to the requested speed factor without altering pitch.
 *
 * factor 0.5 = half speed, 1.0 = normal, 2.0 = double speed.
 * Uses the WSOLA algorithm (stub) for pitch-transparent time stretching.
 */
export function speedChange(
  videoId: string,
  factor: number
): SpeedChangeJob | { error: string } {
  if (!videoId || !videoId.trim()) {
    return { error: "videoId is required" };
  }
  if (typeof factor !== "number" || !isFinite(factor)) {
    return { error: "factor must be a finite number" };
  }
  if (factor < 0.25 || factor > 4.0) {
    return { error: "factor must be between 0.25 and 4.0" };
  }

  const job: SpeedChangeJob = {
    jobId: uuidv4(),
    videoId: videoId.trim(),
    type: "speed-change",
    factor,
    pitchCompensated: true,
    status: "queued",
    progress: 0,
    outputUrl: null,
    createdAt: now(),
    updatedAt: now(),
    error: null,
  };

  audioJobs.set(job.jobId, job);
  simulateAudioProcessing(job.jobId, 3);
  return job;
}

/**
 * Re-dub a video with a target voice while maintaining lip sync.
 *
 * The voice clone pipeline isolates the speech track, synthesises it in the
 * target voice, then re-composites with the original audio mix and adjusts
 * timing to minimise lip-sync offset (target < 100 ms).
 */
export function voiceClone(
  videoId: string,
  targetVoiceId: string
): VoiceCloneJob | { error: string } {
  if (!videoId || !videoId.trim()) {
    return { error: "videoId is required" };
  }
  if (!targetVoiceId || !targetVoiceId.trim()) {
    return { error: "targetVoiceId is required" };
  }

  const job: VoiceCloneJob = {
    jobId: uuidv4(),
    videoId: videoId.trim(),
    type: "voice-clone",
    targetVoiceId: targetVoiceId.trim(),
    lipSyncOffsetMs: null,
    status: "queued",
    progress: 0,
    outputUrl: null,
    createdAt: now(),
    updatedAt: now(),
    error: null,
  };

  audioJobs.set(job.jobId, job);
  simulateAudioProcessing(job.jobId, 5, (completedJob) => {
    const j = completedJob as VoiceCloneJob;
    j.lipSyncOffsetMs = 42; // stub: production measures actual A/V offset
  });
  return job;
}

/** Retrieve an audio remix job by ID. */
export function getAudioJob(jobId: string): AudioJob | undefined {
  return audioJobs.get(jobId);
}

/** List audio remix jobs, optionally filtered by videoId or type. */
export function listAudioJobs(filter?: {
  videoId?: string;
  type?: AudioJobType;
}): AudioJob[] {
  let jobs = Array.from(audioJobs.values());
  if (filter?.videoId) {
    jobs = jobs.filter((j) => j.videoId === filter.videoId);
  }
  if (filter?.type) {
    jobs = jobs.filter((j) => j.type === filter.type);
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Test helper – reset store
// ---------------------------------------------------------------------------

export function _resetAudioRemixService(): void {
  audioJobs.clear();
}
