/**
 * RemixEngine – AI Video Remix pipeline.
 *
 * Transforms videos with AI: style transfer, background swap, alternate
 * endings, and visual effects. All jobs are queue-based and emit progress
 * events so the client can subscribe via WebSocket. No external ML calls
 * are made here – the "transforms" are deterministic simulations that
 * produce stable, testable output URLs.
 *
 * Each job starts in `queued` state. A `setImmediate` deferral pushes it
 * to `processing` and then `completed`, which gives tests a window to
 * observe the initial state via `POST → status === "queued"`.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";

/** All available style-transfer presets. */
export const STYLE_PRESETS = [
  "anime",
  "oil-painting",
  "cyberpunk",
  "noir",
  "retro-vhs",
] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

/** All built-in background presets. A custom URL may also be supplied. */
export const BACKGROUND_PRESETS = [
  "beach",
  "space",
  "forest",
  "neon-city",
  "mountain",
  "studio",
] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];

/** All built-in visual effects. */
export const VISUAL_EFFECTS = [
  "lens-flare",
  "rain",
  "snow",
  "fire",
  "glitch",
  "vhs-scan-lines",
] as const;
export type VisualEffect = (typeof VISUAL_EFFECTS)[number];

/** Possible lifecycle states for a remix job. */
export type RemixJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

/** The type of remix transformation being applied. */
export type RemixJobType =
  | "style-transfer"
  | "background-swap"
  | "alternate-ending"
  | "visual-effects";

/**
 * A single remix job record. This is what the REST API exposes to
 * clients and what tests assert against.
 */
export interface RemixJob {
  jobId: string;
  videoId: string;
  type: RemixJobType;
  status: RemixJobStatus;
  /** 0–100, monotonic. */
  progress: number;
  /** Present once the job reaches `completed`. */
  outputVideoUrl?: string;
  /** Present for alternate-ending jobs once complete. */
  generatedScript?: string;
  /** Opaque parameter echo – e.g. `{ style }`, `{ effects }`. */
  params: Record<string, unknown>;
  /** Captured when `status === "failed"`. */
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A published remix that appears in the trending feed. */
export interface PublishedRemix {
  remixId: string;
  jobId: string;
  videoId: string;
  originalVideoId: string;
  originalCreatorHandle: string | null;
  title: string;
  description: string;
  tags: string[];
  viewCount: number;
  type: RemixJobType;
  outputVideoUrl: string;
  publishedAt: string;
}

/** Emitted event names – handy for typed listeners in tests. */
export type RemixEventName =
  | "job.created"
  | "job.progress"
  | "job.completed"
  | "job.failed"
  | "remix.published";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const jobs = new Map<string, RemixJob>();
const publishedRemixes = new Map<string, PublishedRemix>();
/** Map from remixed videoId → originalVideoId, powers remix chains. */
const remixLineage = new Map<string, string>();

/**
 * Shared bus so WebSocket layers (and tests) can subscribe to progress
 * updates without reaching into the job store directly.
 */
export const remixEvents = new EventEmitter();
// The engine is long-lived; default of 10 would produce warnings in tests.
remixEvents.setMaxListeners(100);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function touch(job: RemixJob): void {
  job.updatedAt = nowIso();
}

function buildOutputUrl(jobId: string, type: RemixJobType): string {
  return `https://cdn.quanttube.com/remixes/${type}/${jobId}.mp4`;
}

/**
 * Deterministic "AI" ending generator. Real implementations would call
 * out to an LLM; we produce something plausible and stable so tests can
 * assert on it.
 */
function synthesizeEnding(prompt: string): string {
  const trimmed = prompt.trim();
  const clean = trimmed.length > 0 ? trimmed : "an unexpected twist";
  return (
    `ALTERNATE ENDING\n\n` +
    `The story pivots: ${clean}. ` +
    `Characters confront the consequences of their choices in a final ` +
    `beat that reframes everything that came before, leaving the ` +
    `audience on a single, resonant image.`
  );
}

/**
 * Advance a job through processing → completed. Emits progress events.
 * Extracted so every factory can share the same lifecycle.
 */
function runJob(
  job: RemixJob,
  finalize: (job: RemixJob) => void = () => undefined,
): void {
  // Queue phase is observable: status stays "queued" until the next tick.
  setImmediate(() => {
    try {
      job.status = "processing";
      job.progress = 10;
      touch(job);
      remixEvents.emit("job.progress", { ...job });

      // A couple of synchronous progress beats. Real pipelines would be
      // async but determinism keeps the tests fast and stable.
      job.progress = 55;
      touch(job);
      remixEvents.emit("job.progress", { ...job });

      finalize(job);

      job.progress = 100;
      job.status = "completed";
      job.outputVideoUrl = buildOutputUrl(job.jobId, job.type);
      touch(job);
      remixEvents.emit("job.completed", { ...job });
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      touch(job);
      remixEvents.emit("job.failed", { ...job });
    }
  });
}

function registerJob(job: RemixJob): void {
  jobs.set(job.jobId, job);
  remixEvents.emit("job.created", { ...job });
}

// ---------------------------------------------------------------------------
// Public API – job factories
// ---------------------------------------------------------------------------

/**
 * Apply a style-transfer preset to an entire video. Returns immediately
 * with a `queued` job; the job is advanced asynchronously via
 * `setImmediate`.
 */
export function applyStyleTransfer(
  videoId: string,
  style: StylePreset,
): RemixJob {
  if (!STYLE_PRESETS.includes(style)) {
    throw new Error(`Unsupported style preset: ${style}`);
  }
  const now = nowIso();
  const job: RemixJob = {
    jobId: uuidv4(),
    videoId,
    type: "style-transfer",
    status: "queued",
    progress: 0,
    params: { style },
    createdAt: now,
    updatedAt: now,
  };
  registerJob(job);
  runJob(job);
  return job;
}

/**
 * Swap the background of a video. `newBackground` may be one of the
 * named presets or an arbitrary `https://` URL for a custom asset.
 */
export function swapBackground(
  videoId: string,
  newBackground: BackgroundPreset | string,
): RemixJob {
  const isPreset = (BACKGROUND_PRESETS as readonly string[]).includes(
    newBackground,
  );
  const isCustomUrl = /^https?:\/\//.test(newBackground);
  if (!isPreset && !isCustomUrl) {
    throw new Error(
      `newBackground must be a preset (${BACKGROUND_PRESETS.join(", ")}) or an http(s) URL`,
    );
  }
  const now = nowIso();
  const job: RemixJob = {
    jobId: uuidv4(),
    videoId,
    type: "background-swap",
    status: "queued",
    progress: 0,
    params: { newBackground, isPreset, isCustomUrl },
    createdAt: now,
    updatedAt: now,
  };
  registerJob(job);
  runJob(job);
  return job;
}

/**
 * Generate an alternate ending driven by a text prompt. On completion
 * `generatedScript` is populated.
 */
export function generateAlternateEnding(
  videoId: string,
  prompt: string,
): RemixJob {
  if (typeof prompt !== "string" || prompt.length > 500) {
    throw new Error("prompt must be a string of at most 500 characters");
  }
  const now = nowIso();
  const job: RemixJob = {
    jobId: uuidv4(),
    videoId,
    type: "alternate-ending",
    status: "queued",
    progress: 0,
    params: { prompt },
    createdAt: now,
    updatedAt: now,
  };
  registerJob(job);
  runJob(job, (j) => {
    j.generatedScript = synthesizeEnding(prompt);
  });
  return job;
}

/**
 * Apply one or more visual effects. Effects are applied in array order
 * and de-duplicated.
 */
export function addVisualEffects(
  videoId: string,
  effects: VisualEffect[],
): RemixJob {
  if (!Array.isArray(effects) || effects.length === 0) {
    throw new Error("effects must be a non-empty array");
  }
  const deduped: VisualEffect[] = [];
  for (const e of effects) {
    if (!VISUAL_EFFECTS.includes(e)) {
      throw new Error(`Unsupported visual effect: ${e}`);
    }
    if (!deduped.includes(e)) deduped.push(e);
  }
  const now = nowIso();
  const job: RemixJob = {
    jobId: uuidv4(),
    videoId,
    type: "visual-effects",
    status: "queued",
    progress: 0,
    params: { effects: deduped },
    createdAt: now,
    updatedAt: now,
  };
  registerJob(job);
  runJob(job);
  return job;
}

// ---------------------------------------------------------------------------
// Public API – job queries
// ---------------------------------------------------------------------------

export function getRemixJob(jobId: string): RemixJob | undefined {
  return jobs.get(jobId);
}

export function listRemixJobs(filter?: {
  videoId?: string;
  type?: RemixJobType;
  status?: RemixJobStatus;
}): RemixJob[] {
  let list = Array.from(jobs.values());
  if (filter?.videoId) list = list.filter((j) => j.videoId === filter.videoId);
  if (filter?.type) list = list.filter((j) => j.type === filter.type);
  if (filter?.status) list = list.filter((j) => j.status === filter.status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Public API – publish + trending + chains
// ---------------------------------------------------------------------------

export interface PublishOptions {
  title: string;
  description?: string;
  tags?: string[];
  originalCreatorHandle?: string;
}

/**
 * Publish a completed remix job to the feed. Throws if the job is not
 * yet `completed` or if it has already been published.
 */
export function publishRemix(
  jobId: string,
  opts: PublishOptions,
): PublishedRemix {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Remix job '${jobId}' not found`);
  if (job.status !== "completed") {
    throw new Error(
      `Remix job '${jobId}' is not completed (status: ${job.status})`,
    );
  }
  for (const existing of publishedRemixes.values()) {
    if (existing.jobId === jobId) {
      throw new Error(`Remix job '${jobId}' has already been published`);
    }
  }
  if (!opts.title || opts.title.trim().length === 0) {
    throw new Error("title is required to publish a remix");
  }

  const remixId = uuidv4();
  const published: PublishedRemix = {
    remixId,
    jobId,
    videoId: remixId, // the new video ID on the platform
    originalVideoId: job.videoId,
    originalCreatorHandle: opts.originalCreatorHandle ?? null,
    title: opts.title.trim(),
    description: (opts.description ?? "").trim(),
    tags: (opts.tags ?? []).map((t) => t.trim()).filter(Boolean),
    viewCount: 0,
    type: job.type,
    outputVideoUrl: job.outputVideoUrl ?? buildOutputUrl(job.jobId, job.type),
    publishedAt: nowIso(),
  };
  publishedRemixes.set(remixId, published);
  remixLineage.set(remixId, job.videoId);
  remixEvents.emit("remix.published", { ...published });
  return published;
}

/**
 * Get trending remixes sorted by view count (desc). Attribution to the
 * original creator is part of the record.
 */
export function getTrendingRemixes(limit = 20): PublishedRemix[] {
  const list = Array.from(publishedRemixes.values());
  list.sort((a, b) => {
    if (b.viewCount !== a.viewCount) return b.viewCount - a.viewCount;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
  return list.slice(0, Math.max(1, Math.min(100, limit)));
}

/** Return every remix (published) that derives from the given original. */
export function getRemixChain(originalVideoId: string): PublishedRemix[] {
  return Array.from(publishedRemixes.values())
    .filter((r) => r.originalVideoId === originalVideoId)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

export function getPublishedRemix(remixId: string): PublishedRemix | undefined {
  return publishedRemixes.get(remixId);
}

/** Bump the view counter – called by the feed layer. */
export function incrementRemixViewCount(remixId: string): PublishedRemix | undefined {
  const r = publishedRemixes.get(remixId);
  if (!r) return undefined;
  r.viewCount += 1;
  return r;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function _resetRemixEngine(): void {
  jobs.clear();
  publishedRemixes.clear();
  remixLineage.clear();
  remixEvents.removeAllListeners();
  remixEvents.setMaxListeners(100);
}
