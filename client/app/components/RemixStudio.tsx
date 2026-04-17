/**
 * RemixStudio – AI Video Remix Studio component.
 *
 * Features:
 *  • Side-by-side preview: original vs. remixed video
 *  • Effect picker with thumbnail previews (style, visual effects, background, audio)
 *  • Timeline with effect placement for SFX injection
 *  • "Randomize" button for surprise remixes
 *  • One-click publish to Quanttube feed
 *  • Live WebSocket-style progress polling
 */
"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./RemixStudio.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_QUANTTUBE_API_BASE_URL ?? "http://localhost:4000";

// ---------------------------------------------------------------------------
// Types mirroring server contracts
// ---------------------------------------------------------------------------

type RemixJobStatus = "queued" | "processing" | "completed" | "failed";
type AudioJobStatus = "queued" | "processing" | "completed" | "failed";

interface BaseJob {
  jobId: string;
  videoId: string;
  status: RemixJobStatus | AudioJobStatus;
  progress: number;
  outputUrl: string | null;
  error: string | null;
  updatedAt: string;
}

interface StyleTransferJob extends BaseJob {
  type: "style-transfer";
  style: string;
}

interface BackgroundSwapJob extends BaseJob {
  type: "background-swap";
  newBackground: string;
}

interface AlternateEndingJob extends BaseJob {
  type: "alternate-ending";
  prompt: string;
  generatedScript: string | null;
}

interface VisualEffectsJob extends BaseJob {
  type: "visual-effects";
  effects: string[];
}

interface MusicChangeJob extends BaseJob {
  type: "music-change";
  genre: string;
  speechPreserved: boolean;
}

interface SfxInjectionJob extends BaseJob {
  type: "sfx-injection";
  timestamps: Array<{ timestampSeconds: number; effectId: string; volume: number }>;
}

interface SpeedChangeJob extends BaseJob {
  type: "speed-change";
  factor: number;
  pitchCompensated: boolean;
}

interface VoiceCloneJob extends BaseJob {
  type: "voice-clone";
  targetVoiceId: string;
  lipSyncOffsetMs: number | null;
}

type AnyJob =
  | StyleTransferJob
  | BackgroundSwapJob
  | AlternateEndingJob
  | VisualEffectsJob
  | MusicChangeJob
  | SfxInjectionJob
  | SpeedChangeJob
  | VoiceCloneJob;

type ActiveTab = "style" | "effects" | "background" | "ending" | "audio";

// ---------------------------------------------------------------------------
// Effect catalogue
// ---------------------------------------------------------------------------

const STYLE_PRESETS = [
  { id: "anime", label: "Anime", emoji: "🌸" },
  { id: "oil-painting", label: "Oil Painting", emoji: "🖼️" },
  { id: "cyberpunk", label: "Cyberpunk", emoji: "🤖" },
  { id: "noir", label: "Noir", emoji: "🎞️" },
  { id: "retro-vhs", label: "Retro VHS", emoji: "📼" },
] as const;

const VISUAL_EFFECTS = [
  { id: "lens-flare", label: "Lens Flare", emoji: "✨" },
  { id: "rain", label: "Rain", emoji: "🌧️" },
  { id: "snow", label: "Snow", emoji: "❄️" },
  { id: "fire", label: "Fire", emoji: "🔥" },
  { id: "glitch", label: "Glitch", emoji: "💥" },
  { id: "vhs-scan-lines", label: "VHS Scan Lines", emoji: "📺" },
] as const;

const BACKGROUND_PRESETS = [
  { id: "space", label: "Space", emoji: "🚀" },
  { id: "beach", label: "Beach", emoji: "🏖️" },
  { id: "forest", label: "Forest", emoji: "🌲" },
  { id: "city-night", label: "City Night", emoji: "🌃" },
  { id: "abstract-gradient", label: "Abstract Gradient", emoji: "🎨" },
  { id: "studio-white", label: "Studio White", emoji: "⬜" },
] as const;

const MUSIC_GENRES = [
  { id: "lo-fi", label: "Lo-Fi", emoji: "🎧" },
  { id: "epic-orchestral", label: "Epic Orchestral", emoji: "🎻" },
  { id: "synthwave", label: "Synthwave", emoji: "🕹️" },
  { id: "acoustic", label: "Acoustic", emoji: "🎸" },
  { id: "hip-hop", label: "Hip-Hop", emoji: "🎤" },
  { id: "jazz", label: "Jazz", emoji: "🎷" },
  { id: "ambient", label: "Ambient", emoji: "🌊" },
  { id: "rock", label: "Rock", emoji: "🤘" },
  { id: "electronic", label: "Electronic", emoji: "⚡" },
  { id: "classical", label: "Classical", emoji: "🎹" },
] as const;

const TABS: Array<{ id: ActiveTab; label: string; emoji: string }> = [
  { id: "style", label: "Style Transfer", emoji: "🎨" },
  { id: "effects", label: "Visual Effects", emoji: "✨" },
  { id: "background", label: "Background Swap", emoji: "🌅" },
  { id: "ending", label: "Alternate Ending", emoji: "🎬" },
  { id: "audio", label: "Audio Remix", emoji: "🎵" },
];

// ---------------------------------------------------------------------------
// Timeline SFX entry
// ---------------------------------------------------------------------------

interface TimelineSfxEntry {
  id: string;
  timestampSeconds: number;
  effectId: string;
  volume: number;
}

const SOUND_EFFECTS = [
  { id: "explosion", label: "Explosion", emoji: "💣" },
  { id: "crowd-cheer", label: "Crowd Cheer", emoji: "👏" },
  { id: "dramatic-sting", label: "Dramatic Sting", emoji: "🎵" },
  { id: "notification-ping", label: "Ping", emoji: "🔔" },
  { id: "thunder", label: "Thunder", emoji: "⛈️" },
  { id: "wind", label: "Wind", emoji: "💨" },
  { id: "rain-drops", label: "Rain Drops", emoji: "🌧️" },
  { id: "laugh-track", label: "Laugh Track", emoji: "😂" },
  { id: "suspense-riser", label: "Suspense Riser", emoji: "😨" },
  { id: "whoosh", label: "Whoosh", emoji: "💫" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#1db954";
    case "processing": return "#d4a737";
    case "failed": return "#ff8f8f";
    default: return "#888";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RemixStudioProps {
  /** The video to remix. Defaults to a demo video ID. */
  videoId?: string;
  /** The video creator handle for attribution. */
  creatorHandle?: string;
}

export default function RemixStudio({
  videoId = "demo-video-001",
  creatorHandle = "@quanttube_demo",
}: RemixStudioProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("style");
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedEffects, setSelectedEffects] = useState<Set<string>>(new Set());
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [endingPrompt, setEndingPrompt] = useState("");
  const [selectedMusicGenre, setSelectedMusicGenre] = useState<string | null>(null);
  const [speedFactor, setSpeedFactor] = useState(1.0);
  const [targetVoiceId, setTargetVoiceId] = useState("");
  const [timelineEntries, setTimelineEntries] = useState<TimelineSfxEntry[]>([]);
  const [newSfxTime, setNewSfxTime] = useState(0);
  const [newSfxEffect, setNewSfxEffect] = useState("explosion");
  const [newSfxVolume, setNewSfxVolume] = useState(1.0);

  const [activeJob, setActiveJob] = useState<AnyJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");
  const [publishResult, setPublishResult] = useState<{ remixId: string; title: string } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Progress polling
  // ---------------------------------------------------------------------------

  const startPolling = useCallback(
    (jobId: string, isAudio: boolean) => {
      if (pollRef.current) clearInterval(pollRef.current);

      const jobPath = isAudio
        ? `/api/remixes/audio/jobs/${jobId}`
        : `/api/remixes/jobs/${jobId}`;

      pollRef.current = setInterval(async () => {
        try {
          const resp = await fetch(`${API_BASE}${jobPath}`);
          if (!resp.ok || !mountedRef.current) return;
          const job = (await resp.json()) as AnyJob;
          if (!mountedRef.current) return;
          setActiveJob(job);
          if (job.status === "completed" || job.status === "failed") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
          }
        } catch {
          // noop – backend may be unavailable in dev
        }
      }, 200);
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Dispatch remix operations
  // ---------------------------------------------------------------------------

  async function post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as T | { error: string };
    if (!resp.ok) throw new Error((data as { error: string }).error ?? "Request failed");
    return data as T;
  }

  async function applyStyle() {
    if (!selectedStyle) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<StyleTransferJob>("/api/remixes/style-transfer", {
        videoId,
        style: selectedStyle,
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, false);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applyEffects() {
    if (selectedEffects.size === 0) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<VisualEffectsJob>("/api/remixes/visual-effects", {
        videoId,
        effects: Array.from(selectedEffects),
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, false);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applyBackground() {
    if (!selectedBackground) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<BackgroundSwapJob>("/api/remixes/background-swap", {
        videoId,
        newBackground: selectedBackground,
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, false);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applyAlternateEnding() {
    if (!endingPrompt.trim()) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<AlternateEndingJob>("/api/remixes/alternate-ending", {
        videoId,
        prompt: endingPrompt.trim(),
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, false);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applyMusic() {
    if (!selectedMusicGenre) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<MusicChangeJob>("/api/remixes/audio/music", {
        videoId,
        genre: selectedMusicGenre,
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, true);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applySpeed() {
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<SpeedChangeJob>("/api/remixes/audio/speed", {
        videoId,
        factor: speedFactor,
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, true);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applyVoiceClone() {
    if (!targetVoiceId.trim()) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<VoiceCloneJob>("/api/remixes/audio/voice-clone", {
        videoId,
        targetVoiceId: targetVoiceId.trim(),
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, true);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function applySfx() {
    if (timelineEntries.length === 0) return;
    setLoading(true);
    setJobError(null);
    setActiveJob(null);
    setPublishResult(null);
    try {
      const job = await post<SfxInjectionJob>("/api/remixes/audio/sfx", {
        videoId,
        timestamps: timelineEntries.map((e) => ({
          timestampSeconds: e.timestampSeconds,
          effectId: e.effectId,
          volume: e.volume,
        })),
      });
      if (!mountedRef.current) return;
      setActiveJob(job);
      startPolling(job.jobId, true);
    } catch (e: unknown) {
      if (mountedRef.current) setJobError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Randomize
  // ---------------------------------------------------------------------------

  function randomize() {
    const tab = pickRandom(TABS);
    setActiveTab(tab.id);
    setSelectedStyle(pickRandom(STYLE_PRESETS).id);
    setSelectedBackground(pickRandom(BACKGROUND_PRESETS).id);
    setSelectedMusicGenre(pickRandom(MUSIC_GENRES).id);
    setSpeedFactor(parseFloat((0.75 + Math.random() * 1.25).toFixed(2)));
    const randomEffects = new Set(
      VISUAL_EFFECTS.filter(() => Math.random() > 0.5).map((e) => e.id)
    );
    setSelectedEffects(randomEffects.size > 0 ? randomEffects : new Set([VISUAL_EFFECTS[0].id]));
    setEndingPrompt("The hero discovers a hidden portal and leaps into another dimension.");
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  async function publish() {
    if (!activeJob || activeJob.status !== "completed" || !publishTitle.trim()) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const tags = publishTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const result = await post<{ remixId: string; title: string }>(
        `/api/remixes/${activeJob.jobId}/publish`,
        {
          title: publishTitle.trim(),
          description: publishDescription.trim(),
          tags,
          originalVideoId: videoId,
          originalCreatorHandle: creatorHandle,
        }
      );
      if (!mountedRef.current) return;
      setPublishResult(result);
    } catch (e: unknown) {
      if (mountedRef.current) setPublishError((e as Error).message);
    } finally {
      if (mountedRef.current) setPublishing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Timeline management
  // ---------------------------------------------------------------------------

  function addTimelineEntry() {
    setTimelineEntries((prev) => [
      ...prev,
      {
        id: `sfx-${Date.now()}`,
        timestampSeconds: newSfxTime,
        effectId: newSfxEffect,
        volume: newSfxVolume,
      },
    ]);
  }

  function removeTimelineEntry(id: string) {
    setTimelineEntries((prev) => prev.filter((e) => e.id !== id));
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const canApply = useMemo(() => {
    if (loading) return false;
    switch (activeTab) {
      case "style": return selectedStyle !== null;
      case "effects": return selectedEffects.size > 0;
      case "background": return selectedBackground !== null;
      case "ending": return endingPrompt.trim().length > 0 && endingPrompt.length <= 500;
      case "audio": return true;
      default: return false;
    }
  }, [activeTab, selectedStyle, selectedEffects, selectedBackground, endingPrompt, loading]);

  function handleApply() {
    switch (activeTab) {
      case "style": void applyStyle(); break;
      case "effects": void applyEffects(); break;
      case "background": void applyBackground(); break;
      case "ending": void applyAlternateEnding(); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.studio}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.titleEmoji}>🎬</span> Remix Studio
        </h1>
        <p className={styles.subtitle}>AI-powered one-click content transformation</p>
        <button
          className={styles.randomizeBtn}
          onClick={randomize}
          aria-label="Randomize remix settings"
        >
          🎲 Randomize
        </button>
      </header>

      {/* Main layout */}
      <div className={styles.mainLayout}>
        {/* Left: Controls */}
        <section className={styles.controls} aria-label="Remix controls">
          {/* Tab navigation */}
          <nav className={styles.tabNav} role="tablist" aria-label="Remix type">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span aria-hidden="true">{tab.emoji}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Tab panels */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              className={styles.tabPanel}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "style" && (
                <StyleTab
                  selected={selectedStyle}
                  onSelect={setSelectedStyle}
                />
              )}
              {activeTab === "effects" && (
                <EffectsTab
                  selected={selectedEffects}
                  onToggle={(id) =>
                    setSelectedEffects((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              )}
              {activeTab === "background" && (
                <BackgroundTab
                  selected={selectedBackground}
                  onSelect={setSelectedBackground}
                />
              )}
              {activeTab === "ending" && (
                <EndingTab
                  prompt={endingPrompt}
                  onPromptChange={setEndingPrompt}
                />
              )}
              {activeTab === "audio" && (
                <AudioTab
                  selectedMusicGenre={selectedMusicGenre}
                  onSelectMusicGenre={setSelectedMusicGenre}
                  speedFactor={speedFactor}
                  onSpeedFactorChange={setSpeedFactor}
                  targetVoiceId={targetVoiceId}
                  onTargetVoiceIdChange={setTargetVoiceId}
                  timelineEntries={timelineEntries}
                  newSfxTime={newSfxTime}
                  onNewSfxTimeChange={setNewSfxTime}
                  newSfxEffect={newSfxEffect}
                  onNewSfxEffectChange={setNewSfxEffect}
                  newSfxVolume={newSfxVolume}
                  onNewSfxVolumeChange={setNewSfxVolume}
                  onAddEntry={addTimelineEntry}
                  onRemoveEntry={removeTimelineEntry}
                  onApplyMusic={() => void applyMusic()}
                  onApplySpeed={() => void applySpeed()}
                  onApplyVoiceClone={() => void applyVoiceClone()}
                  onApplySfx={() => void applySfx()}
                  loading={loading}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Apply button (non-audio tabs) */}
          {activeTab !== "audio" && (
            <button
              className={styles.applyBtn}
              onClick={handleApply}
              disabled={!canApply}
              aria-busy={loading}
            >
              {loading ? (
                <span>⏳ Processing…</span>
              ) : (
                <span>▶ Apply Remix</span>
              )}
            </button>
          )}

          {jobError && (
            <p className={styles.errorMsg} role="alert">
              ⚠️ {jobError}
            </p>
          )}
        </section>

        {/* Right: Side-by-side preview + progress */}
        <section className={styles.previewSection} aria-label="Remix preview">
          <div className={styles.previewRow}>
            {/* Original */}
            <div className={styles.previewPane}>
              <span className={styles.previewLabel}>Original</span>
              <div className={styles.videoPlaceholder}>
                <span className={styles.videoIcon}>▶</span>
                <span className={styles.videoIdLabel}>{videoId}</span>
              </div>
            </div>

            {/* Divider */}
            <div className={styles.previewDivider} aria-hidden="true">⟺</div>

            {/* Remix output */}
            <div className={styles.previewPane}>
              <span className={styles.previewLabel}>Remix</span>
              <AnimatePresence mode="wait">
                {activeJob && activeJob.status === "completed" && activeJob.outputUrl ? (
                  <motion.div
                    key="output"
                    className={`${styles.videoPlaceholder} ${styles.videoPlaceholderRemix}`}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className={styles.videoIcon}>✅</span>
                    <span className={styles.videoIdLabel}>Remix ready</span>
                    <a
                      className={styles.outputLink}
                      href={activeJob.outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View output ↗
                    </a>
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    className={styles.videoPlaceholder}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className={styles.videoIcon}>⏳</span>
                    <span className={styles.videoIdLabel}>Awaiting remix</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Progress panel */}
          {activeJob && (
            <JobProgress job={activeJob} />
          )}

          {/* Publish panel */}
          {activeJob?.status === "completed" && !publishResult && (
            <PublishPanel
              title={publishTitle}
              onTitleChange={setPublishTitle}
              description={publishDescription}
              onDescriptionChange={setPublishDescription}
              tags={publishTags}
              onTagsChange={setPublishTags}
              onPublish={() => void publish()}
              publishing={publishing}
              error={publishError}
            />
          )}

          {/* Publish success */}
          {publishResult && (
            <motion.div
              className={styles.publishSuccess}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <span>🎉</span>
              <p>
                <strong>{publishResult.title}</strong> published to the Quanttube feed!
              </p>
              <p className={styles.remixId}>ID: {publishResult.remixId}</p>
              <p className={styles.attribution}>
                Attribution: Remixed from {creatorHandle}
              </p>
            </motion.div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StyleTab({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <p className={styles.panelHint}>Choose a visual style to transform the entire video:</p>
      <div className={styles.effectGrid}>
        {STYLE_PRESETS.map((preset) => (
          <EffectCard
            key={preset.id}
            id={preset.id}
            label={preset.label}
            emoji={preset.emoji}
            selected={selected === preset.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function EffectsTab({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className={styles.panelHint}>Select one or more visual effects to overlay:</p>
      <div className={styles.effectGrid}>
        {VISUAL_EFFECTS.map((effect) => (
          <EffectCard
            key={effect.id}
            id={effect.id}
            label={effect.label}
            emoji={effect.emoji}
            selected={selected.has(effect.id)}
            onSelect={onToggle}
            multi
          />
        ))}
      </div>
    </div>
  );
}

function BackgroundTab({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <p className={styles.panelHint}>Choose a background to replace via AI segmentation:</p>
      <div className={styles.effectGrid}>
        {BACKGROUND_PRESETS.map((bg) => (
          <EffectCard
            key={bg.id}
            id={bg.id}
            label={bg.label}
            emoji={bg.emoji}
            selected={selected === bg.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function EndingTab({
  prompt,
  onPromptChange,
}: {
  prompt: string;
  onPromptChange: (val: string) => void;
}) {
  const remaining = 500 - prompt.length;
  return (
    <div className={styles.endingPanel}>
      <p className={styles.panelHint}>
        Describe an alternate ending for the AI to generate (up to 500 characters):
      </p>
      <textarea
        className={styles.promptTextarea}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        maxLength={500}
        placeholder="The hero discovers a hidden doorway and escapes into the future…"
        rows={4}
        aria-label="Alternate ending prompt"
      />
      <p
        className={`${styles.charCount} ${remaining < 50 ? styles.charCountWarn : ""}`}
      >
        {remaining} characters remaining
      </p>
    </div>
  );
}

interface AudioTabProps {
  selectedMusicGenre: string | null;
  onSelectMusicGenre: (id: string) => void;
  speedFactor: number;
  onSpeedFactorChange: (v: number) => void;
  targetVoiceId: string;
  onTargetVoiceIdChange: (v: string) => void;
  timelineEntries: TimelineSfxEntry[];
  newSfxTime: number;
  onNewSfxTimeChange: (v: number) => void;
  newSfxEffect: string;
  onNewSfxEffectChange: (v: string) => void;
  newSfxVolume: number;
  onNewSfxVolumeChange: (v: number) => void;
  onAddEntry: () => void;
  onRemoveEntry: (id: string) => void;
  onApplyMusic: () => void;
  onApplySpeed: () => void;
  onApplyVoiceClone: () => void;
  onApplySfx: () => void;
  loading: boolean;
}

function AudioTab({
  selectedMusicGenre,
  onSelectMusicGenre,
  speedFactor,
  onSpeedFactorChange,
  targetVoiceId,
  onTargetVoiceIdChange,
  timelineEntries,
  newSfxTime,
  onNewSfxTimeChange,
  newSfxEffect,
  onNewSfxEffectChange,
  newSfxVolume,
  onNewSfxVolumeChange,
  onAddEntry,
  onRemoveEntry,
  onApplyMusic,
  onApplySpeed,
  onApplyVoiceClone,
  onApplySfx,
  loading,
}: AudioTabProps) {
  return (
    <div className={styles.audioPanel}>
      {/* Music genre */}
      <div className={styles.audioSection}>
        <h3 className={styles.audioSectionTitle}>🎵 Replace Background Music</h3>
        <div className={styles.effectGridSmall}>
          {MUSIC_GENRES.map((genre) => (
            <EffectCard
              key={genre.id}
              id={genre.id}
              label={genre.label}
              emoji={genre.emoji}
              selected={selectedMusicGenre === genre.id}
              onSelect={onSelectMusicGenre}
            />
          ))}
        </div>
        <button
          className={styles.audioApplyBtn}
          onClick={onApplyMusic}
          disabled={!selectedMusicGenre || loading}
        >
          Apply Music
        </button>
      </div>

      {/* Speed change */}
      <div className={styles.audioSection}>
        <h3 className={styles.audioSectionTitle}>⏩ Speed Change (pitch-preserved)</h3>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={speedFactor}
            onChange={(e) => onSpeedFactorChange(parseFloat(e.target.value))}
            className={styles.speedSlider}
            aria-label="Speed factor"
          />
          <span className={styles.sliderValue}>{speedFactor.toFixed(2)}×</span>
        </div>
        <button
          className={styles.audioApplyBtn}
          onClick={onApplySpeed}
          disabled={loading}
        >
          Apply Speed
        </button>
      </div>

      {/* Voice clone */}
      <div className={styles.audioSection}>
        <h3 className={styles.audioSectionTitle}>🎤 Voice Clone (lip-sync preserved)</h3>
        <input
          type="text"
          className={styles.voiceInput}
          placeholder="Enter voice ID (e.g. voice-morgan-freeman)"
          value={targetVoiceId}
          onChange={(e) => onTargetVoiceIdChange(e.target.value)}
          aria-label="Target voice ID"
        />
        <button
          className={styles.audioApplyBtn}
          onClick={onApplyVoiceClone}
          disabled={!targetVoiceId.trim() || loading}
        >
          Apply Voice Clone
        </button>
      </div>

      {/* SFX timeline */}
      <div className={styles.audioSection}>
        <h3 className={styles.audioSectionTitle}>🔊 SFX Timeline</h3>
        <div className={styles.timelineAddRow}>
          <label className={styles.timelineLabel}>
            Time (s):
            <input
              type="number"
              min={0}
              step={0.5}
              value={newSfxTime}
              onChange={(e) => onNewSfxTimeChange(parseFloat(e.target.value) || 0)}
              className={styles.timelineInput}
              aria-label="SFX timestamp in seconds"
            />
          </label>
          <label className={styles.timelineLabel}>
            Effect:
            <select
              value={newSfxEffect}
              onChange={(e) => onNewSfxEffectChange(e.target.value)}
              className={styles.timelineSelect}
              aria-label="SFX effect"
            >
              {SOUND_EFFECTS.map((sfx) => (
                <option key={sfx.id} value={sfx.id}>
                  {sfx.emoji} {sfx.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.timelineLabel}>
            Vol:
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={newSfxVolume}
              onChange={(e) => onNewSfxVolumeChange(parseFloat(e.target.value) || 1)}
              className={styles.timelineInputSmall}
              aria-label="SFX volume"
            />
          </label>
          <button className={styles.addSfxBtn} onClick={onAddEntry} aria-label="Add SFX to timeline">
            +
          </button>
        </div>

        {/* Timeline visual */}
        <div className={styles.timeline} role="list" aria-label="SFX timeline">
          {timelineEntries.length === 0 ? (
            <p className={styles.timelineEmpty}>No SFX added yet. Use the form above.</p>
          ) : (
            timelineEntries
              .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
              .map((entry) => {
                const sfx = SOUND_EFFECTS.find((s) => s.id === entry.effectId);
                return (
                  <div key={entry.id} className={styles.timelineEntry} role="listitem">
                    <span className={styles.timelineTime}>{entry.timestampSeconds.toFixed(1)}s</span>
                    <span className={styles.timelineEffect}>
                      {sfx?.emoji ?? "🔊"} {sfx?.label ?? entry.effectId}
                    </span>
                    <span className={styles.timelineVol}>×{entry.volume.toFixed(1)}</span>
                    <button
                      className={styles.removeBtn}
                      onClick={() => onRemoveEntry(entry.id)}
                      aria-label={`Remove ${sfx?.label ?? entry.effectId} at ${entry.timestampSeconds}s`}
                    >
                      ×
                    </button>
                  </div>
                );
              })
          )}
        </div>

        <button
          className={styles.audioApplyBtn}
          onClick={onApplySfx}
          disabled={timelineEntries.length === 0 || loading}
        >
          Apply SFX ({timelineEntries.length})
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EffectCard
// ---------------------------------------------------------------------------

interface EffectCardProps {
  id: string;
  label: string;
  emoji: string;
  selected: boolean;
  onSelect: (id: string) => void;
  multi?: boolean;
}

function EffectCard({ id, label, emoji, selected, onSelect, multi }: EffectCardProps) {
  return (
    <button
      className={`${styles.effectCard} ${selected ? styles.effectCardSelected : ""}`}
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      title={multi ? (selected ? `Remove ${label}` : `Add ${label}`) : `Select ${label}`}
    >
      <span className={styles.effectEmoji} aria-hidden="true">{emoji}</span>
      <span className={styles.effectLabel}>{label}</span>
      {selected && <span className={styles.checkMark} aria-hidden="true">✓</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// JobProgress
// ---------------------------------------------------------------------------

function JobProgress({ job }: { job: AnyJob }) {
  const color = statusColor(job.status);
  return (
    <motion.div
      className={styles.progressPanel}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.25 }}
      aria-label="Job progress"
    >
      <div className={styles.progressHeader}>
        <span className={styles.jobType}>{job.type}</span>
        <span className={styles.jobStatus} style={{ color }}>{job.status}</span>
      </div>

      {/* Progress bar */}
      <div className={styles.progressBarTrack} role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
        <motion.div
          className={styles.progressBarFill}
          style={{ background: color }}
          initial={{ width: "0%" }}
          animate={{ width: `${job.progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <div className={styles.progressMeta}>
        <span>{job.progress}%</span>
        <span className={styles.jobId}>ID: {job.jobId.slice(0, 8)}…</span>
      </div>

      {/* Job-specific details */}
      {job.type === "alternate-ending" && job.generatedScript && (
        <div className={styles.scriptPreview}>
          <strong>Generated script:</strong>
          <p>{job.generatedScript}</p>
        </div>
      )}
      {job.type === "voice-clone" && job.lipSyncOffsetMs !== null && (
        <p className={styles.lipSync}>
          Lip-sync offset: <strong>{job.lipSyncOffsetMs}ms</strong>
          {job.lipSyncOffsetMs < 100 ? " ✅" : " ⚠️"}
        </p>
      )}
      {job.type === "speed-change" && (
        <p className={styles.lipSync}>
          Speed: <strong>{job.factor}×</strong> – pitch compensated: {job.pitchCompensated ? "✅" : "❌"}
        </p>
      )}
      {job.type === "music-change" && (
        <p className={styles.lipSync}>
          Genre: <strong>{job.genre}</strong> – speech preserved: {job.speechPreserved ? "✅" : "❌"}
        </p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PublishPanel
// ---------------------------------------------------------------------------

interface PublishPanelProps {
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  tags: string;
  onTagsChange: (v: string) => void;
  onPublish: () => void;
  publishing: boolean;
  error: string | null;
}

function PublishPanel({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  tags,
  onTagsChange,
  onPublish,
  publishing,
  error,
}: PublishPanelProps) {
  return (
    <motion.div
      className={styles.publishPanel}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h3 className={styles.publishTitle}>🚀 Publish to Quanttube</h3>
      <label className={styles.publishLabel}>
        Title *
        <input
          type="text"
          className={styles.publishInput}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={200}
          placeholder="My awesome remix"
          aria-label="Remix title"
        />
      </label>
      <label className={styles.publishLabel}>
        Description
        <textarea
          className={styles.publishTextarea}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={2000}
          placeholder="Describe your remix…"
          rows={2}
          aria-label="Remix description"
        />
      </label>
      <label className={styles.publishLabel}>
        Tags (comma-separated)
        <input
          type="text"
          className={styles.publishInput}
          value={tags}
          onChange={(e) => onTagsChange(e.target.value)}
          placeholder="anime, cyberpunk, remix"
          aria-label="Remix tags"
        />
      </label>
      {error && <p className={styles.errorMsg}>⚠️ {error}</p>}
      <button
        className={styles.publishBtn}
        onClick={onPublish}
        disabled={!title.trim() || publishing}
        aria-busy={publishing}
      >
        {publishing ? "Publishing…" : "One-Click Publish ▶"}
      </button>
    </motion.div>
  );
}
