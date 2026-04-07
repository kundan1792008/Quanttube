/**
 * Telepathic Feed Engine – Predictive Neural-Sync Service Stub
 *
 * This service ingests cross-app signals from the Quant Ecosystem
 * (e.g. flight tickets from Quantmail, purchase signals from Quantads,
 * social interactions from Quantsink) and produces real-time media
 * recommendations that feel "telepathic" to the user.
 *
 * Current implementation: in-memory stub.
 * Production implementation: replace with a gRPC consumer of the
 * Quant Ecosystem Kafka/BullMQ event bus.
 */

import logger from "../logger";

// ---------------------------------------------------------------------------
// Cross-app signal types
// ---------------------------------------------------------------------------

export type CrossAppSignalType =
  | "QUANTMAIL_FLIGHT_TICKET"
  | "QUANTMAIL_EVENT_INVITE"
  | "QUANTMAIL_SHOPPING_RECEIPT"
  | "QUANTSINK_PROFILE_VIEW"
  | "QUANTSINK_POST_REACTION"
  | "QUANTADS_PRODUCT_CLICK"
  | "QUANTCHAT_KEYWORD"
  | "QUANTEDITS_TEMPLATE_USED";

export interface CrossAppSignal {
  userId: string;          // Quantmail SSO user ID
  signalType: CrossAppSignalType;
  /** Arbitrary signal-specific metadata (e.g. destination city for flights). */
  payload: Record<string, unknown>;
  occurredAt: string;      // ISO-8601, validated at the API layer before ingestion
}

// ---------------------------------------------------------------------------
// Recommendation output
// ---------------------------------------------------------------------------

export interface MediaRecommendation {
  userId: string;
  reason: string;          // Human-readable explanation (for debugging / transparency)
  tags: string[];          // Suggested content tags (e.g. ["paris", "travel", "lo-fi"])
  preferredMode: "cinema" | "short-reel" | "audio-only";
  confidenceScore: number; // 0-1 (stub always returns 0.8)
  generatedAt: string;     // ISO-8601
}

// ---------------------------------------------------------------------------
// In-memory signal store (replace with Redis / Kafka consumer in production)
// ---------------------------------------------------------------------------

const signalStore = new Map<string, CrossAppSignal[]>();
const recommendationCache = new Map<string, MediaRecommendation>();
const MAX_SIGNALS_FOR_RECOMMENDATION = 20;

// ---------------------------------------------------------------------------
// Signal ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest a cross-app signal and immediately re-compute the recommendation
 * for the affected user.
 */
export function ingestSignal(signal: CrossAppSignal): void {
  const { userId } = signal;
  const existing = signalStore.get(userId) ?? [];
  existing.push(signal);
  signalStore.set(userId, existing);

  logger.info(
    { userId, signalType: signal.signalType },
    "Telepathic Feed: cross-app signal ingested"
  );

  // Eagerly recompute the recommendation so the next feed call is instant.
  recommendationCache.set(userId, computeRecommendation(userId, existing));
}

/** Return all raw signals for a user. */
export function getSignalsForUser(userId: string): CrossAppSignal[] {
  return signalStore.get(userId) ?? [];
}

// ---------------------------------------------------------------------------
// Recommendation computation (stub logic)
// ---------------------------------------------------------------------------

/**
 * Derive content tags and preferred playback mode from accumulated signals.
 *
 * Stub rules (production would use an ML model / vector similarity):
 *  - FLIGHT_TICKET  → destination city tags + "travel" + mode=cinema
 *  - EVENT_INVITE   → event type tags + mode=short-reel
 *  - SHOPPING_*     → product category tags + mode=short-reel
 *  - QUANTSINK_*    → social trending tags + mode=short-reel
 *  - QUANTCHAT_*    → conversation keyword tags + mode=audio-only (driving?)
 *  - default        → generic "trending" tags + mode=cinema
 */
function computeRecommendation(
  userId: string,
  signals: CrossAppSignal[]
): MediaRecommendation {
  const tags = new Set<string>(["trending"]);
  let preferredMode: MediaRecommendation["preferredMode"] = "cinema";
  const reasons: string[] = [];

  for (const signal of signals.slice(-MAX_SIGNALS_FOR_RECOMMENDATION)) {
    switch (signal.signalType) {
      case "QUANTMAIL_FLIGHT_TICKET": {
        const dest = String(signal.payload.destination ?? "travel");
        tags.add(dest.toLowerCase());
        tags.add("travel");
        tags.add("adventure");
        preferredMode = "cinema";
        reasons.push(`flight to ${dest}`);
        break;
      }
      case "QUANTMAIL_EVENT_INVITE": {
        const event = String(signal.payload.eventType ?? "event");
        tags.add(event.toLowerCase());
        tags.add("events");
        preferredMode = "short-reel";
        reasons.push(`event invite: ${event}`);
        break;
      }
      case "QUANTMAIL_SHOPPING_RECEIPT": {
        const category = String(signal.payload.category ?? "shopping");
        tags.add(category.toLowerCase());
        preferredMode = "short-reel";
        reasons.push(`shopped: ${category}`);
        break;
      }
      case "QUANTSINK_PROFILE_VIEW":
      case "QUANTSINK_POST_REACTION": {
        const topic = String(signal.payload.topic ?? "social");
        tags.add(topic.toLowerCase());
        tags.add("trending");
        preferredMode = "short-reel";
        reasons.push(`Quantsink activity: ${topic}`);
        break;
      }
      case "QUANTCHAT_KEYWORD": {
        const keyword = String(signal.payload.keyword ?? "");
        if (keyword) tags.add(keyword.toLowerCase());
        preferredMode = "audio-only";
        reasons.push(`chat keyword: ${keyword}`);
        break;
      }
      case "QUANTADS_PRODUCT_CLICK": {
        const product = String(signal.payload.productCategory ?? "product");
        tags.add(product.toLowerCase());
        preferredMode = "short-reel";
        reasons.push(`ad click: ${product}`);
        break;
      }
      case "QUANTEDITS_TEMPLATE_USED": {
        const template = String(signal.payload.templateStyle ?? "creative");
        tags.add(template.toLowerCase());
        tags.add("creative");
        preferredMode = "short-reel";
        reasons.push(`edited with: ${template}`);
        break;
      }
    }
  }

  return {
    userId,
    reason: reasons.length > 0 ? reasons.join("; ") : "default recommendation",
    tags: Array.from(tags),
    preferredMode,
    confidenceScore: 0.8,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current real-time media recommendation for a user.
 * Returns a default recommendation if no signals have been ingested yet.
 */
export function getRecommendation(userId: string): MediaRecommendation {
  const cached = recommendationCache.get(userId);
  if (cached) return cached;

  // No signals yet – return a sensible default.
  const defaultRec: MediaRecommendation = {
    userId,
    reason: "default recommendation",
    tags: ["trending", "popular"],
    preferredMode: "cinema",
    confidenceScore: 0.5,
    generatedAt: new Date().toISOString(),
  };
  return defaultRec;
}

/** Reset all stores (used in tests). */
export function _resetTelepathicFeed(): void {
  signalStore.clear();
  recommendationCache.clear();
}
