import { v4 as uuidv4 } from "uuid";
import {
  MediaSession,
  PlaybackMode,
  DubbingJob,
  DubbingJobStatus,
  DEFAULT_DUB_LANGUAGES,
  SUPPORTED_LANGUAGES,
  ReelShare,
  CreateReelShareRequest,
  DeepLinkPlatform,
  RegisterDeepLinkClickRequest,
  AvatarDashboardState,
  AvatarPressureState,
  GroupMemberShareState,
  FomoPayload,
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

/**
 * In-memory store for Quantchat reel shares with FOMO payload.
 */
const reelShares = new Map<string, ReelShare>();

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
    syncOffsetMs: undefined,
  };
  dubbingJobs.set(job.jobId, job);
  return job;
}

/**
 * Batch-enqueue dubbing jobs for a list of languages.
 *
 * Used when a video is uploaded: automatically creates one job per
 * language so the pipeline can transcribe, translate, and dub the
 * content into all target languages in parallel.
 *
 * Defaults to `DEFAULT_DUB_LANGUAGES` when no languages are provided.
 */
export function batchCreateDubbingJobs(
  sessionId: string,
  languages?: string[]
): Array<DubbingJob | { error: string; language: string }> {
  const targets = languages && languages.length > 0 ? languages : DEFAULT_DUB_LANGUAGES;
  return targets.map((lang) => {
    const result = createDubbingJob(sessionId, lang);
    if ("error" in result) return { ...result, language: lang };
    return result;
  });
}

/**
 * Update the status of a dubbing job and record the final lip-sync
 * offset when the job reaches `completed` state.
 *
 * `syncOffsetMs` should be < 100 for a production-quality dub.
 */
export function updateDubbingJobStatus(
  jobId: string,
  status: DubbingJobStatus,
  syncOffsetMs?: number
): DubbingJob | undefined {
  const job = dubbingJobs.get(jobId);
  if (!job) return undefined;

  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (syncOffsetMs !== undefined) {
    job.syncOffsetMs = syncOffsetMs;
  }
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
// Quantchat Reels sharing + deep links + Quantsink social pressure
// ---------------------------------------------------------------------------

const GRAY_AVATAR_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_FOMO_WINDOW_SECONDS = 300;

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function formatPressureWindow(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds / 60 === 1 ? "" : "s"}`;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function computeAvatarState(share: ReelShare, member: GroupMemberShareState): AvatarPressureState {
  if (member.clickedAt) return AvatarPressureState.Active;
  const triggerMs = Date.parse(share.fomoPayload.triggerAt);
  if (Date.now() >= triggerMs) return AvatarPressureState.Gray;
  return AvatarPressureState.Pending;
}

function buildDeepLinks(shareId: string): Record<DeepLinkPlatform, string> {
  const encodedShareId = encodeURIComponent(shareId);
  return {
    [DeepLinkPlatform.IOS]: `quanttube://reels/share/${encodedShareId}?platform=ios`,
    [DeepLinkPlatform.Android]: `quanttube://reels/share/${encodedShareId}?platform=android`,
    [DeepLinkPlatform.Web]: `https://quanttube.app/reels/share/${encodedShareId}?platform=web`,
  };
}

/** Create a Quantchat reel share wrapped in a FOMO payload. */
export function createReelShare(payload: CreateReelShareRequest): ReelShare | { error: string } {
  const { reelId, groupId, sharedBy, memberIds, pressureWindowSeconds } = payload;
  if (!reelId || !groupId || !sharedBy) {
    return { error: "reelId, groupId and sharedBy are required" };
  }
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return { error: "memberIds must contain at least one member" };
  }

  const uniqueMembers = Array.from(
    new Set(
      memberIds
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter(Boolean)
    )
  );

  if (uniqueMembers.length === 0) {
    return { error: "memberIds must contain at least one non-empty member id" };
  }

  const requestedWindowSeconds =
    typeof pressureWindowSeconds === "number" ? pressureWindowSeconds : DEFAULT_FOMO_WINDOW_SECONDS;
  if (!Number.isFinite(requestedWindowSeconds) || requestedWindowSeconds <= 0) {
    return { error: "pressureWindowSeconds must be a positive number when provided" };
  }

  const normalizedWindowSeconds = Math.floor(requestedWindowSeconds);
  const fomoWindowMs = normalizedWindowSeconds * 1000;
  const nowMs = Date.now();
  const shareId = uuidv4();
  const triggerAt = nowMs + fomoWindowMs;
  const fomoPayload: FomoPayload = {
    label: "FOMO_PAYLOAD",
    pressureWindowSeconds: normalizedWindowSeconds,
    triggerAt: toIso(triggerAt),
    expiresAt: toIso(triggerAt + GRAY_AVATAR_DURATION_MS),
    message: `Open this reel in ${formatPressureWindow(normalizedWindowSeconds)} or your Quantsink avatar turns gray temporarily.`,
  };

  const share: ReelShare = {
    shareId,
    reelId,
    groupId,
    sharedBy,
    memberStates: uniqueMembers.map((memberId) => ({
      memberId,
      clickedAt: null,
      clickedPlatform: null,
    })),
    deepLinks: buildDeepLinks(shareId),
    fomoPayload,
    createdAt: toIso(nowMs),
    updatedAt: toIso(nowMs),
  };

  reelShares.set(shareId, share);
  return share;
}

/** Get a reel share by ID. */
export function getReelShare(shareId: string): ReelShare | undefined {
  return reelShares.get(shareId);
}

/** List reel shares, optionally filtered by group ID. */
export function listReelShares(groupId?: string): ReelShare[] {
  const all = Array.from(reelShares.values());
  if (groupId) return all.filter((s) => s.groupId === groupId);
  return all;
}

/** Register a deep-link click for a member and platform. */
export function registerReelShareClick(
  shareId: string,
  payload: RegisterDeepLinkClickRequest
): ReelShare | { error: string } {
  const share = reelShares.get(shareId);
  if (!share) return { error: "Reel share not found" };

  const { memberId, platform } = payload;
  if (!memberId || !platform) {
    return { error: "memberId and platform are required" };
  }
  if (!Object.values(DeepLinkPlatform).includes(platform)) {
    return { error: `platform must be one of: ${Object.values(DeepLinkPlatform).join(", ")}` };
  }

  const member = share.memberStates.find((m) => m.memberId === memberId);
  if (!member) return { error: `Member ${memberId} is not part of this share` };

  const now = new Date().toISOString();
  member.clickedAt = now;
  member.clickedPlatform = platform;
  share.updatedAt = now;
  return share;
}

/** Get Quantsink avatar states for a group across all active shares. */
export function getAvatarDashboardStates(groupId: string): AvatarDashboardState[] {
  const shares = listReelShares(groupId);
  if (shares.length === 0) return [];

  const memberAccumulator = new Map<
    string,
    { lastClickAt: string | null; pendingShareCount: number; grayShareCount: number }
  >();

  for (const share of shares) {
    for (const member of share.memberStates) {
      const avatarState = computeAvatarState(share, member);
      const current = memberAccumulator.get(member.memberId) ?? {
        lastClickAt: null,
        pendingShareCount: 0,
        grayShareCount: 0,
      };

      if (avatarState === AvatarPressureState.Pending) current.pendingShareCount += 1;
      if (avatarState === AvatarPressureState.Gray) current.grayShareCount += 1;
      if (member.clickedAt && (!current.lastClickAt || member.clickedAt > current.lastClickAt)) {
        current.lastClickAt = member.clickedAt;
      }

      memberAccumulator.set(member.memberId, current);
    }
  }

  return Array.from(memberAccumulator.entries()).map(([memberId, acc]) => {
    const avatarState =
      acc.grayShareCount > 0
        ? AvatarPressureState.Gray
        : acc.pendingShareCount > 0
          ? AvatarPressureState.Pending
          : AvatarPressureState.Active;
    return {
      memberId,
      avatarState,
      lastClickAt: acc.lastClickAt,
      pendingShareCount: acc.pendingShareCount,
      grayShareCount: acc.grayShareCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers for tests – reset stores
// ---------------------------------------------------------------------------

export function _resetStores(): void {
  sessions.clear();
  dubbingJobs.clear();
  reelShares.clear();
}
