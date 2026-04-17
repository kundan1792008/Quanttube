import { createHash, randomUUID } from "crypto";

export interface ExitIntentEvent {
  userId: string;
  sessionId: string;
  occurredAt: string;
  reason:
    | "cursor_leave_top"
    | "tab_blur"
    | "idle_spike"
    | "back_button_tap"
    | "app_minimize"
    | "swipe_dismiss"
    | "close_shortcut"
    | "network_drop_intent"
    | "rage_scroll"
    | "seek_abandon"
    | "low_volume_idle"
    | "payment_hesitation"
    | "search_bounce"
    | "playlist_dropout"
    | "ad_skip_exit";
  viewportWidth: number;
  viewportHeight: number;
  currentlyPlayingAssetId: string;
  currentProgressRatio: number;
}

export interface ReplacementCandidate {
  assetId: string;
  title: string;
  teaserUrl: string;
  thumbnailUrl: string;
  tags: string[];
  durationMs: number;
  recencyScore: number;
  engagementScore: number;
}

export interface ExitInterceptionDecision {
  decisionId: string;
  userId: string;
  sessionId: string;
  shouldIntercept: boolean;
  triggerStrength: number;
  selectedAsset: ReplacementCandidate | null;
  strategy: string;
  message: string;
  generatedAt: string;
}

interface ExitRule {
  ruleId: string;
  reason: ExitIntentEvent["reason"];
  narrativeAngle: string;
  strategy: string;
  baseScore: number;
}

const EXIT_RULES: readonly ExitRule[] = [
  { ruleId: "rule-001", reason: "cursor_leave_top", narrativeAngle: "high-drama-clip", strategy: "thumbnail-boost", baseScore: 0.2 },
  { ruleId: "rule-002", reason: "tab_blur", narrativeAngle: "comedic-reset", strategy: "countdown-card", baseScore: 0.3 },
  { ruleId: "rule-003", reason: "idle_spike", narrativeAngle: "creator-behind-scenes", strategy: "social-proof-badge", baseScore: 0.4 },
  { ruleId: "rule-004", reason: "back_button_tap", narrativeAngle: "live-reaction", strategy: "streak-preserver", baseScore: 0.5 },
  { ruleId: "rule-005", reason: "app_minimize", narrativeAngle: "micro-documentary", strategy: "one-tap-resume", baseScore: 0.6 },
  { ruleId: "rule-006", reason: "swipe_dismiss", narrativeAngle: "soundtrack-preview", strategy: "ai-next-best", baseScore: 0.7 },
  { ruleId: "rule-007", reason: "close_shortcut", narrativeAngle: "chapter-recap", strategy: "voiceover-tease", baseScore: 0.8 },
  { ruleId: "rule-008", reason: "network_drop_intent", narrativeAngle: "fan-edit-highlight", strategy: "ultra-short-teaser", baseScore: 0.9 },
  { ruleId: "rule-009", reason: "rage_scroll", narrativeAngle: "language-dub-sample", strategy: "watch-party-invite", baseScore: 1.0 },
  { ruleId: "rule-010", reason: "seek_abandon", narrativeAngle: "interactive-choice-hook", strategy: "creator-message", baseScore: 1.1 },
  { ruleId: "rule-011", reason: "low_volume_idle", narrativeAngle: "trending-moment", strategy: "time-aware-slot", baseScore: 0.1 },
  { ruleId: "rule-012", reason: "payment_hesitation", narrativeAngle: "nostalgia-rewind", strategy: "genre-pivot", baseScore: 0.2 },
  { ruleId: "rule-013", reason: "search_bounce", narrativeAngle: "new-episode-trailer", strategy: "language-personalization", baseScore: 0.3 },
  { ruleId: "rule-014", reason: "playlist_dropout", narrativeAngle: "podcast-crossover", strategy: "thumbnail-boost", baseScore: 0.4 },
  { ruleId: "rule-015", reason: "ad_skip_exit", narrativeAngle: "community-spotlight", strategy: "countdown-card", baseScore: 0.5 },
  { ruleId: "rule-016", reason: "cursor_leave_top", narrativeAngle: "mini-masterclass", strategy: "social-proof-badge", baseScore: 0.6 },
  { ruleId: "rule-017", reason: "tab_blur", narrativeAngle: "high-drama-clip", strategy: "streak-preserver", baseScore: 0.7 },
  { ruleId: "rule-018", reason: "idle_spike", narrativeAngle: "comedic-reset", strategy: "one-tap-resume", baseScore: 0.8 },
  { ruleId: "rule-019", reason: "back_button_tap", narrativeAngle: "creator-behind-scenes", strategy: "ai-next-best", baseScore: 0.9 },
  { ruleId: "rule-020", reason: "app_minimize", narrativeAngle: "live-reaction", strategy: "voiceover-tease", baseScore: 1.0 },
  { ruleId: "rule-021", reason: "swipe_dismiss", narrativeAngle: "micro-documentary", strategy: "ultra-short-teaser", baseScore: 1.1 },
  { ruleId: "rule-022", reason: "close_shortcut", narrativeAngle: "soundtrack-preview", strategy: "watch-party-invite", baseScore: 0.1 },
  { ruleId: "rule-023", reason: "network_drop_intent", narrativeAngle: "chapter-recap", strategy: "creator-message", baseScore: 0.2 },
  { ruleId: "rule-024", reason: "rage_scroll", narrativeAngle: "fan-edit-highlight", strategy: "time-aware-slot", baseScore: 0.3 },
  { ruleId: "rule-025", reason: "seek_abandon", narrativeAngle: "language-dub-sample", strategy: "genre-pivot", baseScore: 0.4 },
  { ruleId: "rule-026", reason: "low_volume_idle", narrativeAngle: "interactive-choice-hook", strategy: "language-personalization", baseScore: 0.5 },
  { ruleId: "rule-027", reason: "payment_hesitation", narrativeAngle: "trending-moment", strategy: "thumbnail-boost", baseScore: 0.6 },
  { ruleId: "rule-028", reason: "search_bounce", narrativeAngle: "nostalgia-rewind", strategy: "countdown-card", baseScore: 0.7 },
  { ruleId: "rule-029", reason: "playlist_dropout", narrativeAngle: "new-episode-trailer", strategy: "social-proof-badge", baseScore: 0.8 },
  { ruleId: "rule-030", reason: "ad_skip_exit", narrativeAngle: "podcast-crossover", strategy: "streak-preserver", baseScore: 0.9 },
  { ruleId: "rule-031", reason: "cursor_leave_top", narrativeAngle: "community-spotlight", strategy: "one-tap-resume", baseScore: 1.0 },
  { ruleId: "rule-032", reason: "tab_blur", narrativeAngle: "mini-masterclass", strategy: "ai-next-best", baseScore: 1.1 },
  { ruleId: "rule-033", reason: "idle_spike", narrativeAngle: "high-drama-clip", strategy: "voiceover-tease", baseScore: 0.1 },
  { ruleId: "rule-034", reason: "back_button_tap", narrativeAngle: "comedic-reset", strategy: "ultra-short-teaser", baseScore: 0.2 },
  { ruleId: "rule-035", reason: "app_minimize", narrativeAngle: "creator-behind-scenes", strategy: "watch-party-invite", baseScore: 0.3 },
  { ruleId: "rule-036", reason: "swipe_dismiss", narrativeAngle: "live-reaction", strategy: "creator-message", baseScore: 0.4 },
  { ruleId: "rule-037", reason: "close_shortcut", narrativeAngle: "micro-documentary", strategy: "time-aware-slot", baseScore: 0.5 },
  { ruleId: "rule-038", reason: "network_drop_intent", narrativeAngle: "soundtrack-preview", strategy: "genre-pivot", baseScore: 0.6 },
  { ruleId: "rule-039", reason: "rage_scroll", narrativeAngle: "chapter-recap", strategy: "language-personalization", baseScore: 0.7 },
  { ruleId: "rule-040", reason: "seek_abandon", narrativeAngle: "fan-edit-highlight", strategy: "thumbnail-boost", baseScore: 0.8 },
  { ruleId: "rule-041", reason: "low_volume_idle", narrativeAngle: "language-dub-sample", strategy: "countdown-card", baseScore: 0.9 },
  { ruleId: "rule-042", reason: "payment_hesitation", narrativeAngle: "interactive-choice-hook", strategy: "social-proof-badge", baseScore: 1.0 },
  { ruleId: "rule-043", reason: "search_bounce", narrativeAngle: "trending-moment", strategy: "streak-preserver", baseScore: 1.1 },
  { ruleId: "rule-044", reason: "playlist_dropout", narrativeAngle: "nostalgia-rewind", strategy: "one-tap-resume", baseScore: 0.1 },
  { ruleId: "rule-045", reason: "ad_skip_exit", narrativeAngle: "new-episode-trailer", strategy: "ai-next-best", baseScore: 0.2 },
  { ruleId: "rule-046", reason: "cursor_leave_top", narrativeAngle: "podcast-crossover", strategy: "voiceover-tease", baseScore: 0.3 },
  { ruleId: "rule-047", reason: "tab_blur", narrativeAngle: "community-spotlight", strategy: "ultra-short-teaser", baseScore: 0.4 },
  { ruleId: "rule-048", reason: "idle_spike", narrativeAngle: "mini-masterclass", strategy: "watch-party-invite", baseScore: 0.5 },
  { ruleId: "rule-049", reason: "back_button_tap", narrativeAngle: "high-drama-clip", strategy: "creator-message", baseScore: 0.6 },
  { ruleId: "rule-050", reason: "app_minimize", narrativeAngle: "comedic-reset", strategy: "time-aware-slot", baseScore: 0.7 },
  { ruleId: "rule-051", reason: "swipe_dismiss", narrativeAngle: "creator-behind-scenes", strategy: "genre-pivot", baseScore: 0.8 },
  { ruleId: "rule-052", reason: "close_shortcut", narrativeAngle: "live-reaction", strategy: "language-personalization", baseScore: 0.9 },
  { ruleId: "rule-053", reason: "network_drop_intent", narrativeAngle: "micro-documentary", strategy: "thumbnail-boost", baseScore: 1.0 },
  { ruleId: "rule-054", reason: "rage_scroll", narrativeAngle: "soundtrack-preview", strategy: "countdown-card", baseScore: 1.1 },
  { ruleId: "rule-055", reason: "seek_abandon", narrativeAngle: "chapter-recap", strategy: "social-proof-badge", baseScore: 0.1 },
  { ruleId: "rule-056", reason: "low_volume_idle", narrativeAngle: "fan-edit-highlight", strategy: "streak-preserver", baseScore: 0.2 },
  { ruleId: "rule-057", reason: "payment_hesitation", narrativeAngle: "language-dub-sample", strategy: "one-tap-resume", baseScore: 0.3 },
  { ruleId: "rule-058", reason: "search_bounce", narrativeAngle: "interactive-choice-hook", strategy: "ai-next-best", baseScore: 0.4 },
  { ruleId: "rule-059", reason: "playlist_dropout", narrativeAngle: "trending-moment", strategy: "voiceover-tease", baseScore: 0.5 },
  { ruleId: "rule-060", reason: "ad_skip_exit", narrativeAngle: "nostalgia-rewind", strategy: "ultra-short-teaser", baseScore: 0.6 },
  { ruleId: "rule-061", reason: "cursor_leave_top", narrativeAngle: "new-episode-trailer", strategy: "watch-party-invite", baseScore: 0.7 },
  { ruleId: "rule-062", reason: "tab_blur", narrativeAngle: "podcast-crossover", strategy: "creator-message", baseScore: 0.8 },
  { ruleId: "rule-063", reason: "idle_spike", narrativeAngle: "community-spotlight", strategy: "time-aware-slot", baseScore: 0.9 },
  { ruleId: "rule-064", reason: "back_button_tap", narrativeAngle: "mini-masterclass", strategy: "genre-pivot", baseScore: 1.0 },
  { ruleId: "rule-065", reason: "app_minimize", narrativeAngle: "high-drama-clip", strategy: "language-personalization", baseScore: 1.1 },
  { ruleId: "rule-066", reason: "swipe_dismiss", narrativeAngle: "comedic-reset", strategy: "thumbnail-boost", baseScore: 0.1 },
  { ruleId: "rule-067", reason: "close_shortcut", narrativeAngle: "creator-behind-scenes", strategy: "countdown-card", baseScore: 0.2 },
  { ruleId: "rule-068", reason: "network_drop_intent", narrativeAngle: "live-reaction", strategy: "social-proof-badge", baseScore: 0.3 },
  { ruleId: "rule-069", reason: "rage_scroll", narrativeAngle: "micro-documentary", strategy: "streak-preserver", baseScore: 0.4 },
  { ruleId: "rule-070", reason: "seek_abandon", narrativeAngle: "soundtrack-preview", strategy: "one-tap-resume", baseScore: 0.5 },
  { ruleId: "rule-071", reason: "low_volume_idle", narrativeAngle: "chapter-recap", strategy: "ai-next-best", baseScore: 0.6 },
  { ruleId: "rule-072", reason: "payment_hesitation", narrativeAngle: "fan-edit-highlight", strategy: "voiceover-tease", baseScore: 0.7 },
  { ruleId: "rule-073", reason: "search_bounce", narrativeAngle: "language-dub-sample", strategy: "ultra-short-teaser", baseScore: 0.8 },
  { ruleId: "rule-074", reason: "playlist_dropout", narrativeAngle: "interactive-choice-hook", strategy: "watch-party-invite", baseScore: 0.9 },
  { ruleId: "rule-075", reason: "ad_skip_exit", narrativeAngle: "trending-moment", strategy: "creator-message", baseScore: 1.0 },
  { ruleId: "rule-076", reason: "cursor_leave_top", narrativeAngle: "nostalgia-rewind", strategy: "time-aware-slot", baseScore: 1.1 },
  { ruleId: "rule-077", reason: "tab_blur", narrativeAngle: "new-episode-trailer", strategy: "genre-pivot", baseScore: 0.1 },
  { ruleId: "rule-078", reason: "idle_spike", narrativeAngle: "podcast-crossover", strategy: "language-personalization", baseScore: 0.2 },
  { ruleId: "rule-079", reason: "back_button_tap", narrativeAngle: "community-spotlight", strategy: "thumbnail-boost", baseScore: 0.3 },
  { ruleId: "rule-080", reason: "app_minimize", narrativeAngle: "mini-masterclass", strategy: "countdown-card", baseScore: 0.4 },
  { ruleId: "rule-081", reason: "swipe_dismiss", narrativeAngle: "high-drama-clip", strategy: "social-proof-badge", baseScore: 0.5 },
  { ruleId: "rule-082", reason: "close_shortcut", narrativeAngle: "comedic-reset", strategy: "streak-preserver", baseScore: 0.6 },
  { ruleId: "rule-083", reason: "network_drop_intent", narrativeAngle: "creator-behind-scenes", strategy: "one-tap-resume", baseScore: 0.7 },
  { ruleId: "rule-084", reason: "rage_scroll", narrativeAngle: "live-reaction", strategy: "ai-next-best", baseScore: 0.8 },
  { ruleId: "rule-085", reason: "seek_abandon", narrativeAngle: "micro-documentary", strategy: "voiceover-tease", baseScore: 0.9 },
  { ruleId: "rule-086", reason: "low_volume_idle", narrativeAngle: "soundtrack-preview", strategy: "ultra-short-teaser", baseScore: 1.0 },
  { ruleId: "rule-087", reason: "payment_hesitation", narrativeAngle: "chapter-recap", strategy: "watch-party-invite", baseScore: 1.1 },
  { ruleId: "rule-088", reason: "search_bounce", narrativeAngle: "fan-edit-highlight", strategy: "creator-message", baseScore: 0.1 },
  { ruleId: "rule-089", reason: "playlist_dropout", narrativeAngle: "language-dub-sample", strategy: "time-aware-slot", baseScore: 0.2 },
  { ruleId: "rule-090", reason: "ad_skip_exit", narrativeAngle: "interactive-choice-hook", strategy: "genre-pivot", baseScore: 0.3 },
  { ruleId: "rule-091", reason: "cursor_leave_top", narrativeAngle: "trending-moment", strategy: "language-personalization", baseScore: 0.4 },
  { ruleId: "rule-092", reason: "tab_blur", narrativeAngle: "nostalgia-rewind", strategy: "thumbnail-boost", baseScore: 0.5 },
  { ruleId: "rule-093", reason: "idle_spike", narrativeAngle: "new-episode-trailer", strategy: "countdown-card", baseScore: 0.6 },
  { ruleId: "rule-094", reason: "back_button_tap", narrativeAngle: "podcast-crossover", strategy: "social-proof-badge", baseScore: 0.7 },
  { ruleId: "rule-095", reason: "app_minimize", narrativeAngle: "community-spotlight", strategy: "streak-preserver", baseScore: 0.8 },
  { ruleId: "rule-096", reason: "swipe_dismiss", narrativeAngle: "mini-masterclass", strategy: "one-tap-resume", baseScore: 0.9 },
  { ruleId: "rule-097", reason: "close_shortcut", narrativeAngle: "high-drama-clip", strategy: "ai-next-best", baseScore: 1.0 },
  { ruleId: "rule-098", reason: "network_drop_intent", narrativeAngle: "comedic-reset", strategy: "voiceover-tease", baseScore: 1.1 },
  { ruleId: "rule-099", reason: "rage_scroll", narrativeAngle: "creator-behind-scenes", strategy: "ultra-short-teaser", baseScore: 0.1 },
  { ruleId: "rule-100", reason: "seek_abandon", narrativeAngle: "live-reaction", strategy: "watch-party-invite", baseScore: 0.2 },
  { ruleId: "rule-101", reason: "low_volume_idle", narrativeAngle: "micro-documentary", strategy: "creator-message", baseScore: 0.3 },
  { ruleId: "rule-102", reason: "payment_hesitation", narrativeAngle: "soundtrack-preview", strategy: "time-aware-slot", baseScore: 0.4 },
  { ruleId: "rule-103", reason: "search_bounce", narrativeAngle: "chapter-recap", strategy: "genre-pivot", baseScore: 0.5 },
  { ruleId: "rule-104", reason: "playlist_dropout", narrativeAngle: "fan-edit-highlight", strategy: "language-personalization", baseScore: 0.6 },
  { ruleId: "rule-105", reason: "ad_skip_exit", narrativeAngle: "language-dub-sample", strategy: "thumbnail-boost", baseScore: 0.7 },
  { ruleId: "rule-106", reason: "cursor_leave_top", narrativeAngle: "interactive-choice-hook", strategy: "countdown-card", baseScore: 0.8 },
  { ruleId: "rule-107", reason: "tab_blur", narrativeAngle: "trending-moment", strategy: "social-proof-badge", baseScore: 0.9 },
  { ruleId: "rule-108", reason: "idle_spike", narrativeAngle: "nostalgia-rewind", strategy: "streak-preserver", baseScore: 1.0 },
  { ruleId: "rule-109", reason: "back_button_tap", narrativeAngle: "new-episode-trailer", strategy: "one-tap-resume", baseScore: 1.1 },
  { ruleId: "rule-110", reason: "app_minimize", narrativeAngle: "podcast-crossover", strategy: "ai-next-best", baseScore: 0.1 },
  { ruleId: "rule-111", reason: "swipe_dismiss", narrativeAngle: "community-spotlight", strategy: "voiceover-tease", baseScore: 0.2 },
  { ruleId: "rule-112", reason: "close_shortcut", narrativeAngle: "mini-masterclass", strategy: "ultra-short-teaser", baseScore: 0.3 },
  { ruleId: "rule-113", reason: "network_drop_intent", narrativeAngle: "high-drama-clip", strategy: "watch-party-invite", baseScore: 0.4 },
  { ruleId: "rule-114", reason: "rage_scroll", narrativeAngle: "comedic-reset", strategy: "creator-message", baseScore: 0.5 },
  { ruleId: "rule-115", reason: "seek_abandon", narrativeAngle: "creator-behind-scenes", strategy: "time-aware-slot", baseScore: 0.6 },
  { ruleId: "rule-116", reason: "low_volume_idle", narrativeAngle: "live-reaction", strategy: "genre-pivot", baseScore: 0.7 },
  { ruleId: "rule-117", reason: "payment_hesitation", narrativeAngle: "micro-documentary", strategy: "language-personalization", baseScore: 0.8 },
  { ruleId: "rule-118", reason: "search_bounce", narrativeAngle: "soundtrack-preview", strategy: "thumbnail-boost", baseScore: 0.9 },
  { ruleId: "rule-119", reason: "playlist_dropout", narrativeAngle: "chapter-recap", strategy: "countdown-card", baseScore: 1.0 },
  { ruleId: "rule-120", reason: "ad_skip_exit", narrativeAngle: "fan-edit-highlight", strategy: "social-proof-badge", baseScore: 1.1 },
  { ruleId: "rule-121", reason: "cursor_leave_top", narrativeAngle: "language-dub-sample", strategy: "streak-preserver", baseScore: 0.1 },
  { ruleId: "rule-122", reason: "tab_blur", narrativeAngle: "interactive-choice-hook", strategy: "one-tap-resume", baseScore: 0.2 },
  { ruleId: "rule-123", reason: "idle_spike", narrativeAngle: "trending-moment", strategy: "ai-next-best", baseScore: 0.3 },
  { ruleId: "rule-124", reason: "back_button_tap", narrativeAngle: "nostalgia-rewind", strategy: "voiceover-tease", baseScore: 0.4 },
  { ruleId: "rule-125", reason: "app_minimize", narrativeAngle: "new-episode-trailer", strategy: "ultra-short-teaser", baseScore: 0.5 },
  { ruleId: "rule-126", reason: "swipe_dismiss", narrativeAngle: "podcast-crossover", strategy: "watch-party-invite", baseScore: 0.6 },
  { ruleId: "rule-127", reason: "close_shortcut", narrativeAngle: "community-spotlight", strategy: "creator-message", baseScore: 0.7 },
  { ruleId: "rule-128", reason: "network_drop_intent", narrativeAngle: "mini-masterclass", strategy: "time-aware-slot", baseScore: 0.8 },
  { ruleId: "rule-129", reason: "rage_scroll", narrativeAngle: "high-drama-clip", strategy: "genre-pivot", baseScore: 0.9 },
  { ruleId: "rule-130", reason: "seek_abandon", narrativeAngle: "comedic-reset", strategy: "language-personalization", baseScore: 1.0 },
  { ruleId: "rule-131", reason: "low_volume_idle", narrativeAngle: "creator-behind-scenes", strategy: "thumbnail-boost", baseScore: 1.1 },
  { ruleId: "rule-132", reason: "payment_hesitation", narrativeAngle: "live-reaction", strategy: "countdown-card", baseScore: 0.1 },
  { ruleId: "rule-133", reason: "search_bounce", narrativeAngle: "micro-documentary", strategy: "social-proof-badge", baseScore: 0.2 },
  { ruleId: "rule-134", reason: "playlist_dropout", narrativeAngle: "soundtrack-preview", strategy: "streak-preserver", baseScore: 0.3 },
  { ruleId: "rule-135", reason: "ad_skip_exit", narrativeAngle: "chapter-recap", strategy: "one-tap-resume", baseScore: 0.4 },
  { ruleId: "rule-136", reason: "cursor_leave_top", narrativeAngle: "fan-edit-highlight", strategy: "ai-next-best", baseScore: 0.5 },
  { ruleId: "rule-137", reason: "tab_blur", narrativeAngle: "language-dub-sample", strategy: "voiceover-tease", baseScore: 0.6 },
  { ruleId: "rule-138", reason: "idle_spike", narrativeAngle: "interactive-choice-hook", strategy: "ultra-short-teaser", baseScore: 0.7 },
  { ruleId: "rule-139", reason: "back_button_tap", narrativeAngle: "trending-moment", strategy: "watch-party-invite", baseScore: 0.8 },
  { ruleId: "rule-140", reason: "app_minimize", narrativeAngle: "nostalgia-rewind", strategy: "creator-message", baseScore: 0.9 },
  { ruleId: "rule-141", reason: "swipe_dismiss", narrativeAngle: "new-episode-trailer", strategy: "time-aware-slot", baseScore: 1.0 },
  { ruleId: "rule-142", reason: "close_shortcut", narrativeAngle: "podcast-crossover", strategy: "genre-pivot", baseScore: 1.1 },
  { ruleId: "rule-143", reason: "network_drop_intent", narrativeAngle: "community-spotlight", strategy: "language-personalization", baseScore: 0.1 },
  { ruleId: "rule-144", reason: "rage_scroll", narrativeAngle: "mini-masterclass", strategy: "thumbnail-boost", baseScore: 0.2 },
  { ruleId: "rule-145", reason: "seek_abandon", narrativeAngle: "high-drama-clip", strategy: "countdown-card", baseScore: 0.3 },
  { ruleId: "rule-146", reason: "low_volume_idle", narrativeAngle: "comedic-reset", strategy: "social-proof-badge", baseScore: 0.4 },
  { ruleId: "rule-147", reason: "payment_hesitation", narrativeAngle: "creator-behind-scenes", strategy: "streak-preserver", baseScore: 0.5 },
  { ruleId: "rule-148", reason: "search_bounce", narrativeAngle: "live-reaction", strategy: "one-tap-resume", baseScore: 0.6 },
  { ruleId: "rule-149", reason: "playlist_dropout", narrativeAngle: "micro-documentary", strategy: "ai-next-best", baseScore: 0.7 },
  { ruleId: "rule-150", reason: "ad_skip_exit", narrativeAngle: "soundtrack-preview", strategy: "voiceover-tease", baseScore: 0.8 },
  { ruleId: "rule-151", reason: "cursor_leave_top", narrativeAngle: "chapter-recap", strategy: "ultra-short-teaser", baseScore: 0.9 },
  { ruleId: "rule-152", reason: "tab_blur", narrativeAngle: "fan-edit-highlight", strategy: "watch-party-invite", baseScore: 1.0 },
  { ruleId: "rule-153", reason: "idle_spike", narrativeAngle: "language-dub-sample", strategy: "creator-message", baseScore: 1.1 },
  { ruleId: "rule-154", reason: "back_button_tap", narrativeAngle: "interactive-choice-hook", strategy: "time-aware-slot", baseScore: 0.1 },
  { ruleId: "rule-155", reason: "app_minimize", narrativeAngle: "trending-moment", strategy: "genre-pivot", baseScore: 0.2 },
  { ruleId: "rule-156", reason: "swipe_dismiss", narrativeAngle: "nostalgia-rewind", strategy: "language-personalization", baseScore: 0.3 },
  { ruleId: "rule-157", reason: "close_shortcut", narrativeAngle: "new-episode-trailer", strategy: "thumbnail-boost", baseScore: 0.4 },
  { ruleId: "rule-158", reason: "network_drop_intent", narrativeAngle: "podcast-crossover", strategy: "countdown-card", baseScore: 0.5 },
  { ruleId: "rule-159", reason: "rage_scroll", narrativeAngle: "community-spotlight", strategy: "social-proof-badge", baseScore: 0.6 },
  { ruleId: "rule-160", reason: "seek_abandon", narrativeAngle: "mini-masterclass", strategy: "streak-preserver", baseScore: 0.7 },
  { ruleId: "rule-161", reason: "low_volume_idle", narrativeAngle: "high-drama-clip", strategy: "one-tap-resume", baseScore: 0.8 },
  { ruleId: "rule-162", reason: "payment_hesitation", narrativeAngle: "comedic-reset", strategy: "ai-next-best", baseScore: 0.9 },
  { ruleId: "rule-163", reason: "search_bounce", narrativeAngle: "creator-behind-scenes", strategy: "voiceover-tease", baseScore: 1.0 },
  { ruleId: "rule-164", reason: "playlist_dropout", narrativeAngle: "live-reaction", strategy: "ultra-short-teaser", baseScore: 1.1 },
  { ruleId: "rule-165", reason: "ad_skip_exit", narrativeAngle: "micro-documentary", strategy: "watch-party-invite", baseScore: 0.1 },
  { ruleId: "rule-166", reason: "cursor_leave_top", narrativeAngle: "soundtrack-preview", strategy: "creator-message", baseScore: 0.2 },
  { ruleId: "rule-167", reason: "tab_blur", narrativeAngle: "chapter-recap", strategy: "time-aware-slot", baseScore: 0.3 },
  { ruleId: "rule-168", reason: "idle_spike", narrativeAngle: "fan-edit-highlight", strategy: "genre-pivot", baseScore: 0.4 },
  { ruleId: "rule-169", reason: "back_button_tap", narrativeAngle: "language-dub-sample", strategy: "language-personalization", baseScore: 0.5 },
  { ruleId: "rule-170", reason: "app_minimize", narrativeAngle: "interactive-choice-hook", strategy: "thumbnail-boost", baseScore: 0.6 },
  { ruleId: "rule-171", reason: "swipe_dismiss", narrativeAngle: "trending-moment", strategy: "countdown-card", baseScore: 0.7 },
  { ruleId: "rule-172", reason: "close_shortcut", narrativeAngle: "nostalgia-rewind", strategy: "social-proof-badge", baseScore: 0.8 },
  { ruleId: "rule-173", reason: "network_drop_intent", narrativeAngle: "new-episode-trailer", strategy: "streak-preserver", baseScore: 0.9 },
  { ruleId: "rule-174", reason: "rage_scroll", narrativeAngle: "podcast-crossover", strategy: "one-tap-resume", baseScore: 1.0 },
  { ruleId: "rule-175", reason: "seek_abandon", narrativeAngle: "community-spotlight", strategy: "ai-next-best", baseScore: 1.1 },
  { ruleId: "rule-176", reason: "low_volume_idle", narrativeAngle: "mini-masterclass", strategy: "voiceover-tease", baseScore: 0.1 },
  { ruleId: "rule-177", reason: "payment_hesitation", narrativeAngle: "high-drama-clip", strategy: "ultra-short-teaser", baseScore: 0.2 },
  { ruleId: "rule-178", reason: "search_bounce", narrativeAngle: "comedic-reset", strategy: "watch-party-invite", baseScore: 0.3 },
  { ruleId: "rule-179", reason: "playlist_dropout", narrativeAngle: "creator-behind-scenes", strategy: "creator-message", baseScore: 0.4 },
  { ruleId: "rule-180", reason: "ad_skip_exit", narrativeAngle: "live-reaction", strategy: "time-aware-slot", baseScore: 0.5 },
  { ruleId: "rule-181", reason: "cursor_leave_top", narrativeAngle: "micro-documentary", strategy: "genre-pivot", baseScore: 0.6 },
  { ruleId: "rule-182", reason: "tab_blur", narrativeAngle: "soundtrack-preview", strategy: "language-personalization", baseScore: 0.7 },
  { ruleId: "rule-183", reason: "idle_spike", narrativeAngle: "chapter-recap", strategy: "thumbnail-boost", baseScore: 0.8 },
  { ruleId: "rule-184", reason: "back_button_tap", narrativeAngle: "fan-edit-highlight", strategy: "countdown-card", baseScore: 0.9 },
  { ruleId: "rule-185", reason: "app_minimize", narrativeAngle: "language-dub-sample", strategy: "social-proof-badge", baseScore: 1.0 },
  { ruleId: "rule-186", reason: "swipe_dismiss", narrativeAngle: "interactive-choice-hook", strategy: "streak-preserver", baseScore: 1.1 },
  { ruleId: "rule-187", reason: "close_shortcut", narrativeAngle: "trending-moment", strategy: "one-tap-resume", baseScore: 0.1 },
  { ruleId: "rule-188", reason: "network_drop_intent", narrativeAngle: "nostalgia-rewind", strategy: "ai-next-best", baseScore: 0.2 },
  { ruleId: "rule-189", reason: "rage_scroll", narrativeAngle: "new-episode-trailer", strategy: "voiceover-tease", baseScore: 0.3 },
  { ruleId: "rule-190", reason: "seek_abandon", narrativeAngle: "podcast-crossover", strategy: "ultra-short-teaser", baseScore: 0.4 },
  { ruleId: "rule-191", reason: "low_volume_idle", narrativeAngle: "community-spotlight", strategy: "watch-party-invite", baseScore: 0.5 },
  { ruleId: "rule-192", reason: "payment_hesitation", narrativeAngle: "mini-masterclass", strategy: "creator-message", baseScore: 0.6 },
  { ruleId: "rule-193", reason: "search_bounce", narrativeAngle: "high-drama-clip", strategy: "time-aware-slot", baseScore: 0.7 },
  { ruleId: "rule-194", reason: "playlist_dropout", narrativeAngle: "comedic-reset", strategy: "genre-pivot", baseScore: 0.8 },
  { ruleId: "rule-195", reason: "ad_skip_exit", narrativeAngle: "creator-behind-scenes", strategy: "language-personalization", baseScore: 0.9 },
  { ruleId: "rule-196", reason: "cursor_leave_top", narrativeAngle: "live-reaction", strategy: "thumbnail-boost", baseScore: 1.0 },
  { ruleId: "rule-197", reason: "tab_blur", narrativeAngle: "micro-documentary", strategy: "countdown-card", baseScore: 1.1 },
  { ruleId: "rule-198", reason: "idle_spike", narrativeAngle: "soundtrack-preview", strategy: "social-proof-badge", baseScore: 0.1 },
  { ruleId: "rule-199", reason: "back_button_tap", narrativeAngle: "chapter-recap", strategy: "streak-preserver", baseScore: 0.2 },
  { ruleId: "rule-200", reason: "app_minimize", narrativeAngle: "fan-edit-highlight", strategy: "one-tap-resume", baseScore: 0.3 },
  { ruleId: "rule-201", reason: "swipe_dismiss", narrativeAngle: "language-dub-sample", strategy: "ai-next-best", baseScore: 0.4 },
  { ruleId: "rule-202", reason: "close_shortcut", narrativeAngle: "interactive-choice-hook", strategy: "voiceover-tease", baseScore: 0.5 },
  { ruleId: "rule-203", reason: "network_drop_intent", narrativeAngle: "trending-moment", strategy: "ultra-short-teaser", baseScore: 0.6 },
  { ruleId: "rule-204", reason: "rage_scroll", narrativeAngle: "nostalgia-rewind", strategy: "watch-party-invite", baseScore: 0.7 },
  { ruleId: "rule-205", reason: "seek_abandon", narrativeAngle: "new-episode-trailer", strategy: "creator-message", baseScore: 0.8 },
  { ruleId: "rule-206", reason: "low_volume_idle", narrativeAngle: "podcast-crossover", strategy: "time-aware-slot", baseScore: 0.9 },
  { ruleId: "rule-207", reason: "payment_hesitation", narrativeAngle: "community-spotlight", strategy: "genre-pivot", baseScore: 1.0 },
  { ruleId: "rule-208", reason: "search_bounce", narrativeAngle: "mini-masterclass", strategy: "language-personalization", baseScore: 1.1 },
  { ruleId: "rule-209", reason: "playlist_dropout", narrativeAngle: "high-drama-clip", strategy: "thumbnail-boost", baseScore: 0.1 },
  { ruleId: "rule-210", reason: "ad_skip_exit", narrativeAngle: "comedic-reset", strategy: "countdown-card", baseScore: 0.2 },
  { ruleId: "rule-211", reason: "cursor_leave_top", narrativeAngle: "creator-behind-scenes", strategy: "social-proof-badge", baseScore: 0.3 },
  { ruleId: "rule-212", reason: "tab_blur", narrativeAngle: "live-reaction", strategy: "streak-preserver", baseScore: 0.4 },
  { ruleId: "rule-213", reason: "idle_spike", narrativeAngle: "micro-documentary", strategy: "one-tap-resume", baseScore: 0.5 },
  { ruleId: "rule-214", reason: "back_button_tap", narrativeAngle: "soundtrack-preview", strategy: "ai-next-best", baseScore: 0.6 },
  { ruleId: "rule-215", reason: "app_minimize", narrativeAngle: "chapter-recap", strategy: "voiceover-tease", baseScore: 0.7 },
  { ruleId: "rule-216", reason: "swipe_dismiss", narrativeAngle: "fan-edit-highlight", strategy: "ultra-short-teaser", baseScore: 0.8 },
  { ruleId: "rule-217", reason: "close_shortcut", narrativeAngle: "language-dub-sample", strategy: "watch-party-invite", baseScore: 0.9 },
  { ruleId: "rule-218", reason: "network_drop_intent", narrativeAngle: "interactive-choice-hook", strategy: "creator-message", baseScore: 1.0 },
  { ruleId: "rule-219", reason: "rage_scroll", narrativeAngle: "trending-moment", strategy: "time-aware-slot", baseScore: 1.1 },
  { ruleId: "rule-220", reason: "seek_abandon", narrativeAngle: "nostalgia-rewind", strategy: "genre-pivot", baseScore: 0.1 },
  { ruleId: "rule-221", reason: "low_volume_idle", narrativeAngle: "new-episode-trailer", strategy: "language-personalization", baseScore: 0.2 },
  { ruleId: "rule-222", reason: "payment_hesitation", narrativeAngle: "podcast-crossover", strategy: "thumbnail-boost", baseScore: 0.3 },
  { ruleId: "rule-223", reason: "search_bounce", narrativeAngle: "community-spotlight", strategy: "countdown-card", baseScore: 0.4 },
  { ruleId: "rule-224", reason: "playlist_dropout", narrativeAngle: "mini-masterclass", strategy: "social-proof-badge", baseScore: 0.5 },
  { ruleId: "rule-225", reason: "ad_skip_exit", narrativeAngle: "high-drama-clip", strategy: "streak-preserver", baseScore: 0.6 },
  { ruleId: "rule-226", reason: "cursor_leave_top", narrativeAngle: "comedic-reset", strategy: "one-tap-resume", baseScore: 0.7 },
  { ruleId: "rule-227", reason: "tab_blur", narrativeAngle: "creator-behind-scenes", strategy: "ai-next-best", baseScore: 0.8 },
  { ruleId: "rule-228", reason: "idle_spike", narrativeAngle: "live-reaction", strategy: "voiceover-tease", baseScore: 0.9 },
  { ruleId: "rule-229", reason: "back_button_tap", narrativeAngle: "micro-documentary", strategy: "ultra-short-teaser", baseScore: 1.0 },
  { ruleId: "rule-230", reason: "app_minimize", narrativeAngle: "soundtrack-preview", strategy: "watch-party-invite", baseScore: 1.1 },
  { ruleId: "rule-231", reason: "swipe_dismiss", narrativeAngle: "chapter-recap", strategy: "creator-message", baseScore: 0.1 },
  { ruleId: "rule-232", reason: "close_shortcut", narrativeAngle: "fan-edit-highlight", strategy: "time-aware-slot", baseScore: 0.2 },
  { ruleId: "rule-233", reason: "network_drop_intent", narrativeAngle: "language-dub-sample", strategy: "genre-pivot", baseScore: 0.3 },
  { ruleId: "rule-234", reason: "rage_scroll", narrativeAngle: "interactive-choice-hook", strategy: "language-personalization", baseScore: 0.4 },
  { ruleId: "rule-235", reason: "seek_abandon", narrativeAngle: "trending-moment", strategy: "thumbnail-boost", baseScore: 0.5 },
  { ruleId: "rule-236", reason: "low_volume_idle", narrativeAngle: "nostalgia-rewind", strategy: "countdown-card", baseScore: 0.6 },
  { ruleId: "rule-237", reason: "payment_hesitation", narrativeAngle: "new-episode-trailer", strategy: "social-proof-badge", baseScore: 0.7 },
  { ruleId: "rule-238", reason: "search_bounce", narrativeAngle: "podcast-crossover", strategy: "streak-preserver", baseScore: 0.8 },
  { ruleId: "rule-239", reason: "playlist_dropout", narrativeAngle: "community-spotlight", strategy: "one-tap-resume", baseScore: 0.9 },
  { ruleId: "rule-240", reason: "ad_skip_exit", narrativeAngle: "mini-masterclass", strategy: "ai-next-best", baseScore: 1.0 },
  { ruleId: "rule-241", reason: "cursor_leave_top", narrativeAngle: "high-drama-clip", strategy: "voiceover-tease", baseScore: 1.1 },
  { ruleId: "rule-242", reason: "tab_blur", narrativeAngle: "comedic-reset", strategy: "ultra-short-teaser", baseScore: 0.1 },
  { ruleId: "rule-243", reason: "idle_spike", narrativeAngle: "creator-behind-scenes", strategy: "watch-party-invite", baseScore: 0.2 },
  { ruleId: "rule-244", reason: "back_button_tap", narrativeAngle: "live-reaction", strategy: "creator-message", baseScore: 0.3 },
  { ruleId: "rule-245", reason: "app_minimize", narrativeAngle: "micro-documentary", strategy: "time-aware-slot", baseScore: 0.4 },
  { ruleId: "rule-246", reason: "swipe_dismiss", narrativeAngle: "soundtrack-preview", strategy: "genre-pivot", baseScore: 0.5 },
  { ruleId: "rule-247", reason: "close_shortcut", narrativeAngle: "chapter-recap", strategy: "language-personalization", baseScore: 0.6 },
  { ruleId: "rule-248", reason: "network_drop_intent", narrativeAngle: "fan-edit-highlight", strategy: "thumbnail-boost", baseScore: 0.7 },
  { ruleId: "rule-249", reason: "rage_scroll", narrativeAngle: "language-dub-sample", strategy: "countdown-card", baseScore: 0.8 },
  { ruleId: "rule-250", reason: "seek_abandon", narrativeAngle: "interactive-choice-hook", strategy: "social-proof-badge", baseScore: 0.9 },
  { ruleId: "rule-251", reason: "low_volume_idle", narrativeAngle: "trending-moment", strategy: "streak-preserver", baseScore: 1.0 },
  { ruleId: "rule-252", reason: "payment_hesitation", narrativeAngle: "nostalgia-rewind", strategy: "one-tap-resume", baseScore: 1.1 },
  { ruleId: "rule-253", reason: "search_bounce", narrativeAngle: "new-episode-trailer", strategy: "ai-next-best", baseScore: 0.1 },
  { ruleId: "rule-254", reason: "playlist_dropout", narrativeAngle: "podcast-crossover", strategy: "voiceover-tease", baseScore: 0.2 },
  { ruleId: "rule-255", reason: "ad_skip_exit", narrativeAngle: "community-spotlight", strategy: "ultra-short-teaser", baseScore: 0.3 },
  { ruleId: "rule-256", reason: "cursor_leave_top", narrativeAngle: "mini-masterclass", strategy: "watch-party-invite", baseScore: 0.4 },
  { ruleId: "rule-257", reason: "tab_blur", narrativeAngle: "high-drama-clip", strategy: "creator-message", baseScore: 0.5 },
  { ruleId: "rule-258", reason: "idle_spike", narrativeAngle: "comedic-reset", strategy: "time-aware-slot", baseScore: 0.6 },
  { ruleId: "rule-259", reason: "back_button_tap", narrativeAngle: "creator-behind-scenes", strategy: "genre-pivot", baseScore: 0.7 },
  { ruleId: "rule-260", reason: "app_minimize", narrativeAngle: "live-reaction", strategy: "language-personalization", baseScore: 0.8 },
  { ruleId: "rule-261", reason: "swipe_dismiss", narrativeAngle: "micro-documentary", strategy: "thumbnail-boost", baseScore: 0.9 },
  { ruleId: "rule-262", reason: "close_shortcut", narrativeAngle: "soundtrack-preview", strategy: "countdown-card", baseScore: 1.0 },
  { ruleId: "rule-263", reason: "network_drop_intent", narrativeAngle: "chapter-recap", strategy: "social-proof-badge", baseScore: 1.1 },
  { ruleId: "rule-264", reason: "rage_scroll", narrativeAngle: "fan-edit-highlight", strategy: "streak-preserver", baseScore: 0.1 },
  { ruleId: "rule-265", reason: "seek_abandon", narrativeAngle: "language-dub-sample", strategy: "one-tap-resume", baseScore: 0.2 },
  { ruleId: "rule-266", reason: "low_volume_idle", narrativeAngle: "interactive-choice-hook", strategy: "ai-next-best", baseScore: 0.3 },
  { ruleId: "rule-267", reason: "payment_hesitation", narrativeAngle: "trending-moment", strategy: "voiceover-tease", baseScore: 0.4 },
  { ruleId: "rule-268", reason: "search_bounce", narrativeAngle: "nostalgia-rewind", strategy: "ultra-short-teaser", baseScore: 0.5 },
  { ruleId: "rule-269", reason: "playlist_dropout", narrativeAngle: "new-episode-trailer", strategy: "watch-party-invite", baseScore: 0.6 },
  { ruleId: "rule-270", reason: "ad_skip_exit", narrativeAngle: "podcast-crossover", strategy: "creator-message", baseScore: 0.7 },
  { ruleId: "rule-271", reason: "cursor_leave_top", narrativeAngle: "community-spotlight", strategy: "time-aware-slot", baseScore: 0.8 },
  { ruleId: "rule-272", reason: "tab_blur", narrativeAngle: "mini-masterclass", strategy: "genre-pivot", baseScore: 0.9 },
  { ruleId: "rule-273", reason: "idle_spike", narrativeAngle: "high-drama-clip", strategy: "language-personalization", baseScore: 1.0 },
  { ruleId: "rule-274", reason: "back_button_tap", narrativeAngle: "comedic-reset", strategy: "thumbnail-boost", baseScore: 1.1 },
  { ruleId: "rule-275", reason: "app_minimize", narrativeAngle: "creator-behind-scenes", strategy: "countdown-card", baseScore: 0.1 },
  { ruleId: "rule-276", reason: "swipe_dismiss", narrativeAngle: "live-reaction", strategy: "social-proof-badge", baseScore: 0.2 },
  { ruleId: "rule-277", reason: "close_shortcut", narrativeAngle: "micro-documentary", strategy: "streak-preserver", baseScore: 0.3 },
  { ruleId: "rule-278", reason: "network_drop_intent", narrativeAngle: "soundtrack-preview", strategy: "one-tap-resume", baseScore: 0.4 },
  { ruleId: "rule-279", reason: "rage_scroll", narrativeAngle: "chapter-recap", strategy: "ai-next-best", baseScore: 0.5 },
  { ruleId: "rule-280", reason: "seek_abandon", narrativeAngle: "fan-edit-highlight", strategy: "voiceover-tease", baseScore: 0.6 },
  { ruleId: "rule-281", reason: "low_volume_idle", narrativeAngle: "language-dub-sample", strategy: "ultra-short-teaser", baseScore: 0.7 },
  { ruleId: "rule-282", reason: "payment_hesitation", narrativeAngle: "interactive-choice-hook", strategy: "watch-party-invite", baseScore: 0.8 },
  { ruleId: "rule-283", reason: "search_bounce", narrativeAngle: "trending-moment", strategy: "creator-message", baseScore: 0.9 },
  { ruleId: "rule-284", reason: "playlist_dropout", narrativeAngle: "nostalgia-rewind", strategy: "time-aware-slot", baseScore: 1.0 },
  { ruleId: "rule-285", reason: "ad_skip_exit", narrativeAngle: "new-episode-trailer", strategy: "genre-pivot", baseScore: 1.1 },
  { ruleId: "rule-286", reason: "cursor_leave_top", narrativeAngle: "podcast-crossover", strategy: "language-personalization", baseScore: 0.1 },
  { ruleId: "rule-287", reason: "tab_blur", narrativeAngle: "community-spotlight", strategy: "thumbnail-boost", baseScore: 0.2 },
  { ruleId: "rule-288", reason: "idle_spike", narrativeAngle: "mini-masterclass", strategy: "countdown-card", baseScore: 0.3 },
  { ruleId: "rule-289", reason: "back_button_tap", narrativeAngle: "high-drama-clip", strategy: "social-proof-badge", baseScore: 0.4 },
  { ruleId: "rule-290", reason: "app_minimize", narrativeAngle: "comedic-reset", strategy: "streak-preserver", baseScore: 0.5 },
  { ruleId: "rule-291", reason: "swipe_dismiss", narrativeAngle: "creator-behind-scenes", strategy: "one-tap-resume", baseScore: 0.6 },
  { ruleId: "rule-292", reason: "close_shortcut", narrativeAngle: "live-reaction", strategy: "ai-next-best", baseScore: 0.7 },
  { ruleId: "rule-293", reason: "network_drop_intent", narrativeAngle: "micro-documentary", strategy: "voiceover-tease", baseScore: 0.8 },
  { ruleId: "rule-294", reason: "rage_scroll", narrativeAngle: "soundtrack-preview", strategy: "ultra-short-teaser", baseScore: 0.9 },
  { ruleId: "rule-295", reason: "seek_abandon", narrativeAngle: "chapter-recap", strategy: "watch-party-invite", baseScore: 1.0 },
  { ruleId: "rule-296", reason: "low_volume_idle", narrativeAngle: "fan-edit-highlight", strategy: "creator-message", baseScore: 1.1 },
  { ruleId: "rule-297", reason: "payment_hesitation", narrativeAngle: "language-dub-sample", strategy: "time-aware-slot", baseScore: 0.1 },
  { ruleId: "rule-298", reason: "search_bounce", narrativeAngle: "interactive-choice-hook", strategy: "genre-pivot", baseScore: 0.2 },
  { ruleId: "rule-299", reason: "playlist_dropout", narrativeAngle: "trending-moment", strategy: "language-personalization", baseScore: 0.3 },
  { ruleId: "rule-300", reason: "ad_skip_exit", narrativeAngle: "nostalgia-rewind", strategy: "thumbnail-boost", baseScore: 0.4 },
  { ruleId: "rule-301", reason: "cursor_leave_top", narrativeAngle: "new-episode-trailer", strategy: "countdown-card", baseScore: 0.5 },
  { ruleId: "rule-302", reason: "tab_blur", narrativeAngle: "podcast-crossover", strategy: "social-proof-badge", baseScore: 0.6 },
  { ruleId: "rule-303", reason: "idle_spike", narrativeAngle: "community-spotlight", strategy: "streak-preserver", baseScore: 0.7 },
  { ruleId: "rule-304", reason: "back_button_tap", narrativeAngle: "mini-masterclass", strategy: "one-tap-resume", baseScore: 0.8 },
  { ruleId: "rule-305", reason: "app_minimize", narrativeAngle: "high-drama-clip", strategy: "ai-next-best", baseScore: 0.9 },
  { ruleId: "rule-306", reason: "swipe_dismiss", narrativeAngle: "comedic-reset", strategy: "voiceover-tease", baseScore: 1.0 },
  { ruleId: "rule-307", reason: "close_shortcut", narrativeAngle: "creator-behind-scenes", strategy: "ultra-short-teaser", baseScore: 1.1 },
  { ruleId: "rule-308", reason: "network_drop_intent", narrativeAngle: "live-reaction", strategy: "watch-party-invite", baseScore: 0.1 },
  { ruleId: "rule-309", reason: "rage_scroll", narrativeAngle: "micro-documentary", strategy: "creator-message", baseScore: 0.2 },
  { ruleId: "rule-310", reason: "seek_abandon", narrativeAngle: "soundtrack-preview", strategy: "time-aware-slot", baseScore: 0.3 },
  { ruleId: "rule-311", reason: "low_volume_idle", narrativeAngle: "chapter-recap", strategy: "genre-pivot", baseScore: 0.4 },
  { ruleId: "rule-312", reason: "payment_hesitation", narrativeAngle: "fan-edit-highlight", strategy: "language-personalization", baseScore: 0.5 },
  { ruleId: "rule-313", reason: "search_bounce", narrativeAngle: "language-dub-sample", strategy: "thumbnail-boost", baseScore: 0.6 },
  { ruleId: "rule-314", reason: "playlist_dropout", narrativeAngle: "interactive-choice-hook", strategy: "countdown-card", baseScore: 0.7 },
  { ruleId: "rule-315", reason: "ad_skip_exit", narrativeAngle: "trending-moment", strategy: "social-proof-badge", baseScore: 0.8 },
  { ruleId: "rule-316", reason: "cursor_leave_top", narrativeAngle: "nostalgia-rewind", strategy: "streak-preserver", baseScore: 0.9 },
  { ruleId: "rule-317", reason: "tab_blur", narrativeAngle: "new-episode-trailer", strategy: "one-tap-resume", baseScore: 1.0 },
  { ruleId: "rule-318", reason: "idle_spike", narrativeAngle: "podcast-crossover", strategy: "ai-next-best", baseScore: 1.1 },
  { ruleId: "rule-319", reason: "back_button_tap", narrativeAngle: "community-spotlight", strategy: "voiceover-tease", baseScore: 0.1 },
  { ruleId: "rule-320", reason: "app_minimize", narrativeAngle: "mini-masterclass", strategy: "ultra-short-teaser", baseScore: 0.2 },
  { ruleId: "rule-321", reason: "swipe_dismiss", narrativeAngle: "high-drama-clip", strategy: "watch-party-invite", baseScore: 0.3 },
  { ruleId: "rule-322", reason: "close_shortcut", narrativeAngle: "comedic-reset", strategy: "creator-message", baseScore: 0.4 },
  { ruleId: "rule-323", reason: "network_drop_intent", narrativeAngle: "creator-behind-scenes", strategy: "time-aware-slot", baseScore: 0.5 },
  { ruleId: "rule-324", reason: "rage_scroll", narrativeAngle: "live-reaction", strategy: "genre-pivot", baseScore: 0.6 },
  { ruleId: "rule-325", reason: "seek_abandon", narrativeAngle: "micro-documentary", strategy: "language-personalization", baseScore: 0.7 },
  { ruleId: "rule-326", reason: "low_volume_idle", narrativeAngle: "soundtrack-preview", strategy: "thumbnail-boost", baseScore: 0.8 },
  { ruleId: "rule-327", reason: "payment_hesitation", narrativeAngle: "chapter-recap", strategy: "countdown-card", baseScore: 0.9 },
  { ruleId: "rule-328", reason: "search_bounce", narrativeAngle: "fan-edit-highlight", strategy: "social-proof-badge", baseScore: 1.0 },
  { ruleId: "rule-329", reason: "playlist_dropout", narrativeAngle: "language-dub-sample", strategy: "streak-preserver", baseScore: 1.1 },
  { ruleId: "rule-330", reason: "ad_skip_exit", narrativeAngle: "interactive-choice-hook", strategy: "one-tap-resume", baseScore: 0.1 },
  { ruleId: "rule-331", reason: "cursor_leave_top", narrativeAngle: "trending-moment", strategy: "ai-next-best", baseScore: 0.2 },
  { ruleId: "rule-332", reason: "tab_blur", narrativeAngle: "nostalgia-rewind", strategy: "voiceover-tease", baseScore: 0.3 },
  { ruleId: "rule-333", reason: "idle_spike", narrativeAngle: "new-episode-trailer", strategy: "ultra-short-teaser", baseScore: 0.4 },
  { ruleId: "rule-334", reason: "back_button_tap", narrativeAngle: "podcast-crossover", strategy: "watch-party-invite", baseScore: 0.5 },
  { ruleId: "rule-335", reason: "app_minimize", narrativeAngle: "community-spotlight", strategy: "creator-message", baseScore: 0.6 },
  { ruleId: "rule-336", reason: "swipe_dismiss", narrativeAngle: "mini-masterclass", strategy: "time-aware-slot", baseScore: 0.7 },
  { ruleId: "rule-337", reason: "close_shortcut", narrativeAngle: "high-drama-clip", strategy: "genre-pivot", baseScore: 0.8 },
  { ruleId: "rule-338", reason: "network_drop_intent", narrativeAngle: "comedic-reset", strategy: "language-personalization", baseScore: 0.9 },
  { ruleId: "rule-339", reason: "rage_scroll", narrativeAngle: "creator-behind-scenes", strategy: "thumbnail-boost", baseScore: 1.0 },
  { ruleId: "rule-340", reason: "seek_abandon", narrativeAngle: "live-reaction", strategy: "countdown-card", baseScore: 1.1 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let matches = 0;
  for (const token of b) {
    if (setA.has(token)) matches += 1;
  }
  return matches / b.length;
}

export class ExitIntentTrigger {
  private readonly historyBySession = new Map<string, ExitIntentEvent[]>();

  private appendHistory(event: ExitIntentEvent): void {
    const bucket = this.historyBySession.get(event.sessionId) ?? [];
    bucket.push(event);
    if (bucket.length > 200) {
      bucket.splice(0, bucket.length - 200);
    }
    this.historyBySession.set(event.sessionId, bucket);
  }

  listSessionHistory(sessionId: string): ExitIntentEvent[] {
    return [...(this.historyBySession.get(sessionId) ?? [])];
  }

  clearSession(sessionId: string): boolean {
    return this.historyBySession.delete(sessionId);
  }

  clearAll(): void {
    this.historyBySession.clear();
  }

  evaluate(
    event: ExitIntentEvent,
    currentTags: string[],
    candidates: ReplacementCandidate[]
  ): ExitInterceptionDecision {
    this.appendHistory(event);

    const matchingRules = EXIT_RULES.filter((rule) => rule.reason === event.reason);
    const rules = matchingRules.length > 0 ? matchingRules : EXIT_RULES.slice(0, 24);

    const normalizedCurrentTags = normalizeTags(currentTags);
    const viewportArea = Math.max(1, event.viewportWidth * event.viewportHeight);
    const progressSignal = 1 - clamp(event.currentProgressRatio, 0, 1);

    let triggerStrength = 0;
    for (const rule of rules) {
      const hash = stableHash(`${event.userId}|${rule.ruleId}|${event.currentlyPlayingAssetId}`);
      const deterministicNoise = (parseInt(hash.slice(0, 6), 16) % 100) / 1000;
      const areaPenalty = viewportArea < 200_000 ? 0.05 : 0;
      const local = clamp(rule.baseScore * 0.35 + progressSignal * 0.4 + deterministicNoise - areaPenalty, 0, 1);
      triggerStrength += local;
    }
    triggerStrength = clamp(triggerStrength / rules.length, 0, 1);

    const selectedAsset = this.selectReplacementAsset(normalizedCurrentTags, candidates, event);

    const shouldIntercept = triggerStrength >= 0.35 && selectedAsset !== null;
    const strategy = shouldIntercept
      ? rules[Math.floor(triggerStrength * (rules.length - 1))]?.strategy ?? "ai-next-best"
      : "none";

    const message = shouldIntercept
      ? `Stay a little longer: we found "${selectedAsset?.title ?? "next pick"}" tuned for your session.`
      : "No interception: let the session close naturally.";

    return {
      decisionId: randomUUID(),
      userId: event.userId,
      sessionId: event.sessionId,
      shouldIntercept,
      triggerStrength: Number(triggerStrength.toFixed(4)),
      selectedAsset,
      strategy,
      message,
      generatedAt: nowIso(),
    };
  }

  private selectReplacementAsset(
    currentTags: string[],
    candidates: ReplacementCandidate[],
    event: ExitIntentEvent
  ): ReplacementCandidate | null {
    if (candidates.length === 0) return null;

    let bestScore = -Infinity;
    let best: ReplacementCandidate | null = null;

    for (const candidate of candidates) {
      const tags = normalizeTags(candidate.tags);
      const topical = overlap(currentTags, tags);
      const recency = clamp(candidate.recencyScore, 0, 1);
      const engagement = clamp(candidate.engagementScore, 0, 1);
      const shortFormBonus = candidate.durationMs <= 180_000 ? 0.12 : 0;
      const hash = stableHash(`${event.userId}|${candidate.assetId}|${event.reason}`);
      const deterministic = (parseInt(hash.slice(0, 4), 16) % 100) / 1000;
      const score = topical * 0.42 + recency * 0.18 + engagement * 0.26 + shortFormBonus + deterministic;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }
}

export const exitIntentTrigger = new ExitIntentTrigger();
