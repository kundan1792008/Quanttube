"use client";

/**
 * RemixStudio – UI for the AI Video Remix Engine.
 *
 * Features:
 *   • Side-by-side preview (original ↔ remix) with Framer Motion transitions
 *   • Tabbed picker: Style · Background · Alternate Ending · Effects · Audio
 *   • SFX timeline (add at timestamp, per-entry volume)
 *   • Live progress indicator with job-specific details (script, lip-sync, …)
 *   • 🎲 Randomize button for surprise remixes
 *   • One-click publish form (title / description / tags / creator handle)
 *
 * All server calls go through the `/api/remixes` endpoints exposed by the
 * server package.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// ---------------------------------------------------------------------------
// Types mirrored from server/src/services/RemixEngine.ts + AudioRemixService
// ---------------------------------------------------------------------------

type RemixJobType =
  | "style-transfer"
  | "background-swap"
  | "alternate-ending"
  | "visual-effects";
type AudioJobType = "music-change" | "sfx-add" | "speed-change" | "voice-clone";
type JobStatus = "queued" | "processing" | "completed" | "failed";

interface RemixJob {
  jobId: string;
  videoId: string;
  type: RemixJobType;
  status: JobStatus;
  progress: number;
  outputVideoUrl?: string;
  generatedScript?: string;
  params: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface AudioRemixJob {
  jobId: string;
  videoId: string;
  type: AudioJobType;
  status: JobStatus;
  progress: number;
  outputAudioUrl?: string;
  lipSyncOffsetMs?: number;
  params: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface PublishedRemix {
  remixId: string;
  jobId: string;
  title: string;
  originalCreatorHandle: string | null;
  originalVideoId: string;
}

type AnyJob = RemixJob | AudioRemixJob;

// ---------------------------------------------------------------------------
// Catalogues (duplicated client-side so the UI can render without a fetch).
// Kept in sync with the server-side constants.
// ---------------------------------------------------------------------------

const STYLES = ["anime", "oil-painting", "cyberpunk", "noir", "retro-vhs"] as const;
const BACKGROUNDS = ["beach", "space", "forest", "neon-city", "mountain", "studio"] as const;
const EFFECTS = ["lens-flare", "rain", "snow", "fire", "glitch", "vhs-scan-lines"] as const;
const GENRES = [
  "lofi",
  "cinematic",
  "electronic",
  "rock",
  "jazz",
  "classical",
  "hiphop",
  "ambient",
  "country",
  "synthwave",
] as const;
const SFX = [
  "applause",
  "laugh-track",
  "drum-roll",
  "explosion",
  "whoosh",
  "record-scratch",
  "ding",
  "boom",
  "glass-break",
  "heartbeat",
] as const;
const VOICES = [
  "narrator-male",
  "narrator-female",
  "anime-girl",
  "noir-detective",
  "robot",
  "child",
  "elder-wise",
  "announcer",
] as const;

type TabId = "style" | "background" | "ending" | "effects" | "audio";
const TABS: { id: TabId; label: string }[] = [
  { id: "style", label: "🎨 Style" },
  { id: "background", label: "🌅 Background" },
  { id: "ending", label: "📜 Alt Ending" },
  { id: "effects", label: "✨ Effects" },
  { id: "audio", label: "🔊 Audio" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RemixStudioProps {
  /** ID of the video to remix. Defaults to a placeholder. */
  videoId?: string;
  /** Handle of the original creator, attached to published remixes. */
  creatorHandle?: string;
  /** Source video URL for the left-hand "original" preview. */
  originalVideoUrl?: string;
  /** Base URL of the server API. */
  apiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(items: readonly T[]): T {
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] as T;
}

function titleCase(s: string): string {
  return s.replace(/(^|[-_ ])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RemixStudio({
  videoId = "demo-video",
  creatorHandle = "demo",
  originalVideoUrl,
  apiBaseUrl = process.env.NEXT_PUBLIC_QUANTTUBE_API_BASE_URL ?? "http://localhost:4000",
}: RemixStudioProps) {
  const [activeTab, setActiveTab] = useState<TabId>("style");

  // Current remix form state
  const [style, setStyle] = useState<(typeof STYLES)[number]>("anime");
  const [background, setBackground] = useState<string>("beach");
  const [customBackground, setCustomBackground] = useState<string>("");
  const [endingPrompt, setEndingPrompt] = useState<string>("");
  const [selectedEffects, setSelectedEffects] = useState<Set<string>>(new Set());

  // Audio tab state
  type AudioMode = "music" | "sfx" | "speed" | "voice";
  const [audioMode, setAudioMode] = useState<AudioMode>("music");
  const [genre, setGenre] = useState<(typeof GENRES)[number]>("cinematic");
  const [sfxEntries, setSfxEntries] = useState<
    { timestampSecs: number; effectId: (typeof SFX)[number]; volumeDb: number }[]
  >([]);
  const [newSfxTs, setNewSfxTs] = useState<number>(0);
  const [newSfxId, setNewSfxId] = useState<(typeof SFX)[number]>("ding");
  const [newSfxVol, setNewSfxVol] = useState<number>(0);
  const [speedFactor, setSpeedFactor] = useState<number>(1);
  const [voiceId, setVoiceId] = useState<(typeof VOICES)[number]>("narrator-male");

  // Job tracking
  const [currentJob, setCurrentJob] = useState<AnyJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishInfo, setPublishInfo] = useState<PublishedRemix | null>(null);
  const pollRef = useRef<number | null>(null);

  // Publish form
  const [publishTitle, setPublishTitle] = useState<string>("");
  const [publishDescription, setPublishDescription] = useState<string>("");
  const [publishTags, setPublishTags] = useState<string>("");

  const isVideoJob = (j: AnyJob | null): j is RemixJob =>
    !!j && ["style-transfer", "background-swap", "alternate-ending", "visual-effects"].includes(j.type);
  const isAudioJob = (j: AnyJob | null): j is AudioRemixJob =>
    !!j && ["music-change", "sfx-add", "speed-change", "voice-clone"].includes(j.type);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll the job until it completes or fails.
  const startPolling = useCallback(
    (jobId: string, kind: "remix" | "audio") => {
      stopPolling();
      const path = kind === "remix" ? "jobs" : "audio/jobs";
      pollRef.current = window.setInterval(async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/remixes/${path}/${jobId}`);
          if (!res.ok) {
            setError(`Status ${res.status}`);
            stopPolling();
            return;
          }
          const job: AnyJob = await res.json();
          setCurrentJob(job);
          if (job.status === "completed" || job.status === "failed") {
            stopPolling();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          stopPolling();
        }
      }, 400);
    },
    [apiBaseUrl, stopPolling],
  );

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // ---------------- submit helpers ----------------

  const submit = useCallback(
    async (path: string, body: unknown, kind: "remix" | "audio") => {
      setError(null);
      setPublishInfo(null);
      try {
        const res = await fetch(`${apiBaseUrl}/api/remixes/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const job = await res.json();
        if (!res.ok) {
          setError(job.error ?? `Status ${res.status}`);
          return;
        }
        setCurrentJob(job);
        startPolling(job.jobId, kind);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [apiBaseUrl, startPolling],
  );

  const runStyle = () => submit("style", { videoId, style }, "remix");
  const runBackground = () =>
    submit(
      "background",
      { videoId, newBackground: customBackground.trim() || background },
      "remix",
    );
  const runEnding = () => submit("ending", { videoId, prompt: endingPrompt }, "remix");
  const runEffects = () => {
    const effects = Array.from(selectedEffects);
    if (effects.length === 0) {
      setError("Please select at least one effect.");
      return;
    }
    submit("effects", { videoId, effects }, "remix");
  };
  const runAudio = () => {
    if (audioMode === "music") return submit("audio/music", { videoId, genre }, "audio");
    if (audioMode === "sfx") {
      if (sfxEntries.length === 0) {
        setError("Add at least one SFX entry.");
        return;
      }
      return submit("audio/sfx", { videoId, entries: sfxEntries }, "audio");
    }
    if (audioMode === "speed")
      return submit("audio/speed", { videoId, factor: speedFactor }, "audio");
    return submit("audio/voice", { videoId, targetVoiceId: voiceId }, "audio");
  };

  // ---------------- randomize ----------------

  const randomize = useCallback(() => {
    const r = Math.random();
    if (r < 0.2) {
      setActiveTab("style");
      const s = pickRandom(STYLES);
      setStyle(s);
      submit("style", { videoId, style: s }, "remix");
    } else if (r < 0.4) {
      setActiveTab("background");
      const b = pickRandom(BACKGROUNDS);
      setBackground(b);
      setCustomBackground("");
      submit("background", { videoId, newBackground: b }, "remix");
    } else if (r < 0.6) {
      setActiveTab("ending");
      const prompt = pickRandom([
        "the hero realises it was a dream",
        "the villain becomes the narrator",
        "time rewinds to the very first scene",
        "every character meets their future self",
      ]);
      setEndingPrompt(prompt);
      submit("ending", { videoId, prompt }, "remix");
    } else if (r < 0.8) {
      setActiveTab("effects");
      const chosen = new Set<string>();
      const n = 1 + Math.floor(Math.random() * 3);
      while (chosen.size < n) chosen.add(pickRandom(EFFECTS));
      setSelectedEffects(chosen);
      submit("effects", { videoId, effects: Array.from(chosen) }, "remix");
    } else {
      setActiveTab("audio");
      setAudioMode("music");
      const g = pickRandom(GENRES);
      setGenre(g);
      submit("audio/music", { videoId, genre: g }, "audio");
    }
  }, [submit, videoId]);

  // ---------------- publish ----------------

  const canPublish = useMemo(
    () =>
      currentJob !== null &&
      currentJob.status === "completed" &&
      isVideoJob(currentJob) &&
      publishTitle.trim().length > 0,
    [currentJob, publishTitle],
  );

  const publish = async () => {
    if (!currentJob || !isVideoJob(currentJob)) return;
    setError(null);
    try {
      const tags = publishTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch(
        `${apiBaseUrl}/api/remixes/jobs/${currentJob.jobId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: publishTitle,
            description: publishDescription,
            tags,
            originalCreatorHandle: creatorHandle,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Status ${res.status}`);
        return;
      }
      setPublishInfo(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ---------------- render ----------------

  const progress = currentJob?.progress ?? 0;
  const remixUrl =
    currentJob && isVideoJob(currentJob) ? currentJob.outputVideoUrl : undefined;
  const generatedScript =
    currentJob && isVideoJob(currentJob) ? currentJob.generatedScript : undefined;
  const lipSyncOffsetMs =
    currentJob && isAudioJob(currentJob) ? currentJob.lipSyncOffsetMs : undefined;
  const audioOutputUrl =
    currentJob && isAudioJob(currentJob) ? currentJob.outputAudioUrl : undefined;

  return (
    <div
      data-testid="remix-studio"
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: 20,
        color: "#e8e8ef",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>🎬 Remix Studio</h1>
        <button
          onClick={randomize}
          style={{
            background: "linear-gradient(90deg,#f72585,#7209b7)",
            color: "#fff",
            border: "none",
            padding: "10px 18px",
            borderRadius: 10,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🎲 Randomize
        </button>
      </header>

      {/* Side-by-side preview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          style={previewBoxStyle}
        >
          <div style={previewLabelStyle}>Original</div>
          {originalVideoUrl ? (
            <video src={originalVideoUrl} controls style={previewMediaStyle} />
          ) : (
            <div style={placeholderStyle}>🎥 Original video ({videoId})</div>
          )}
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentJob?.jobId ?? "empty"}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35 }}
            style={previewBoxStyle}
          >
            <div style={previewLabelStyle}>Remix</div>
            {remixUrl ? (
              <video src={remixUrl} controls style={previewMediaStyle} />
            ) : audioOutputUrl ? (
              <audio src={audioOutputUrl} controls style={{ width: "100%" }} />
            ) : (
              <div style={placeholderStyle}>✨ Pick an effect and press Apply</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress bar */}
      {currentJob && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <strong>{titleCase(currentJob.type)}</strong>
            <span>
              {currentJob.status} · {progress}%
            </span>
          </div>
          <div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden" }}>
            <motion.div
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.25 }}
              style={{
                height: "100%",
                background: "linear-gradient(90deg,#4cc9f0,#4361ee)",
              }}
            />
          </div>
          {generatedScript && (
            <pre
              style={{
                marginTop: 10,
                padding: 12,
                background: "#141420",
                borderRadius: 8,
                whiteSpace: "pre-wrap",
                fontSize: 13,
              }}
            >
              {generatedScript}
            </pre>
          )}
          {lipSyncOffsetMs !== undefined && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              🎤 Lip-sync offset: <strong>{lipSyncOffsetMs} ms</strong>
              {lipSyncOffsetMs < 100 && " ✅"}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "10px 8px",
              border: "none",
              borderRadius: 8,
              background: activeTab === tab.id ? "#4361ee" : "#1c1c2a",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          style={panelStyle}
        >
          {activeTab === "style" && (
            <div>
              <h3 style={sectionTitleStyle}>Style Transfer</h3>
              <div style={chipRowStyle}>
                {STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    style={chipStyle(style === s)}
                  >
                    {titleCase(s)}
                  </button>
                ))}
              </div>
              <button onClick={runStyle} style={primaryButtonStyle}>
                Apply Style
              </button>
            </div>
          )}

          {activeTab === "background" && (
            <div>
              <h3 style={sectionTitleStyle}>Background Swap</h3>
              <div style={chipRowStyle}>
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b}
                    onClick={() => {
                      setBackground(b);
                      setCustomBackground("");
                    }}
                    style={chipStyle(background === b && !customBackground)}
                  >
                    {titleCase(b)}
                  </button>
                ))}
              </div>
              <label style={{ display: "block", marginTop: 10, fontSize: 13 }}>
                Or paste a custom URL:
                <input
                  type="url"
                  value={customBackground}
                  onChange={(e) => setCustomBackground(e.target.value)}
                  placeholder="https://…"
                  style={inputStyle}
                />
              </label>
              <button onClick={runBackground} style={primaryButtonStyle}>
                Swap Background
              </button>
            </div>
          )}

          {activeTab === "ending" && (
            <div>
              <h3 style={sectionTitleStyle}>Alternate Ending</h3>
              <textarea
                value={endingPrompt}
                onChange={(e) => setEndingPrompt(e.target.value.slice(0, 500))}
                placeholder="Describe how the story should end (≤500 chars)"
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
                {endingPrompt.length}/500
              </div>
              <button onClick={runEnding} style={primaryButtonStyle}>
                Generate Ending
              </button>
            </div>
          )}

          {activeTab === "effects" && (
            <div>
              <h3 style={sectionTitleStyle}>Visual Effects</h3>
              <div style={chipRowStyle}>
                {EFFECTS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      setSelectedEffects((prev) => {
                        const next = new Set(prev);
                        if (next.has(e)) next.delete(e);
                        else next.add(e);
                        return next;
                      });
                    }}
                    style={chipStyle(selectedEffects.has(e))}
                  >
                    {titleCase(e)}
                  </button>
                ))}
              </div>
              <button onClick={runEffects} style={primaryButtonStyle}>
                Apply Effects
              </button>
            </div>
          )}

          {activeTab === "audio" && (
            <div>
              <h3 style={sectionTitleStyle}>Audio Remix</h3>
              <div style={chipRowStyle}>
                {(["music", "sfx", "speed", "voice"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAudioMode(m)}
                    style={chipStyle(audioMode === m)}
                  >
                    {titleCase(m)}
                  </button>
                ))}
              </div>

              {audioMode === "music" && (
                <div>
                  <label style={{ fontSize: 13 }}>
                    Genre
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value as (typeof GENRES)[number])}
                      style={inputStyle}
                    >
                      {GENRES.map((g) => (
                        <option key={g} value={g}>
                          {titleCase(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {audioMode === "sfx" && (
                <div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={newSfxTs}
                      onChange={(e) => setNewSfxTs(parseFloat(e.target.value) || 0)}
                      placeholder="Timestamp (s)"
                      style={{ ...inputStyle, width: 120 }}
                    />
                    <select
                      value={newSfxId}
                      onChange={(e) => setNewSfxId(e.target.value as (typeof SFX)[number])}
                      style={{ ...inputStyle, width: 160 }}
                    >
                      {SFX.map((s) => (
                        <option key={s} value={s}>
                          {titleCase(s)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={-24}
                      max={12}
                      step={1}
                      value={newSfxVol}
                      onChange={(e) => setNewSfxVol(parseFloat(e.target.value) || 0)}
                      placeholder="Vol dB"
                      style={{ ...inputStyle, width: 100 }}
                    />
                    <button
                      onClick={() =>
                        setSfxEntries((prev) => [
                          ...prev,
                          { timestampSecs: newSfxTs, effectId: newSfxId, volumeDb: newSfxVol },
                        ])
                      }
                      style={secondaryButtonStyle}
                    >
                      Add
                    </button>
                  </div>
                  <ul style={{ marginTop: 10, padding: 0, listStyle: "none" }}>
                    {sfxEntries.map((entry, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          background: "#1c1c2a",
                          borderRadius: 6,
                          marginBottom: 4,
                        }}
                      >
                        <span>
                          @{entry.timestampSecs.toFixed(1)}s · {titleCase(entry.effectId)} ·{" "}
                          {entry.volumeDb >= 0 ? "+" : ""}
                          {entry.volumeDb} dB
                        </span>
                        <button
                          onClick={() =>
                            setSfxEntries((prev) => prev.filter((_, j) => j !== i))
                          }
                          style={{
                            background: "transparent",
                            color: "#f72585",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {audioMode === "speed" && (
                <label style={{ fontSize: 13 }}>
                  Speed factor ({speedFactor.toFixed(2)}×)
                  <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={speedFactor}
                    onChange={(e) => setSpeedFactor(parseFloat(e.target.value))}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </label>
              )}

              {audioMode === "voice" && (
                <label style={{ fontSize: 13 }}>
                  Target voice
                  <select
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value as (typeof VOICES)[number])}
                    style={inputStyle}
                  >
                    {VOICES.map((v) => (
                      <option key={v} value={v}>
                        {titleCase(v)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button onClick={runAudio} style={primaryButtonStyle}>
                Apply Audio Remix
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: 10,
            background: "#401520",
            borderRadius: 6,
            color: "#ffd1d8",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Publish form – only for completed video remixes */}
      {currentJob && currentJob.status === "completed" && isVideoJob(currentJob) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginTop: 24,
            padding: 16,
            background: "#141420",
            borderRadius: 12,
          }}
        >
          <h3 style={sectionTitleStyle}>🚀 Publish to Quanttube</h3>
          <input
            value={publishTitle}
            onChange={(e) => setPublishTitle(e.target.value)}
            placeholder="Title (required)"
            style={inputStyle}
          />
          <textarea
            value={publishDescription}
            onChange={(e) => setPublishDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <input
            value={publishTags}
            onChange={(e) => setPublishTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            style={inputStyle}
          />
          <button
            disabled={!canPublish}
            onClick={publish}
            style={{
              ...primaryButtonStyle,
              opacity: canPublish ? 1 : 0.5,
              cursor: canPublish ? "pointer" : "not-allowed",
            }}
          >
            Publish Remix
          </button>
          {publishInfo && (
            <div style={{ marginTop: 10, color: "#7ee787" }}>
              ✅ Published as <strong>{publishInfo.remixId}</strong> — Remixed from @
              {publishInfo.originalCreatorHandle ?? creatorHandle}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles (kept local – this component is self-contained).
// ---------------------------------------------------------------------------

const previewBoxStyle: React.CSSProperties = {
  background: "#0f0f17",
  borderRadius: 12,
  padding: 12,
  minHeight: 220,
  position: "relative",
  overflow: "hidden",
};
const previewLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  opacity: 0.7,
  marginBottom: 8,
};
const previewMediaStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
};
const placeholderStyle: React.CSSProperties = {
  height: 180,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#181826",
  borderRadius: 8,
  color: "#7a7a90",
};
const panelStyle: React.CSSProperties = {
  background: "#141420",
  borderRadius: 12,
  padding: 16,
};
const sectionTitleStyle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 12,
  fontSize: 16,
};
const chipRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 12,
};
function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid " + (active ? "#4cc9f0" : "#333"),
    background: active ? "#4cc9f022" : "#1c1c2a",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
}
const primaryButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 10,
  padding: "12px",
  background: "linear-gradient(90deg,#4361ee,#7209b7)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#4361ee",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: 6,
  marginBottom: 8,
  background: "#0f0f17",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 6,
  fontSize: 13,
};
