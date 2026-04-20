export type SessionRewardTier = "starter" | "engaged" | "premium" | "exclusive";

export interface SessionDepthState {
  sessionId: string;
  startedAt: string;
  lastEventAt: string;
  depthPoints: number;
  watchSeconds: number;
  completedItems: number;
  skips: number;
  tier: SessionRewardTier;
}

export interface SessionDepthEvent {
  watchedSeconds: number;
  completedItem?: boolean;
  skippedItem?: boolean;
}

export interface SessionDepthRecommendationSignal {
  tier: SessionRewardTier;
  premiumWeight: number;
  exploreWeight: number;
  continuityWeight: number;
}

const TIER_THRESHOLDS: Array<{ tier: SessionRewardTier; minDepthPoints: number }> = [
  { tier: "exclusive", minDepthPoints: 90 },
  { tier: "premium", minDepthPoints: 55 },
  { tier: "engaged", minDepthPoints: 25 },
  { tier: "starter", minDepthPoints: 0 },
];

function resolveTier(depthPoints: number): SessionRewardTier {
  for (const threshold of TIER_THRESHOLDS) {
    if (depthPoints >= threshold.minDepthPoints) return threshold.tier;
  }
  return "starter";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createSessionDepthState(sessionId: string, startedAt = nowIso()): SessionDepthState {
  return {
    sessionId,
    startedAt,
    lastEventAt: startedAt,
    depthPoints: 0,
    watchSeconds: 0,
    completedItems: 0,
    skips: 0,
    tier: "starter",
  };
}

export function applySessionDepthEvent(
  state: SessionDepthState,
  event: SessionDepthEvent,
  timestamp = nowIso()
): SessionDepthState {
  const safeWatchSeconds = Number.isFinite(event.watchedSeconds)
    ? Math.max(0, Math.floor(event.watchedSeconds))
    : 0;

  const completionBonus = event.completedItem ? 8 : 0;
  const skipPenalty = event.skippedItem ? 6 : 0;
  const watchPoints = Math.min(15, Math.floor(safeWatchSeconds / 30) * 2);

  state.watchSeconds += safeWatchSeconds;
  state.completedItems += event.completedItem ? 1 : 0;
  state.skips += event.skippedItem ? 1 : 0;
  state.depthPoints = Math.max(0, state.depthPoints + watchPoints + completionBonus - skipPenalty);
  state.tier = resolveTier(state.depthPoints);
  state.lastEventAt = timestamp;

  return state;
}

export function buildSessionDepthRecommendationSignal(
  state: SessionDepthState
): SessionDepthRecommendationSignal {
  switch (state.tier) {
    case "exclusive":
      return { tier: state.tier, premiumWeight: 0.8, exploreWeight: 0.15, continuityWeight: 0.95 };
    case "premium":
      return { tier: state.tier, premiumWeight: 0.62, exploreWeight: 0.25, continuityWeight: 0.84 };
    case "engaged":
      return { tier: state.tier, premiumWeight: 0.4, exploreWeight: 0.4, continuityWeight: 0.72 };
    case "starter":
    default:
      return { tier: state.tier, premiumWeight: 0.2, exploreWeight: 0.55, continuityWeight: 0.58 };
  }
}
