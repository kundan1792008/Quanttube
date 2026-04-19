/**
 * Watch Wellbeing Service – ethical, user-controlled viewing limits.
 *
 * Gives users genuine control over their consumption:
 *   • Configurable daily watch-time limit (minutes/day)
 *   • Quiet hours (e.g. 23:00 – 07:00) during which the app refuses autoplay
 *   • Autoplay opt-out and configurable autoplay countdown
 *   • Configurable "are you still watching?" interval
 *   • Per-user watch-session log, real-time status, 7-day insights
 *
 * In-memory store; same pattern as the rest of the engine.  In production this
 * would be persisted in PostgreSQL (per the Phase-1 task in TASKS.md).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** User-configurable wellbeing preferences. */
export interface WellbeingPreferences {
  userId: string;
  /** Daily watch budget in minutes. 0 = unlimited (explicit opt-out). */
  dailyLimitMinutes: number;
  /** Quiet-hour window during which autoplay is refused. */
  quietHours: {
    enabled: boolean;
    /** Start hour, 0–23 (local clock; the client supplies its tz offset). */
    startHour: number;
    /** End hour, 0–23.  May wrap past midnight (e.g. 23 → 7). */
    endHour: number;
  };
  /** Whether autoplay-next is enabled at all. */
  autoplayEnabled: boolean;
  /** Seconds shown on the autoplay countdown before the next item plays. */
  autoplayCountdownSeconds: number;
  /** Minutes between "are you still watching?" prompts. 0 = never. */
  stillWatchingIntervalMinutes: number;
  updatedAt: string;
}

/** A recorded watch session (start + duration). */
export interface WatchSession {
  sessionId: string;
  userId: string;
  mediaId: string;
  /** ISO-8601 start time. */
  startedAt: string;
  /** Watch duration in seconds. */
  durationSeconds: number;
}

/** Real-time wellbeing status for the user. */
export interface WellbeingStatus {
  userId: string;
  /** Watched today, in seconds. */
  watchedTodaySeconds: number;
  /** Daily limit, in seconds.  null when the user opted into unlimited. */
  dailyLimitSeconds: number | null;
  /** Remaining seconds until daily limit hits, clamped at 0. null when unlimited. */
  remainingSeconds: number | null;
  /** True iff the user has reached or exceeded their daily limit. */
  limitReached: boolean;
  /** True iff the request landed inside the user's quiet-hour window. */
  inQuietHours: boolean;
  /** Whether autoplay should be permitted right now. */
  autoplayAllowed: boolean;
  /** Why autoplay is or is not allowed, in plain language. */
  autoplayReason: string;
  /** Echo of the relevant preferences for the client to render UI. */
  preferences: WellbeingPreferences;
  generatedAt: string;
}

/** Aggregated 7-day insights. */
export interface WellbeingInsights {
  userId: string;
  /** Day-by-day breakdown, oldest → newest, indexed by ISO date (YYYY-MM-DD). */
  dailyMinutes: Array<{ date: string; minutes: number }>;
  totalMinutes: number;
  averageMinutesPerDay: number;
  longestSessionMinutes: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Conservative, user-respecting defaults (60 min/day, no quiet hours, autoplay off). */
export const DEFAULT_PREFERENCES: Omit<WellbeingPreferences, "userId" | "updatedAt"> = {
  dailyLimitMinutes: 60,
  quietHours: { enabled: false, startHour: 23, endHour: 7 },
  autoplayEnabled: false,
  autoplayCountdownSeconds: 8,
  stillWatchingIntervalMinutes: 30,
};

export const MAX_DAILY_LIMIT_MINUTES = 24 * 60;
export const MAX_AUTOPLAY_COUNTDOWN_SECONDS = 60;
export const MAX_STILL_WATCHING_INTERVAL_MINUTES = 8 * 60;
export const MAX_WATCH_DURATION_SECONDS = 12 * 60 * 60;
const INSIGHTS_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const preferencesStore = new Map<string, WellbeingPreferences>();
const sessionsStore = new Map<string, WatchSession[]>();

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function buildDefaults(userId: string): WellbeingPreferences {
  return {
    userId,
    ...DEFAULT_PREFERENCES,
    quietHours: { ...DEFAULT_PREFERENCES.quietHours },
    updatedAt: new Date().toISOString(),
  };
}

/** Get preferences for a user, returning safe defaults if none have been saved. */
export function getPreferences(userId: string): WellbeingPreferences {
  const existing = preferencesStore.get(userId);
  if (existing) return existing;
  return buildDefaults(userId);
}

export interface UpdatePreferencesPatch {
  dailyLimitMinutes?: number;
  quietHours?: Partial<WellbeingPreferences["quietHours"]>;
  autoplayEnabled?: boolean;
  autoplayCountdownSeconds?: number;
  stillWatchingIntervalMinutes?: number;
}

/** Validate + apply a partial update to a user's preferences. */
export function updatePreferences(
  userId: string,
  patch: UpdatePreferencesPatch
): WellbeingPreferences | { error: string } {
  if (!userId) return { error: "userId is required" };

  const current = preferencesStore.get(userId) ?? buildDefaults(userId);
  const next: WellbeingPreferences = {
    ...current,
    quietHours: { ...current.quietHours },
  };

  if (patch.dailyLimitMinutes !== undefined) {
    if (
      !Number.isFinite(patch.dailyLimitMinutes) ||
      patch.dailyLimitMinutes < 0 ||
      patch.dailyLimitMinutes > MAX_DAILY_LIMIT_MINUTES
    ) {
      return { error: `dailyLimitMinutes must be between 0 and ${MAX_DAILY_LIMIT_MINUTES}` };
    }
    next.dailyLimitMinutes = Math.floor(patch.dailyLimitMinutes);
  }

  if (patch.autoplayEnabled !== undefined) {
    next.autoplayEnabled = Boolean(patch.autoplayEnabled);
  }

  if (patch.autoplayCountdownSeconds !== undefined) {
    if (
      !Number.isFinite(patch.autoplayCountdownSeconds) ||
      patch.autoplayCountdownSeconds < 0 ||
      patch.autoplayCountdownSeconds > MAX_AUTOPLAY_COUNTDOWN_SECONDS
    ) {
      return {
        error: `autoplayCountdownSeconds must be between 0 and ${MAX_AUTOPLAY_COUNTDOWN_SECONDS}`,
      };
    }
    next.autoplayCountdownSeconds = Math.floor(patch.autoplayCountdownSeconds);
  }

  if (patch.stillWatchingIntervalMinutes !== undefined) {
    if (
      !Number.isFinite(patch.stillWatchingIntervalMinutes) ||
      patch.stillWatchingIntervalMinutes < 0 ||
      patch.stillWatchingIntervalMinutes > MAX_STILL_WATCHING_INTERVAL_MINUTES
    ) {
      return {
        error: `stillWatchingIntervalMinutes must be between 0 and ${MAX_STILL_WATCHING_INTERVAL_MINUTES}`,
      };
    }
    next.stillWatchingIntervalMinutes = Math.floor(patch.stillWatchingIntervalMinutes);
  }

  if (patch.quietHours !== undefined) {
    const merged = { ...next.quietHours, ...patch.quietHours };
    if (!isValidHour(merged.startHour) || !isValidHour(merged.endHour)) {
      return { error: "quietHours.startHour and quietHours.endHour must be integers 0–23" };
    }
    next.quietHours = {
      enabled: Boolean(merged.enabled),
      startHour: merged.startHour,
      endHour: merged.endHour,
    };
  }

  next.updatedAt = new Date().toISOString();
  preferencesStore.set(userId, next);
  return next;
}

function isValidHour(h: unknown): h is number {
  return typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;
}

// ---------------------------------------------------------------------------
// Watch sessions
// ---------------------------------------------------------------------------

export interface RecordWatchSessionInput {
  userId: string;
  mediaId: string;
  durationSeconds: number;
  startedAt?: string;
}

let sessionCounter = 0;
function nextSessionId(): string {
  sessionCounter += 1;
  return `ws_${Date.now().toString(36)}_${sessionCounter}`;
}

/** Record a completed watch session. */
export function recordWatchSession(
  input: RecordWatchSessionInput
): WatchSession | { error: string } {
  const { userId, mediaId, durationSeconds, startedAt } = input;
  if (!userId) return { error: "userId is required" };
  if (!mediaId) return { error: "mediaId is required" };
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return { error: "durationSeconds must be a non-negative finite number" };
  }
  if (durationSeconds > MAX_WATCH_DURATION_SECONDS) {
    return { error: `durationSeconds must be at most ${MAX_WATCH_DURATION_SECONDS}` };
  }
  if (startedAt !== undefined && Number.isNaN(Date.parse(startedAt))) {
    return { error: "startedAt must be an ISO-8601 timestamp" };
  }

  const session: WatchSession = {
    sessionId: nextSessionId(),
    userId,
    mediaId,
    startedAt: startedAt ?? new Date().toISOString(),
    durationSeconds: Math.floor(durationSeconds),
  };

  const list = sessionsStore.get(userId) ?? [];
  list.push(session);
  sessionsStore.set(userId, list);
  return session;
}

/** Get all watch sessions for a user (most recent last). */
export function getWatchSessions(userId: string): WatchSession[] {
  return sessionsStore.get(userId) ?? [];
}

// ---------------------------------------------------------------------------
// Status + insights
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function watchedSecondsOnDate(userId: string, date: Date): number {
  const target = isoDate(date);
  const sessions = sessionsStore.get(userId) ?? [];
  let total = 0;
  for (const s of sessions) {
    const sessionDate = new Date(s.startedAt);
    if (Number.isNaN(sessionDate.getTime())) continue;
    if (isoDate(sessionDate) === target) total += s.durationSeconds;
  }
  return total;
}

/**
 * Determine whether `hour` falls inside the [start, end) window.
 * The window may wrap past midnight (e.g. 23 → 7 includes 0,1,...,6 and 23).
 */
function hourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  // wraps midnight
  return hour >= startHour || hour < endHour;
}

/** Compute the user's current wellbeing status. `now` is injectable for testing. */
export function getStatus(userId: string, now: Date = new Date()): WellbeingStatus {
  const prefs = getPreferences(userId);
  const watchedToday = watchedSecondsOnDate(userId, now);

  const dailyLimitSeconds = prefs.dailyLimitMinutes > 0 ? prefs.dailyLimitMinutes * 60 : null;
  const limitReached = dailyLimitSeconds !== null && watchedToday >= dailyLimitSeconds;
  const remainingSeconds =
    dailyLimitSeconds === null ? null : Math.max(0, dailyLimitSeconds - watchedToday);

  const inQuietHours =
    prefs.quietHours.enabled &&
    hourInWindow(now.getHours(), prefs.quietHours.startHour, prefs.quietHours.endHour);

  let autoplayAllowed = true;
  let autoplayReason = "Autoplay allowed.";
  if (!prefs.autoplayEnabled) {
    autoplayAllowed = false;
    autoplayReason = "Autoplay is disabled in your preferences.";
  } else if (limitReached) {
    autoplayAllowed = false;
    autoplayReason = "You have reached your daily watch limit.";
  } else if (inQuietHours) {
    autoplayAllowed = false;
    autoplayReason = "Quiet hours are active.";
  }

  return {
    userId,
    watchedTodaySeconds: watchedToday,
    dailyLimitSeconds,
    remainingSeconds,
    limitReached,
    inQuietHours,
    autoplayAllowed,
    autoplayReason,
    preferences: prefs,
    generatedAt: now.toISOString(),
  };
}

/** Compute 7-day insights ending at `now` (inclusive). */
export function getInsights(userId: string, now: Date = new Date()): WellbeingInsights {
  const dailyMinutes: Array<{ date: string; minutes: number }> = [];
  for (let i = INSIGHTS_WINDOW_DAYS - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const seconds = watchedSecondsOnDate(userId, day);
    dailyMinutes.push({ date: isoDate(day), minutes: Math.round(seconds / 60) });
  }

  const totalMinutes = dailyMinutes.reduce((sum, d) => sum + d.minutes, 0);
  const averageMinutesPerDay = Math.round(totalMinutes / INSIGHTS_WINDOW_DAYS);

  const sessions = sessionsStore.get(userId) ?? [];
  const longestSeconds = sessions.reduce((max, s) => Math.max(max, s.durationSeconds), 0);
  const longestSessionMinutes = Math.round(longestSeconds / 60);

  return {
    userId,
    dailyMinutes,
    totalMinutes,
    averageMinutesPerDay,
    longestSessionMinutes,
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetWellbeing(): void {
  preferencesStore.clear();
  sessionsStore.clear();
  sessionCounter = 0;
}
