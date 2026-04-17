import { randomUUID } from "crypto";

export interface WatchEvent {
  eventId: string;
  userId: string;
  assetId: string;
  watchedAt: string;
  watchDurationMs: number;
  completionRatio: number;
  mode: "cinema" | "short-reel" | "audio-only";
}

export interface DailyWatchAggregate {
  dayKey: string;
  totalWatchMs: number;
  watchedAssets: Set<string>;
  maxCompletionRatio: number;
}

export interface WatchStreakState {
  userId: string;
  currentStreakDays: number;
  bestStreakDays: number;
  totalWatchDays: number;
  totalWatchMs: number;
  lastWatchDayKey: string | null;
  streakFreezeCredits: number;
  xp: number;
  coins: number;
  unlockedRewards: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RewardDefinition {
  rewardId: string;
  badgeName: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  minimumStreakDays: number;
  xpBonus: number;
  coinBonus: number;
}

export interface RewardUnlock {
  rewardId: string;
  badgeName: string;
  rarity: RewardDefinition["rarity"];
  xpBonus: number;
  coinBonus: number;
}

export interface GamificationSnapshot {
  state: WatchStreakState;
  unlocked: RewardUnlock[];
}

const MIN_DAILY_WATCH_MS = 5 * 60 * 1000;
const MAX_EVENT_HISTORY = 5000;
const STREAK_FREEZE_COST_COINS = 120;

const REWARD_CATALOG: readonly RewardDefinition[] = [
  { rewardId: "reward-001", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-002", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-003", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-004", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-005", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 150, coinBonus: 60 },
  { rewardId: "reward-006", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 175, coinBonus: 70 },
  { rewardId: "reward-007", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 200, coinBonus: 10 },
  { rewardId: "reward-008", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 225, coinBonus: 20 },
  { rewardId: "reward-009", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 25, coinBonus: 30 },
  { rewardId: "reward-010", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 50, coinBonus: 40 },
  { rewardId: "reward-011", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 75, coinBonus: 50 },
  { rewardId: "reward-012", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 100, coinBonus: 60 },
  { rewardId: "reward-013", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 125, coinBonus: 70 },
  { rewardId: "reward-014", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 150, coinBonus: 10 },
  { rewardId: "reward-015", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 175, coinBonus: 20 },
  { rewardId: "reward-016", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 200, coinBonus: 30 },
  { rewardId: "reward-017", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 225, coinBonus: 40 },
  { rewardId: "reward-018", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 25, coinBonus: 50 },
  { rewardId: "reward-019", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 50, coinBonus: 60 },
  { rewardId: "reward-020", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 75, coinBonus: 70 },
  { rewardId: "reward-021", badgeName: "First-Light", rarity: "common", minimumStreakDays: 22, xpBonus: 100, coinBonus: 10 },
  { rewardId: "reward-022", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 23, xpBonus: 125, coinBonus: 20 },
  { rewardId: "reward-023", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 24, xpBonus: 150, coinBonus: 30 },
  { rewardId: "reward-024", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 25, xpBonus: 175, coinBonus: 40 },
  { rewardId: "reward-025", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 26, xpBonus: 200, coinBonus: 50 },
  { rewardId: "reward-026", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 27, xpBonus: 225, coinBonus: 60 },
  { rewardId: "reward-027", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 28, xpBonus: 25, coinBonus: 70 },
  { rewardId: "reward-028", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 29, xpBonus: 50, coinBonus: 10 },
  { rewardId: "reward-029", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 30, xpBonus: 75, coinBonus: 20 },
  { rewardId: "reward-030", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 31, xpBonus: 100, coinBonus: 30 },
  { rewardId: "reward-031", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 32, xpBonus: 125, coinBonus: 40 },
  { rewardId: "reward-032", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 33, xpBonus: 150, coinBonus: 50 },
  { rewardId: "reward-033", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 34, xpBonus: 175, coinBonus: 60 },
  { rewardId: "reward-034", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 35, xpBonus: 200, coinBonus: 70 },
  { rewardId: "reward-035", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 36, xpBonus: 225, coinBonus: 10 },
  { rewardId: "reward-036", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 37, xpBonus: 25, coinBonus: 20 },
  { rewardId: "reward-037", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 38, xpBonus: 50, coinBonus: 30 },
  { rewardId: "reward-038", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 39, xpBonus: 75, coinBonus: 40 },
  { rewardId: "reward-039", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 40, xpBonus: 100, coinBonus: 50 },
  { rewardId: "reward-040", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 41, xpBonus: 125, coinBonus: 60 },
  { rewardId: "reward-041", badgeName: "First-Light", rarity: "common", minimumStreakDays: 42, xpBonus: 150, coinBonus: 70 },
  { rewardId: "reward-042", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 43, xpBonus: 175, coinBonus: 10 },
  { rewardId: "reward-043", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 44, xpBonus: 200, coinBonus: 20 },
  { rewardId: "reward-044", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 45, xpBonus: 225, coinBonus: 30 },
  { rewardId: "reward-045", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 46, xpBonus: 25, coinBonus: 40 },
  { rewardId: "reward-046", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 47, xpBonus: 50, coinBonus: 50 },
  { rewardId: "reward-047", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 48, xpBonus: 75, coinBonus: 60 },
  { rewardId: "reward-048", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 49, xpBonus: 100, coinBonus: 70 },
  { rewardId: "reward-049", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 50, xpBonus: 125, coinBonus: 10 },
  { rewardId: "reward-050", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 51, xpBonus: 150, coinBonus: 20 },
  { rewardId: "reward-051", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 52, xpBonus: 175, coinBonus: 30 },
  { rewardId: "reward-052", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 53, xpBonus: 200, coinBonus: 40 },
  { rewardId: "reward-053", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 54, xpBonus: 225, coinBonus: 50 },
  { rewardId: "reward-054", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 55, xpBonus: 25, coinBonus: 60 },
  { rewardId: "reward-055", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 56, xpBonus: 50, coinBonus: 70 },
  { rewardId: "reward-056", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 57, xpBonus: 75, coinBonus: 10 },
  { rewardId: "reward-057", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 58, xpBonus: 100, coinBonus: 20 },
  { rewardId: "reward-058", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 59, xpBonus: 125, coinBonus: 30 },
  { rewardId: "reward-059", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 60, xpBonus: 150, coinBonus: 40 },
  { rewardId: "reward-060", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 1, xpBonus: 175, coinBonus: 50 },
  { rewardId: "reward-061", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 200, coinBonus: 60 },
  { rewardId: "reward-062", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 225, coinBonus: 70 },
  { rewardId: "reward-063", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 25, coinBonus: 10 },
  { rewardId: "reward-064", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-065", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-066", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-067", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-068", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 150, coinBonus: 60 },
  { rewardId: "reward-069", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 175, coinBonus: 70 },
  { rewardId: "reward-070", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 200, coinBonus: 10 },
  { rewardId: "reward-071", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 225, coinBonus: 20 },
  { rewardId: "reward-072", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 25, coinBonus: 30 },
  { rewardId: "reward-073", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 50, coinBonus: 40 },
  { rewardId: "reward-074", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 75, coinBonus: 50 },
  { rewardId: "reward-075", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 100, coinBonus: 60 },
  { rewardId: "reward-076", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 125, coinBonus: 70 },
  { rewardId: "reward-077", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 150, coinBonus: 10 },
  { rewardId: "reward-078", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 175, coinBonus: 20 },
  { rewardId: "reward-079", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 200, coinBonus: 30 },
  { rewardId: "reward-080", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 225, coinBonus: 40 },
  { rewardId: "reward-081", badgeName: "First-Light", rarity: "common", minimumStreakDays: 22, xpBonus: 25, coinBonus: 50 },
  { rewardId: "reward-082", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 23, xpBonus: 50, coinBonus: 60 },
  { rewardId: "reward-083", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 24, xpBonus: 75, coinBonus: 70 },
  { rewardId: "reward-084", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 25, xpBonus: 100, coinBonus: 10 },
  { rewardId: "reward-085", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 26, xpBonus: 125, coinBonus: 20 },
  { rewardId: "reward-086", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 27, xpBonus: 150, coinBonus: 30 },
  { rewardId: "reward-087", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 28, xpBonus: 175, coinBonus: 40 },
  { rewardId: "reward-088", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 29, xpBonus: 200, coinBonus: 50 },
  { rewardId: "reward-089", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 30, xpBonus: 225, coinBonus: 60 },
  { rewardId: "reward-090", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 31, xpBonus: 25, coinBonus: 70 },
  { rewardId: "reward-091", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 32, xpBonus: 50, coinBonus: 10 },
  { rewardId: "reward-092", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 33, xpBonus: 75, coinBonus: 20 },
  { rewardId: "reward-093", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 34, xpBonus: 100, coinBonus: 30 },
  { rewardId: "reward-094", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 35, xpBonus: 125, coinBonus: 40 },
  { rewardId: "reward-095", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 36, xpBonus: 150, coinBonus: 50 },
  { rewardId: "reward-096", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 37, xpBonus: 175, coinBonus: 60 },
  { rewardId: "reward-097", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 38, xpBonus: 200, coinBonus: 70 },
  { rewardId: "reward-098", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 39, xpBonus: 225, coinBonus: 10 },
  { rewardId: "reward-099", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 40, xpBonus: 25, coinBonus: 20 },
  { rewardId: "reward-100", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 41, xpBonus: 50, coinBonus: 30 },
  { rewardId: "reward-101", badgeName: "First-Light", rarity: "common", minimumStreakDays: 42, xpBonus: 75, coinBonus: 40 },
  { rewardId: "reward-102", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 43, xpBonus: 100, coinBonus: 50 },
  { rewardId: "reward-103", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 44, xpBonus: 125, coinBonus: 60 },
  { rewardId: "reward-104", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 45, xpBonus: 150, coinBonus: 70 },
  { rewardId: "reward-105", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 46, xpBonus: 175, coinBonus: 10 },
  { rewardId: "reward-106", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 47, xpBonus: 200, coinBonus: 20 },
  { rewardId: "reward-107", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 48, xpBonus: 225, coinBonus: 30 },
  { rewardId: "reward-108", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 49, xpBonus: 25, coinBonus: 40 },
  { rewardId: "reward-109", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 50, xpBonus: 50, coinBonus: 50 },
  { rewardId: "reward-110", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 51, xpBonus: 75, coinBonus: 60 },
  { rewardId: "reward-111", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 52, xpBonus: 100, coinBonus: 70 },
  { rewardId: "reward-112", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 53, xpBonus: 125, coinBonus: 10 },
  { rewardId: "reward-113", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 54, xpBonus: 150, coinBonus: 20 },
  { rewardId: "reward-114", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 55, xpBonus: 175, coinBonus: 30 },
  { rewardId: "reward-115", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 56, xpBonus: 200, coinBonus: 40 },
  { rewardId: "reward-116", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 57, xpBonus: 225, coinBonus: 50 },
  { rewardId: "reward-117", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 58, xpBonus: 25, coinBonus: 60 },
  { rewardId: "reward-118", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 59, xpBonus: 50, coinBonus: 70 },
  { rewardId: "reward-119", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 60, xpBonus: 75, coinBonus: 10 },
  { rewardId: "reward-120", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 1, xpBonus: 100, coinBonus: 20 },
  { rewardId: "reward-121", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 125, coinBonus: 30 },
  { rewardId: "reward-122", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 150, coinBonus: 40 },
  { rewardId: "reward-123", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 175, coinBonus: 50 },
  { rewardId: "reward-124", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 200, coinBonus: 60 },
  { rewardId: "reward-125", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 225, coinBonus: 70 },
  { rewardId: "reward-126", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 25, coinBonus: 10 },
  { rewardId: "reward-127", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-128", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-129", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-130", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-131", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 150, coinBonus: 60 },
  { rewardId: "reward-132", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 175, coinBonus: 70 },
  { rewardId: "reward-133", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 200, coinBonus: 10 },
  { rewardId: "reward-134", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 225, coinBonus: 20 },
  { rewardId: "reward-135", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 25, coinBonus: 30 },
  { rewardId: "reward-136", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 50, coinBonus: 40 },
  { rewardId: "reward-137", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 75, coinBonus: 50 },
  { rewardId: "reward-138", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 100, coinBonus: 60 },
  { rewardId: "reward-139", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 125, coinBonus: 70 },
  { rewardId: "reward-140", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 150, coinBonus: 10 },
  { rewardId: "reward-141", badgeName: "First-Light", rarity: "common", minimumStreakDays: 22, xpBonus: 175, coinBonus: 20 },
  { rewardId: "reward-142", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 23, xpBonus: 200, coinBonus: 30 },
  { rewardId: "reward-143", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 24, xpBonus: 225, coinBonus: 40 },
  { rewardId: "reward-144", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 25, xpBonus: 25, coinBonus: 50 },
  { rewardId: "reward-145", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 26, xpBonus: 50, coinBonus: 60 },
  { rewardId: "reward-146", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 27, xpBonus: 75, coinBonus: 70 },
  { rewardId: "reward-147", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 28, xpBonus: 100, coinBonus: 10 },
  { rewardId: "reward-148", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 29, xpBonus: 125, coinBonus: 20 },
  { rewardId: "reward-149", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 30, xpBonus: 150, coinBonus: 30 },
  { rewardId: "reward-150", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 31, xpBonus: 175, coinBonus: 40 },
  { rewardId: "reward-151", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 32, xpBonus: 200, coinBonus: 50 },
  { rewardId: "reward-152", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 33, xpBonus: 225, coinBonus: 60 },
  { rewardId: "reward-153", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 34, xpBonus: 25, coinBonus: 70 },
  { rewardId: "reward-154", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 35, xpBonus: 50, coinBonus: 10 },
  { rewardId: "reward-155", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 36, xpBonus: 75, coinBonus: 20 },
  { rewardId: "reward-156", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 37, xpBonus: 100, coinBonus: 30 },
  { rewardId: "reward-157", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 38, xpBonus: 125, coinBonus: 40 },
  { rewardId: "reward-158", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 39, xpBonus: 150, coinBonus: 50 },
  { rewardId: "reward-159", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 40, xpBonus: 175, coinBonus: 60 },
  { rewardId: "reward-160", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 41, xpBonus: 200, coinBonus: 70 },
  { rewardId: "reward-161", badgeName: "First-Light", rarity: "common", minimumStreakDays: 42, xpBonus: 225, coinBonus: 10 },
  { rewardId: "reward-162", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 43, xpBonus: 25, coinBonus: 20 },
  { rewardId: "reward-163", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 44, xpBonus: 50, coinBonus: 30 },
  { rewardId: "reward-164", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 45, xpBonus: 75, coinBonus: 40 },
  { rewardId: "reward-165", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 46, xpBonus: 100, coinBonus: 50 },
  { rewardId: "reward-166", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 47, xpBonus: 125, coinBonus: 60 },
  { rewardId: "reward-167", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 48, xpBonus: 150, coinBonus: 70 },
  { rewardId: "reward-168", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 49, xpBonus: 175, coinBonus: 10 },
  { rewardId: "reward-169", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 50, xpBonus: 200, coinBonus: 20 },
  { rewardId: "reward-170", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 51, xpBonus: 225, coinBonus: 30 },
  { rewardId: "reward-171", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 52, xpBonus: 25, coinBonus: 40 },
  { rewardId: "reward-172", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 53, xpBonus: 50, coinBonus: 50 },
  { rewardId: "reward-173", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 54, xpBonus: 75, coinBonus: 60 },
  { rewardId: "reward-174", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 55, xpBonus: 100, coinBonus: 70 },
  { rewardId: "reward-175", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 56, xpBonus: 125, coinBonus: 10 },
  { rewardId: "reward-176", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 57, xpBonus: 150, coinBonus: 20 },
  { rewardId: "reward-177", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 58, xpBonus: 175, coinBonus: 30 },
  { rewardId: "reward-178", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 59, xpBonus: 200, coinBonus: 40 },
  { rewardId: "reward-179", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 60, xpBonus: 225, coinBonus: 50 },
  { rewardId: "reward-180", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 1, xpBonus: 25, coinBonus: 60 },
  { rewardId: "reward-181", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 50, coinBonus: 70 },
  { rewardId: "reward-182", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 75, coinBonus: 10 },
  { rewardId: "reward-183", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 100, coinBonus: 20 },
  { rewardId: "reward-184", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 125, coinBonus: 30 },
  { rewardId: "reward-185", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 150, coinBonus: 40 },
  { rewardId: "reward-186", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 175, coinBonus: 50 },
  { rewardId: "reward-187", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 200, coinBonus: 60 },
  { rewardId: "reward-188", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 225, coinBonus: 70 },
  { rewardId: "reward-189", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 25, coinBonus: 10 },
  { rewardId: "reward-190", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-191", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-192", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-193", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-194", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 150, coinBonus: 60 },
  { rewardId: "reward-195", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 175, coinBonus: 70 },
  { rewardId: "reward-196", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 200, coinBonus: 10 },
  { rewardId: "reward-197", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 225, coinBonus: 20 },
  { rewardId: "reward-198", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 25, coinBonus: 30 },
  { rewardId: "reward-199", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 50, coinBonus: 40 },
  { rewardId: "reward-200", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 75, coinBonus: 50 },
  { rewardId: "reward-201", badgeName: "First-Light", rarity: "common", minimumStreakDays: 22, xpBonus: 100, coinBonus: 60 },
  { rewardId: "reward-202", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 23, xpBonus: 125, coinBonus: 70 },
  { rewardId: "reward-203", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 24, xpBonus: 150, coinBonus: 10 },
  { rewardId: "reward-204", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 25, xpBonus: 175, coinBonus: 20 },
  { rewardId: "reward-205", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 26, xpBonus: 200, coinBonus: 30 },
  { rewardId: "reward-206", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 27, xpBonus: 225, coinBonus: 40 },
  { rewardId: "reward-207", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 28, xpBonus: 25, coinBonus: 50 },
  { rewardId: "reward-208", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 29, xpBonus: 50, coinBonus: 60 },
  { rewardId: "reward-209", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 30, xpBonus: 75, coinBonus: 70 },
  { rewardId: "reward-210", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 31, xpBonus: 100, coinBonus: 10 },
  { rewardId: "reward-211", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 32, xpBonus: 125, coinBonus: 20 },
  { rewardId: "reward-212", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 33, xpBonus: 150, coinBonus: 30 },
  { rewardId: "reward-213", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 34, xpBonus: 175, coinBonus: 40 },
  { rewardId: "reward-214", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 35, xpBonus: 200, coinBonus: 50 },
  { rewardId: "reward-215", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 36, xpBonus: 225, coinBonus: 60 },
  { rewardId: "reward-216", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 37, xpBonus: 25, coinBonus: 70 },
  { rewardId: "reward-217", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 38, xpBonus: 50, coinBonus: 10 },
  { rewardId: "reward-218", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 39, xpBonus: 75, coinBonus: 20 },
  { rewardId: "reward-219", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 40, xpBonus: 100, coinBonus: 30 },
  { rewardId: "reward-220", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 41, xpBonus: 125, coinBonus: 40 },
  { rewardId: "reward-221", badgeName: "First-Light", rarity: "common", minimumStreakDays: 42, xpBonus: 150, coinBonus: 50 },
  { rewardId: "reward-222", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 43, xpBonus: 175, coinBonus: 60 },
  { rewardId: "reward-223", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 44, xpBonus: 200, coinBonus: 70 },
  { rewardId: "reward-224", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 45, xpBonus: 225, coinBonus: 10 },
  { rewardId: "reward-225", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 46, xpBonus: 25, coinBonus: 20 },
  { rewardId: "reward-226", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 47, xpBonus: 50, coinBonus: 30 },
  { rewardId: "reward-227", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 48, xpBonus: 75, coinBonus: 40 },
  { rewardId: "reward-228", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 49, xpBonus: 100, coinBonus: 50 },
  { rewardId: "reward-229", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 50, xpBonus: 125, coinBonus: 60 },
  { rewardId: "reward-230", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 51, xpBonus: 150, coinBonus: 70 },
  { rewardId: "reward-231", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 52, xpBonus: 175, coinBonus: 10 },
  { rewardId: "reward-232", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 53, xpBonus: 200, coinBonus: 20 },
  { rewardId: "reward-233", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 54, xpBonus: 225, coinBonus: 30 },
  { rewardId: "reward-234", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 55, xpBonus: 25, coinBonus: 40 },
  { rewardId: "reward-235", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 56, xpBonus: 50, coinBonus: 50 },
  { rewardId: "reward-236", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 57, xpBonus: 75, coinBonus: 60 },
  { rewardId: "reward-237", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 58, xpBonus: 100, coinBonus: 70 },
  { rewardId: "reward-238", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 59, xpBonus: 125, coinBonus: 10 },
  { rewardId: "reward-239", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 60, xpBonus: 150, coinBonus: 20 },
  { rewardId: "reward-240", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 1, xpBonus: 175, coinBonus: 30 },
  { rewardId: "reward-241", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 200, coinBonus: 40 },
  { rewardId: "reward-242", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 225, coinBonus: 50 },
  { rewardId: "reward-243", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 25, coinBonus: 60 },
  { rewardId: "reward-244", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 50, coinBonus: 70 },
  { rewardId: "reward-245", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 75, coinBonus: 10 },
  { rewardId: "reward-246", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 100, coinBonus: 20 },
  { rewardId: "reward-247", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 125, coinBonus: 30 },
  { rewardId: "reward-248", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 150, coinBonus: 40 },
  { rewardId: "reward-249", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 175, coinBonus: 50 },
  { rewardId: "reward-250", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 200, coinBonus: 60 },
  { rewardId: "reward-251", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 225, coinBonus: 70 },
  { rewardId: "reward-252", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 25, coinBonus: 10 },
  { rewardId: "reward-253", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-254", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-255", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-256", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-257", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 150, coinBonus: 60 },
  { rewardId: "reward-258", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 175, coinBonus: 70 },
  { rewardId: "reward-259", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 200, coinBonus: 10 },
  { rewardId: "reward-260", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 225, coinBonus: 20 },
  { rewardId: "reward-261", badgeName: "First-Light", rarity: "common", minimumStreakDays: 22, xpBonus: 25, coinBonus: 30 },
  { rewardId: "reward-262", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 23, xpBonus: 50, coinBonus: 40 },
  { rewardId: "reward-263", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 24, xpBonus: 75, coinBonus: 50 },
  { rewardId: "reward-264", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 25, xpBonus: 100, coinBonus: 60 },
  { rewardId: "reward-265", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 26, xpBonus: 125, coinBonus: 70 },
  { rewardId: "reward-266", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 27, xpBonus: 150, coinBonus: 10 },
  { rewardId: "reward-267", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 28, xpBonus: 175, coinBonus: 20 },
  { rewardId: "reward-268", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 29, xpBonus: 200, coinBonus: 30 },
  { rewardId: "reward-269", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 30, xpBonus: 225, coinBonus: 40 },
  { rewardId: "reward-270", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 31, xpBonus: 25, coinBonus: 50 },
  { rewardId: "reward-271", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 32, xpBonus: 50, coinBonus: 60 },
  { rewardId: "reward-272", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 33, xpBonus: 75, coinBonus: 70 },
  { rewardId: "reward-273", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 34, xpBonus: 100, coinBonus: 10 },
  { rewardId: "reward-274", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 35, xpBonus: 125, coinBonus: 20 },
  { rewardId: "reward-275", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 36, xpBonus: 150, coinBonus: 30 },
  { rewardId: "reward-276", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 37, xpBonus: 175, coinBonus: 40 },
  { rewardId: "reward-277", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 38, xpBonus: 200, coinBonus: 50 },
  { rewardId: "reward-278", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 39, xpBonus: 225, coinBonus: 60 },
  { rewardId: "reward-279", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 40, xpBonus: 25, coinBonus: 70 },
  { rewardId: "reward-280", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 41, xpBonus: 50, coinBonus: 10 },
  { rewardId: "reward-281", badgeName: "First-Light", rarity: "common", minimumStreakDays: 42, xpBonus: 75, coinBonus: 20 },
  { rewardId: "reward-282", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 43, xpBonus: 100, coinBonus: 30 },
  { rewardId: "reward-283", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 44, xpBonus: 125, coinBonus: 40 },
  { rewardId: "reward-284", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 45, xpBonus: 150, coinBonus: 50 },
  { rewardId: "reward-285", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 46, xpBonus: 175, coinBonus: 60 },
  { rewardId: "reward-286", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 47, xpBonus: 200, coinBonus: 70 },
  { rewardId: "reward-287", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 48, xpBonus: 225, coinBonus: 10 },
  { rewardId: "reward-288", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 49, xpBonus: 25, coinBonus: 20 },
  { rewardId: "reward-289", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 50, xpBonus: 50, coinBonus: 30 },
  { rewardId: "reward-290", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 51, xpBonus: 75, coinBonus: 40 },
  { rewardId: "reward-291", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 52, xpBonus: 100, coinBonus: 50 },
  { rewardId: "reward-292", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 53, xpBonus: 125, coinBonus: 60 },
  { rewardId: "reward-293", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 54, xpBonus: 150, coinBonus: 70 },
  { rewardId: "reward-294", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 55, xpBonus: 175, coinBonus: 10 },
  { rewardId: "reward-295", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 56, xpBonus: 200, coinBonus: 20 },
  { rewardId: "reward-296", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 57, xpBonus: 225, coinBonus: 30 },
  { rewardId: "reward-297", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 58, xpBonus: 25, coinBonus: 40 },
  { rewardId: "reward-298", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 59, xpBonus: 50, coinBonus: 50 },
  { rewardId: "reward-299", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 60, xpBonus: 75, coinBonus: 60 },
  { rewardId: "reward-300", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 1, xpBonus: 100, coinBonus: 70 },
  { rewardId: "reward-301", badgeName: "First-Light", rarity: "common", minimumStreakDays: 2, xpBonus: 125, coinBonus: 10 },
  { rewardId: "reward-302", badgeName: "Night-Owl", rarity: "uncommon", minimumStreakDays: 3, xpBonus: 150, coinBonus: 20 },
  { rewardId: "reward-303", badgeName: "Seven-Wave", rarity: "rare", minimumStreakDays: 4, xpBonus: 175, coinBonus: 30 },
  { rewardId: "reward-304", badgeName: "Momentum-Forge", rarity: "epic", minimumStreakDays: 5, xpBonus: 200, coinBonus: 40 },
  { rewardId: "reward-305", badgeName: "Endurance-Prime", rarity: "legendary", minimumStreakDays: 6, xpBonus: 225, coinBonus: 50 },
  { rewardId: "reward-306", badgeName: "Signal-Keeper", rarity: "common", minimumStreakDays: 7, xpBonus: 25, coinBonus: 60 },
  { rewardId: "reward-307", badgeName: "Chronicle-Runner", rarity: "uncommon", minimumStreakDays: 8, xpBonus: 50, coinBonus: 70 },
  { rewardId: "reward-308", badgeName: "Focus-Ranger", rarity: "rare", minimumStreakDays: 9, xpBonus: 75, coinBonus: 10 },
  { rewardId: "reward-309", badgeName: "Pulse-Master", rarity: "epic", minimumStreakDays: 10, xpBonus: 100, coinBonus: 20 },
  { rewardId: "reward-310", badgeName: "Infinite-Loop", rarity: "legendary", minimumStreakDays: 11, xpBonus: 125, coinBonus: 30 },
  { rewardId: "reward-311", badgeName: "Aurora-Chain", rarity: "common", minimumStreakDays: 12, xpBonus: 150, coinBonus: 40 },
  { rewardId: "reward-312", badgeName: "Beacon-Guardian", rarity: "uncommon", minimumStreakDays: 13, xpBonus: 175, coinBonus: 50 },
  { rewardId: "reward-313", badgeName: "Creator-Supporter", rarity: "rare", minimumStreakDays: 14, xpBonus: 200, coinBonus: 60 },
  { rewardId: "reward-314", badgeName: "World-Tour", rarity: "epic", minimumStreakDays: 15, xpBonus: 225, coinBonus: 70 },
  { rewardId: "reward-315", badgeName: "Genre-Explorer", rarity: "legendary", minimumStreakDays: 16, xpBonus: 25, coinBonus: 10 },
  { rewardId: "reward-316", badgeName: "Precision-Viewer", rarity: "common", minimumStreakDays: 17, xpBonus: 50, coinBonus: 20 },
  { rewardId: "reward-317", badgeName: "Weekend-Warrior", rarity: "uncommon", minimumStreakDays: 18, xpBonus: 75, coinBonus: 30 },
  { rewardId: "reward-318", badgeName: "Marathon-Mode", rarity: "rare", minimumStreakDays: 19, xpBonus: 100, coinBonus: 40 },
  { rewardId: "reward-319", badgeName: "Mood-Shifter", rarity: "epic", minimumStreakDays: 20, xpBonus: 125, coinBonus: 50 },
  { rewardId: "reward-320", badgeName: "Story-Seeker", rarity: "legendary", minimumStreakDays: 21, xpBonus: 150, coinBonus: 60 },
];

function nowIso(): string {
  return new Date().toISOString();
}

function dayKeyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function dayKeyToEpoch(dayKey: string): number {
  return Math.floor(new Date(`${dayKey}T00:00:00.000Z`).getTime() / 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rarityMultiplier(rarity: RewardDefinition["rarity"]): number {
  switch (rarity) {
    case "common":
      return 1;
    case "uncommon":
      return 1.25;
    case "rare":
      return 1.5;
    case "epic":
      return 1.8;
    case "legendary":
      return 2.2;
  }
}

export class WatchStreakService {
  private readonly stateByUser = new Map<string, WatchStreakState>();
  private readonly eventsByUser = new Map<string, WatchEvent[]>();
  private readonly aggregateByUser = new Map<string, Map<string, DailyWatchAggregate>>();

  private ensureState(userId: string): WatchStreakState {
    const existing = this.stateByUser.get(userId);
    if (existing) return existing;

    const now = nowIso();
    const state: WatchStreakState = {
      userId,
      currentStreakDays: 0,
      bestStreakDays: 0,
      totalWatchDays: 0,
      totalWatchMs: 0,
      lastWatchDayKey: null,
      streakFreezeCredits: 1,
      xp: 0,
      coins: 0,
      unlockedRewards: [],
      createdAt: now,
      updatedAt: now,
    };
    this.stateByUser.set(userId, state);
    this.eventsByUser.set(userId, []);
    this.aggregateByUser.set(userId, new Map());
    return state;
  }

  getState(userId: string): WatchStreakState {
    const state = this.ensureState(userId);
    return { ...state, unlockedRewards: [...state.unlockedRewards] };
  }

  listStates(): WatchStreakState[] {
    return Array.from(this.stateByUser.values()).map((state) => ({
      ...state,
      unlockedRewards: [...state.unlockedRewards],
    }));
  }

  recordWatch(userId: string, payload: Omit<WatchEvent, "eventId" | "userId">): GamificationSnapshot {
    const state = this.ensureState(userId);
    const events = this.eventsByUser.get(userId) ?? [];
    const aggregates = this.aggregateByUser.get(userId) ?? new Map<string, DailyWatchAggregate>();

    const watchDurationMs = Math.max(0, Math.floor(payload.watchDurationMs));
    const completionRatio = clamp(payload.completionRatio, 0, 1);
    const watchedAt = payload.watchedAt;
    const dayKey = dayKeyFromIso(watchedAt);

    const event: WatchEvent = {
      eventId: randomUUID(),
      userId,
      assetId: payload.assetId,
      watchedAt,
      watchDurationMs,
      completionRatio,
      mode: payload.mode,
    };

    events.push(event);
    if (events.length > MAX_EVENT_HISTORY) {
      events.splice(0, events.length - MAX_EVENT_HISTORY);
    }

    const dayAggregate = aggregates.get(dayKey) ?? {
      dayKey,
      totalWatchMs: 0,
      watchedAssets: new Set<string>(),
      maxCompletionRatio: 0,
    };

    const wasQualifiedBefore = dayAggregate.totalWatchMs >= MIN_DAILY_WATCH_MS;
    dayAggregate.totalWatchMs += watchDurationMs;
    dayAggregate.watchedAssets.add(payload.assetId);
    dayAggregate.maxCompletionRatio = Math.max(dayAggregate.maxCompletionRatio, completionRatio);
    aggregates.set(dayKey, dayAggregate);

    state.totalWatchMs += watchDurationMs;

    const qualifiedNow = dayAggregate.totalWatchMs >= MIN_DAILY_WATCH_MS;
    if (!wasQualifiedBefore && qualifiedNow) {
      this.applyDailyQualification(state, dayKey);
    } else {
      state.updatedAt = nowIso();
    }

    const engagementXp = Math.floor(watchDurationMs / (60_000 * 2)) + Math.floor(completionRatio * 12);
    const modeBonus = payload.mode === "cinema" ? 3 : payload.mode === "audio-only" ? 2 : 1;
    state.xp += engagementXp + modeBonus;
    state.coins += Math.max(1, Math.floor(engagementXp / 3));

    this.eventsByUser.set(userId, events);
    this.aggregateByUser.set(userId, aggregates);

    const unlocked = this.unlockRewards(state);
    return { state: this.getState(userId), unlocked };
  }

  private applyDailyQualification(state: WatchStreakState, dayKey: string): void {
    const currentDayEpoch = dayKeyToEpoch(dayKey);

    if (!state.lastWatchDayKey) {
      state.currentStreakDays = 1;
      state.totalWatchDays += 1;
      state.lastWatchDayKey = dayKey;
      state.bestStreakDays = Math.max(state.bestStreakDays, state.currentStreakDays);
      state.updatedAt = nowIso();
      return;
    }

    const lastEpoch = dayKeyToEpoch(state.lastWatchDayKey);
    const delta = currentDayEpoch - lastEpoch;

    if (delta <= 0) {
      state.updatedAt = nowIso();
      return;
    }

    if (delta === 1) {
      state.currentStreakDays += 1;
      state.totalWatchDays += 1;
      state.lastWatchDayKey = dayKey;
      state.bestStreakDays = Math.max(state.bestStreakDays, state.currentStreakDays);
      state.updatedAt = nowIso();
      return;
    }

    const missingDays = delta - 1;
    if (missingDays <= state.streakFreezeCredits) {
      state.streakFreezeCredits -= missingDays;
      state.currentStreakDays += 1;
      state.totalWatchDays += 1;
      state.lastWatchDayKey = dayKey;
      state.bestStreakDays = Math.max(state.bestStreakDays, state.currentStreakDays);
      state.updatedAt = nowIso();
      return;
    }

    state.currentStreakDays = 1;
    state.totalWatchDays += 1;
    state.lastWatchDayKey = dayKey;
    state.updatedAt = nowIso();
  }

  private unlockRewards(state: WatchStreakState): RewardUnlock[] {
    const unlocked: RewardUnlock[] = [];
    const unlockedSet = new Set(state.unlockedRewards);

    for (const reward of REWARD_CATALOG) {
      if (state.currentStreakDays < reward.minimumStreakDays) continue;
      if (unlockedSet.has(reward.rewardId)) continue;

      unlockedSet.add(reward.rewardId);
      state.unlockedRewards.push(reward.rewardId);

      const multiplier = rarityMultiplier(reward.rarity);
      const xpBonus = Math.floor(reward.xpBonus * multiplier);
      const coinBonus = Math.floor(reward.coinBonus * multiplier);
      state.xp += xpBonus;
      state.coins += coinBonus;

      unlocked.push({
        rewardId: reward.rewardId,
        badgeName: reward.badgeName,
        rarity: reward.rarity,
        xpBonus,
        coinBonus,
      });
    }

    if (unlocked.length > 0) {
      state.updatedAt = nowIso();
    }

    return unlocked;
  }

  buyStreakFreeze(userId: string): WatchStreakState {
    const state = this.ensureState(userId);
    if (state.coins < STREAK_FREEZE_COST_COINS) {
      return this.getState(userId);
    }
    state.coins -= STREAK_FREEZE_COST_COINS;
    state.streakFreezeCredits += 1;
    state.updatedAt = nowIso();
    return this.getState(userId);
  }

  leaderboard(limit: number): WatchStreakState[] {
    const safeLimit = clamp(Math.floor(limit), 1, 100);
    return this.listStates()
      .sort((a, b) => {
        if (b.currentStreakDays !== a.currentStreakDays) return b.currentStreakDays - a.currentStreakDays;
        if (b.bestStreakDays !== a.bestStreakDays) return b.bestStreakDays - a.bestStreakDays;
        if (b.xp !== a.xp) return b.xp - a.xp;
        return a.userId.localeCompare(b.userId);
      })
      .slice(0, safeLimit);
  }

  projectedRecoveryPlan(userId: string, targetStreakDays: number): {
    currentStreakDays: number;
    targetStreakDays: number;
    daysNeeded: number;
    recommendedDailyWatchMinutes: number;
    recommendation: string;
  } {
    const state = this.ensureState(userId);
    const safeTarget = Math.max(1, Math.floor(targetStreakDays));
    const daysNeeded = Math.max(0, safeTarget - state.currentStreakDays);
    const recommendedDailyWatchMinutes = daysNeeded === 0 ? 6 : Math.min(60, 6 + daysNeeded * 2);

    const recommendation =
      daysNeeded === 0
        ? "You are already at or above target streak. Maintain at least one qualifying session daily."
        : `Maintain ${recommendedDailyWatchMinutes} minutes daily to reach a ${safeTarget} day streak in ${daysNeeded} days.`;

    return {
      currentStreakDays: state.currentStreakDays,
      targetStreakDays: safeTarget,
      daysNeeded,
      recommendedDailyWatchMinutes,
      recommendation,
    };
  }

  resetUser(userId: string): boolean {
    const hadState = this.stateByUser.delete(userId);
    this.eventsByUser.delete(userId);
    this.aggregateByUser.delete(userId);
    return hadState;
  }

  clearAll(): void {
    this.stateByUser.clear();
    this.eventsByUser.clear();
    this.aggregateByUser.clear();
  }
}

export const watchStreakService = new WatchStreakService();
