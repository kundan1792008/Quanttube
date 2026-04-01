import { v4 as uuidv4 } from "uuid";
import {
  MediaSession,
  PlaybackMode,
  DubbingJob,
  DubbingJobStatus,
  SUPPORTED_LANGUAGES,
} from "../types";

/**
 * In-memory store for media sessions.
 * In production this would be backed by Redis or a database.
 */
const sessions = new Map<string, MediaSession>();

/**
 * In-memory store for dubbing jobs.
 */
const dubbingJobs = new Map<string, DubbingJob>();

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/** Create a new media session that intercepts and wraps a video stream. */
export function createSession(
  streamUrl: string,
  mode: PlaybackMode = PlaybackMode.Cinema
): MediaSession {
  const now = new Date().toISOString();
  const session: MediaSession = {
    sessionId: uuidv4(),
    streamUrl,
    mode,
    cacheRetained: true,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.sessionId, session);
  return session;
}

/** Retrieve an existing session by ID, or `undefined` if not found. */
export function getSession(sessionId: string): MediaSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Transition a session to a new playback mode.
 *
 * When switching to `AudioOnly` the engine drops the visual render but
 * preserves the OTT cache (`cacheRetained` stays `true`) so that the
 * user can resume video playback later without re-buffering.
 */
export function transitionMode(
  sessionId: string,
  newMode: PlaybackMode
): MediaSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  session.mode = newMode;
  session.updatedAt = new Date().toISOString();
  // Cache is always retained across transitions so that the OTT movie
  // cache is never destroyed, even during audio-only playback.
  session.cacheRetained = true;

  return session;
}

/** Delete a session. */
export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/** List all active sessions. */
export function listSessions(): MediaSession[] {
  return Array.from(sessions.values());
}

// ---------------------------------------------------------------------------
// Audio buffer extraction
// ---------------------------------------------------------------------------

export interface AudioBufferResponse {
  sessionId: string;
  format: "opus" | "aac";
  sampleRate: number;
  channels: number;
  /** Base-64 encoded audio chunk (stubbed). */
  data: string;
}

/**
 * Extract an audio buffer from the given session's stream.
 *
 * In a real implementation this would demux the video container and
 * return raw audio frames.  Here we return a stub response that
 * mirrors the expected contract.
 */
export function extractAudioBuffer(
  sessionId: string
): AudioBufferResponse | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  return {
    sessionId,
    format: "opus",
    sampleRate: 48000,
    channels: 2,
    data: "", // stub: real implementation streams audio frames
  };
}

// ---------------------------------------------------------------------------
// Deep-Dubbing ML translation queue
// ---------------------------------------------------------------------------

/** Enqueue a new dubbing job after validating the target language. */
export function createDubbingJob(
  sessionId: string,
  targetLanguage: string
): DubbingJob | { error: string } {
  if (!sessions.has(sessionId)) {
    return { error: `Session ${sessionId} not found` };
  }

  if (!SUPPORTED_LANGUAGES.includes(targetLanguage)) {
    return {
      error: `Language '${targetLanguage}' is not supported. Supported: ${SUPPORTED_LANGUAGES.length} languages.`,
    };
  }

  const now = new Date().toISOString();
  const job: DubbingJob = {
    jobId: uuidv4(),
    sessionId,
    targetLanguage,
    status: DubbingJobStatus.Queued,
    createdAt: now,
    updatedAt: now,
  };
  dubbingJobs.set(job.jobId, job);
  return job;
}

/** Get a dubbing job by ID. */
export function getDubbingJob(jobId: string): DubbingJob | undefined {
  return dubbingJobs.get(jobId);
}

/** List all dubbing jobs, optionally filtered by session. */
export function listDubbingJobs(sessionId?: string): DubbingJob[] {
  const all = Array.from(dubbingJobs.values());
  if (sessionId) return all.filter((j) => j.sessionId === sessionId);
  return all;
}

// ---------------------------------------------------------------------------
// Helpers for tests – reset stores
// ---------------------------------------------------------------------------

export function _resetStores(): void {
  sessions.clear();
  dubbingJobs.clear();
}
