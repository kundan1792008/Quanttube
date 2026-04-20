"use client";

/**
 * AccessibilityPlayer.tsx – Accessible video player with AI-powered features.
 *
 * Features:
 *  • Caption overlay with full style customisation (font, color, background,
 *    position, size).
 *  • Audio description toggle with cue-based injection at dialogue pauses.
 *  • Playback speed controls: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×.
 *  • High contrast mode (WCAG AA/AAA compliant color scheme).
 *  • Complete keyboard navigation for all controls.
 *  • Screen reader compatible ARIA labels and live regions.
 *  • Sign language overlay (avatar or pre-rendered track).
 *  • Framer Motion transitions for smooth UI state changes.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useId,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaptionPosition = "bottom" | "top" | "middle";
export type CaptionAlignment = "left" | "center" | "right";

export interface CaptionStyleConfig {
  /** Font size in pixels (12–72) */
  fontSize: number;
  /** CSS color string for caption text */
  color: string;
  /** CSS color string for caption background (hex) */
  backgroundColor: string;
  /** Background box opacity (0–1) */
  backgroundOpacity: number;
  /** Caption position on screen */
  position: CaptionPosition;
  /** Text alignment */
  alignment: CaptionAlignment;
  /** Whether to render a text shadow */
  textShadow: boolean;
  /** Font family */
  fontFamily: string;
  /** Font weight */
  fontWeight: "normal" | "bold";
}

export interface CaptionCue {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Caption text */
  text: string;
  /** Speaker label (optional) */
  speaker?: string;
}

export interface AudioDescriptionCue {
  /** When to start playing this description (seconds) */
  insertAt: number;
  /** Duration of the description audio in seconds */
  durationSecs: number;
  /** Description text (read by screen reader or spoken via TTS audio) */
  text: string;
  /** Path/URL to the pre-synthesised audio file (optional) */
  audioUrl?: string;
}

export type SignLanguageMode = "none" | "overlay" | "side-panel";

export interface SignLanguageTrack {
  /** URL of the sign language video overlay */
  videoUrl: string;
  /** Language/variant label (e.g. "ASL", "BSL", "ISL") */
  label: string;
}

export interface AccessibilityPlayerProps {
  /** HLS manifest or direct video URL */
  src: string;
  /** Poster image URL */
  poster?: string;
  /** Video title for ARIA labels */
  title?: string;
  /** Caption cues for the video */
  captionCues?: CaptionCue[];
  /** Available caption language tracks (label → cues) */
  captionTracks?: Record<string, CaptionCue[]>;
  /** Initial caption language */
  initialCaptionLanguage?: string;
  /** Audio description cues */
  audioDescriptionCues?: AudioDescriptionCue[];
  /** Sign language tracks */
  signLanguageTracks?: SignLanguageTrack[];
  /** Auto-play on mount */
  autoPlay?: boolean;
  /** Initial mute state */
  muted?: boolean;
  /** Start playback at this offset (seconds) */
  startTime?: number;
  /** Callback when playback ends */
  onEnded?: () => void;
  /** Container className */
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const DEFAULT_CAPTION_STYLE: CaptionStyleConfig = {
  fontSize: 20,
  color: "#ffffff",
  backgroundColor: "#000000",
  backgroundOpacity: 0.75,
  position: "bottom",
  alignment: "center",
  textShadow: true,
  fontFamily: "Arial, sans-serif",
  fontWeight: "normal",
};

const HIGH_CONTRAST_CAPTION_STYLE: CaptionStyleConfig = {
  ...DEFAULT_CAPTION_STYLE,
  fontSize: 24,
  color: "#ffff00",
  backgroundColor: "#000000",
  backgroundOpacity: 1.0,
  fontWeight: "bold",
  textShadow: false,
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(opacity, 0, 1)})`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Caption text overlay rendered above the video */
function CaptionOverlay({
  cue,
  style,
  highContrast,
}: {
  cue: CaptionCue | null;
  style: CaptionStyleConfig;
  highContrast: boolean;
}) {
  const effectiveStyle = highContrast ? HIGH_CONTRAST_CAPTION_STYLE : style;

  const positionStyle: React.CSSProperties = useMemo(() => {
    const base: React.CSSProperties = {
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: "90%",
      textAlign: effectiveStyle.alignment,
      fontFamily: effectiveStyle.fontFamily,
      fontSize: `${effectiveStyle.fontSize}px`,
      fontWeight: effectiveStyle.fontWeight,
      color: effectiveStyle.color,
      backgroundColor: hexToRgba(
        effectiveStyle.backgroundColor,
        effectiveStyle.backgroundOpacity
      ),
      padding: "4px 12px",
      borderRadius: "4px",
      lineHeight: 1.4,
      wordBreak: "break-word",
      ...(effectiveStyle.textShadow
        ? { textShadow: "1px 1px 2px rgba(0,0,0,0.8)" }
        : {}),
    };

    switch (effectiveStyle.position) {
      case "top":
        return { ...base, top: "8%" };
      case "middle":
        return { ...base, top: "50%", transform: "translate(-50%, -50%)" };
      case "bottom":
      default:
        return { ...base, bottom: "14%" };
    }
  }, [effectiveStyle]);

  return (
    <AnimatePresence mode="wait">
      {cue && (
        <motion.div
          key={`${cue.start}-${cue.end}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`Caption: ${cue.text}`}
          style={positionStyle}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {cue.speaker && (
            <span
              style={{
                display: "block",
                fontSize: "0.75em",
                fontWeight: "bold",
                marginBottom: "2px",
                opacity: 0.85,
              }}
            >
              {cue.speaker}:
            </span>
          )}
          {cue.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Audio description live-region element */
function AudioDescriptionLiveRegion({ text }: { text: string }) {
  return (
    <div
      aria-live="assertive"
      aria-atomic="true"
      role="status"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {text}
    </div>
  );
}

/** Sign language overlay panel */
function SignLanguageOverlay({
  track,
  mode,
}: {
  track: SignLanguageTrack;
  mode: SignLanguageMode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  if (mode === "none") return null;

  const overlayStyle: React.CSSProperties =
    mode === "overlay"
      ? {
          position: "absolute",
          bottom: "14%",
          right: "2%",
          width: "22%",
          aspectRatio: "16/9",
          borderRadius: "8px",
          overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.6)",
          backgroundColor: "#000",
        }
      : {
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          backgroundColor: "#000",
        };

  return (
    <motion.div
      style={overlayStyle}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      aria-label={`Sign language interpreter: ${track.label}`}
    >
      <video
        ref={videoRef}
        src={track.videoUrl}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        muted
        playsInline
        aria-hidden="true"
      />
      <span
        style={{
          position: "absolute",
          top: "4px",
          left: "6px",
          fontSize: "11px",
          color: "#fff",
          backgroundColor: "rgba(0,0,0,0.6)",
          padding: "2px 6px",
          borderRadius: "3px",
        }}
        aria-hidden="true"
      >
        {track.label}
      </span>
    </motion.div>
  );
}

/** Caption style settings panel */
function CaptionSettingsPanel({
  style,
  onChange,
  onClose,
  labelPrefix,
}: {
  style: CaptionStyleConfig;
  onChange: (updates: Partial<CaptionStyleConfig>) => void;
  onClose: () => void;
  labelPrefix: string;
}) {
  const fontSizes = [14, 16, 18, 20, 24, 28, 32, 40];
  const positions: CaptionPosition[] = ["top", "middle", "bottom"];
  const alignments: CaptionAlignment[] = ["left", "center", "right"];

  return (
    <motion.div
      role="dialog"
      aria-label="Caption settings"
      aria-modal="true"
      style={{
        position: "absolute",
        bottom: "60px",
        right: "8px",
        backgroundColor: "#1a1a1a",
        color: "#fff",
        borderRadius: "8px",
        padding: "16px",
        width: "260px",
        zIndex: 50,
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
        fontSize: "14px",
      }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.15 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <strong>Caption Settings</strong>
        <button
          onClick={onClose}
          aria-label="Close caption settings"
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            padding: "2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Font size */}
      <label
        htmlFor={`${labelPrefix}-font-size`}
        style={{ display: "block", marginBottom: "6px" }}
      >
        Font size
      </label>
      <select
        id={`${labelPrefix}-font-size`}
        value={style.fontSize}
        onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
        style={{
          width: "100%",
          marginBottom: "10px",
          padding: "4px",
          backgroundColor: "#333",
          color: "#fff",
          border: "1px solid #555",
          borderRadius: "4px",
        }}
      >
        {fontSizes.map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
      </select>

      {/* Caption color */}
      <label
        htmlFor={`${labelPrefix}-text-color`}
        style={{ display: "block", marginBottom: "6px" }}
      >
        Text color
      </label>
      <input
        id={`${labelPrefix}-text-color`}
        type="color"
        value={style.color}
        onChange={(e) => onChange({ color: e.target.value })}
        style={{ marginBottom: "10px", cursor: "pointer" }}
        aria-label="Caption text color"
      />

      {/* Background color */}
      <label
        htmlFor={`${labelPrefix}-bg-color`}
        style={{ display: "block", marginBottom: "6px" }}
      >
        Background color
      </label>
      <input
        id={`${labelPrefix}-bg-color`}
        type="color"
        value={style.backgroundColor}
        onChange={(e) => onChange({ backgroundColor: e.target.value })}
        style={{ marginBottom: "10px", cursor: "pointer" }}
        aria-label="Caption background color"
      />

      {/* Background opacity */}
      <label
        htmlFor={`${labelPrefix}-bg-opacity`}
        style={{ display: "block", marginBottom: "6px" }}
      >
        Background opacity: {Math.round(style.backgroundOpacity * 100)}%
      </label>
      <input
        id={`${labelPrefix}-bg-opacity`}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={style.backgroundOpacity}
        onChange={(e) => onChange({ backgroundOpacity: Number(e.target.value) })}
        style={{ width: "100%", marginBottom: "10px" }}
        aria-label="Caption background opacity"
      />

      {/* Position */}
      <fieldset
        style={{ border: "none", padding: 0, marginBottom: "10px" }}
      >
        <legend style={{ marginBottom: "6px" }}>Position</legend>
        {positions.map((pos) => (
          <label
            key={pos}
            style={{ display: "inline-flex", alignItems: "center", marginRight: "12px", cursor: "pointer" }}
          >
            <input
              type="radio"
              name={`${labelPrefix}-position`}
              value={pos}
              checked={style.position === pos}
              onChange={() => onChange({ position: pos })}
              style={{ marginRight: "4px" }}
            />
            {pos.charAt(0).toUpperCase() + pos.slice(1)}
          </label>
        ))}
      </fieldset>

      {/* Alignment */}
      <fieldset style={{ border: "none", padding: 0, marginBottom: "10px" }}>
        <legend style={{ marginBottom: "6px" }}>Alignment</legend>
        {alignments.map((align) => (
          <label
            key={align}
            style={{ display: "inline-flex", alignItems: "center", marginRight: "12px", cursor: "pointer" }}
          >
            <input
              type="radio"
              name={`${labelPrefix}-alignment`}
              value={align}
              checked={style.alignment === align}
              onChange={() => onChange({ alignment: align })}
              style={{ marginRight: "4px" }}
            />
            {align.charAt(0).toUpperCase() + align.slice(1)}
          </label>
        ))}
      </fieldset>

      {/* Font weight */}
      <label
        style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={style.fontWeight === "bold"}
          onChange={(e) => onChange({ fontWeight: e.target.checked ? "bold" : "normal" })}
        />
        Bold text
      </label>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// HLS.js type stubs
// ---------------------------------------------------------------------------

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, cb: (name: string, data: unknown) => void): void;
}

interface HlsStatic {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AccessibilityPlayer({
  src,
  poster,
  title = "Video",
  captionCues = [],
  captionTracks = {},
  initialCaptionLanguage,
  audioDescriptionCues = [],
  signLanguageTracks = [],
  autoPlay = false,
  muted: initialMuted = false,
  startTime = 0,
  onEnded,
  className = "",
}: AccessibilityPlayerProps) {
  const instanceId = useId();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastAdCueRef = useRef<number>(-1);

  // ---------------------------------------------------------------------------
  // Playback state
  // ---------------------------------------------------------------------------
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackSpeed>(1);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // ---------------------------------------------------------------------------
  // Accessibility state
  // ---------------------------------------------------------------------------
  const [captionsEnabled, setCaptionsEnabled] = useState(captionCues.length > 0);
  const [captionLanguage, setCaptionLanguage] = useState<string>(
    initialCaptionLanguage ?? "default"
  );
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleConfig>(DEFAULT_CAPTION_STYLE);
  const [showCaptionSettings, setShowCaptionSettings] = useState(false);
  const [showCaptionLanguageMenu, setShowCaptionLanguageMenu] = useState(false);
  const [audioDescEnabled, setAudioDescEnabled] = useState(false);
  const [currentADText, setCurrentADText] = useState("");
  const [highContrastMode, setHighContrastMode] = useState(false);
  const [signLanguageMode, setSignLanguageMode] = useState<SignLanguageMode>("none");
  const [activeSignTrackIndex, setActiveSignTrackIndex] = useState(0);
  const [showSignLanguageMenu, setShowSignLanguageMenu] = useState(false);
  const [announceText, setAnnounceText] = useState("");

  // ---------------------------------------------------------------------------
  // Derived caption data
  // ---------------------------------------------------------------------------

  /** The caption track currently selected */
  const activeCaptionCues = useMemo<CaptionCue[]>(() => {
    if (captionLanguage !== "default" && captionTracks[captionLanguage]) {
      return captionTracks[captionLanguage]!;
    }
    return captionCues;
  }, [captionLanguage, captionCues, captionTracks]);

  /** Available caption languages */
  const captionLanguageOptions = useMemo(() => {
    const langs: Array<{ key: string; label: string }> = [];
    if (captionCues.length > 0) {
      langs.push({ key: "default", label: "Default" });
    }
    Object.keys(captionTracks).forEach((lang) => {
      langs.push({ key: lang, label: lang.toUpperCase() });
    });
    return langs;
  }, [captionCues, captionTracks]);

  /** The caption cue active at the current playback time */
  const activeCaptionCue = useMemo<CaptionCue | null>(() => {
    if (!captionsEnabled || activeCaptionCues.length === 0) return null;
    return (
      activeCaptionCues.find(
        (cue) => currentTime >= cue.start && currentTime <= cue.end
      ) ?? null
    );
  }, [captionsEnabled, activeCaptionCues, currentTime]);

  // ---------------------------------------------------------------------------
  // HLS setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (startTime > 0) {
      video.currentTime = startTime;
    }

    const initHls = async () => {
      if (src.includes(".m3u8")) {
        try {
          const { default: Hls } = (await import(
            "hls.js" as string
          )) as { default: HlsStatic };

          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src;
          }
        } catch {
          video.src = src;
        }
      } else {
        video.src = src;
      }

      if (autoPlay) {
        video.play().catch(() => setIsPlaying(false));
      }
    };

    initHls();

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, autoPlay, startTime]);

  // ---------------------------------------------------------------------------
  // Video event handlers
  // ---------------------------------------------------------------------------

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    onEnded?.();
  }, [onEnded]);
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  }, []);
  const handleDurationChange = useCallback(() => {
    const v = videoRef.current;
    if (v) setDuration(v.duration);
  }, []);
  const handleVolumeChange = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      setVolume(v.volume);
      setIsMuted(v.muted);
    }
  }, []);
  const handleWaiting = useCallback(() => setIsBuffering(true), []);
  const handleCanPlay = useCallback(() => setIsBuffering(false), []);

  // ---------------------------------------------------------------------------
  // Audio description playback
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!audioDescEnabled || audioDescriptionCues.length === 0) return;

    const currentCueIdx = audioDescriptionCues.findIndex(
      (cue) =>
        currentTime >= cue.insertAt &&
        currentTime <= cue.insertAt + cue.durationSecs
    );

    if (currentCueIdx === -1 || currentCueIdx === lastAdCueRef.current) return;

    lastAdCueRef.current = currentCueIdx;
    const cue = audioDescriptionCues[currentCueIdx]!;
    setCurrentADText(cue.text);

    // Play audio description audio if available
    if (cue.audioUrl) {
      adAudioRef.current?.pause();
      const audio = new Audio(cue.audioUrl);
      adAudioRef.current = audio;
      audio.play().catch(() => {
        // Audio play blocked – description text still shown to screen reader
      });
    }

    // Clear text after description duration
    const clearTimer = setTimeout(() => {
      setCurrentADText("");
    }, cue.durationSecs * 1000);

    return () => clearTimeout(clearTimer);
  }, [audioDescEnabled, audioDescriptionCues, currentTime]);

  // Stop AD audio on toggle off
  useEffect(() => {
    if (!audioDescEnabled) {
      adAudioRef.current?.pause();
      adAudioRef.current = null;
      setCurrentADText("");
      lastAdCueRef.current = -1;
    }
  }, [audioDescEnabled]);

  // ---------------------------------------------------------------------------
  // Playback rate sync
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate]);

  // ---------------------------------------------------------------------------
  // Fullscreen tracking
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // High contrast CSS variables
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (highContrastMode) {
      container.style.setProperty("--ctrl-bg", "#000000");
      container.style.setProperty("--ctrl-fg", "#ffff00");
      container.style.setProperty("--ctrl-border", "#ffff00");
      container.style.setProperty("--ctrl-focus-ring", "#ffff00");
    } else {
      container.style.removeProperty("--ctrl-bg");
      container.style.removeProperty("--ctrl-fg");
      container.style.removeProperty("--ctrl-border");
      container.style.removeProperty("--ctrl-focus-ring");
    }
  }, [highContrastMode]);

  // ---------------------------------------------------------------------------
  // Controls auto-hide
  // ---------------------------------------------------------------------------

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Control actions (defined before keyboard navigation to avoid hoisting issues)
  // ---------------------------------------------------------------------------

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl?.tagName === "INPUT" || activeEl?.tagName === "SELECT") return;
      if (!container.contains(activeEl) && activeEl !== container) return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) {
            video.play();
            setAnnounceText("Playing");
          } else {
            video.pause();
            setAnnounceText("Paused");
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          video.currentTime = clamp(video.currentTime + 5, 0, video.duration);
          setAnnounceText(`Seeked forward to ${formatTime(video.currentTime)}`);
          break;

        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = clamp(video.currentTime - 5, 0, video.duration);
          setAnnounceText(`Seeked back to ${formatTime(video.currentTime)}`);
          break;

        case "ArrowUp":
          e.preventDefault();
          video.volume = clamp(video.volume + 0.1, 0, 1);
          setAnnounceText(`Volume ${Math.round(video.volume * 100)}%`);
          break;

        case "ArrowDown":
          e.preventDefault();
          video.volume = clamp(video.volume - 0.1, 0, 1);
          setAnnounceText(`Volume ${Math.round(video.volume * 100)}%`);
          break;

        case "m":
        case "M":
          e.preventDefault();
          video.muted = !video.muted;
          setAnnounceText(video.muted ? "Muted" : "Unmuted");
          break;

        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;

        case "c":
        case "C":
          e.preventDefault();
          setCaptionsEnabled((prev) => {
            const next = !prev;
            setAnnounceText(next ? "Captions on" : "Captions off");
            return next;
          });
          break;

        case "a":
        case "A":
          e.preventDefault();
          setAudioDescEnabled((prev) => {
            const next = !prev;
            setAnnounceText(next ? "Audio descriptions on" : "Audio descriptions off");
            return next;
          });
          break;

        case ">":
          e.preventDefault();
          setPlaybackRate((prev) => {
            const idx = PLAYBACK_SPEEDS.indexOf(prev);
            const next = PLAYBACK_SPEEDS[Math.min(idx + 1, PLAYBACK_SPEEDS.length - 1)]!;
            setAnnounceText(`Speed ${next}×`);
            return next;
          });
          break;

        case "<":
          e.preventDefault();
          setPlaybackRate((prev) => {
            const idx = PLAYBACK_SPEEDS.indexOf(prev);
            const next = PLAYBACK_SPEEDS[Math.max(idx - 1, 0)]!;
            setAnnounceText(`Speed ${next}×`);
            return next;
          });
          break;

        case "h":
        case "H":
          e.preventDefault();
          setHighContrastMode((prev) => {
            const next = !prev;
            setAnnounceText(next ? "High contrast on" : "High contrast off");
            return next;
          });
          break;

        case "Home":
          e.preventDefault();
          video.currentTime = 0;
          setAnnounceText("Jumped to start");
          break;

        case "End":
          e.preventDefault();
          video.currentTime = video.duration;
          setAnnounceText("Jumped to end");
          break;

        default:
          return;
      }
      showControlsTemporarily();
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [showControlsTemporarily, toggleFullscreen]);

  // ---------------------------------------------------------------------------
  // Control actions
  // ---------------------------------------------------------------------------

  const togglePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
    } else {
      v.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const handleVolumeSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = Number(e.target.value);
    v.volume = val;
    v.muted = val === 0;
  }, []);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
  }, []);

  const handleCaptionStyleChange = useCallback((updates: Partial<CaptionStyleConfig>) => {
    setCaptionStyle((prev) => ({ ...prev, ...updates }));
  }, []);

  // ---------------------------------------------------------------------------
  // Shared control button styles
  // ---------------------------------------------------------------------------

  const ctrlBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: highContrastMode ? "var(--ctrl-fg, #fff)" : "#fff",
    cursor: "pointer",
    padding: "6px 8px",
    borderRadius: "4px",
    fontSize: "14px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    outline: "none",
    transition: "background-color 0.15s",
    minWidth: "32px",
    minHeight: "32px",
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const activeSignTrack =
    signLanguageTracks.length > 0 && signLanguageMode !== "none"
      ? signLanguageTracks[activeSignTrackIndex]
      : null;

  return (
    <div
      ref={containerRef}
      className={className}
      tabIndex={0}
      role="region"
      aria-label={`Video player: ${title}`}
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
      style={{
        position: "relative",
        backgroundColor: "#000",
        userSelect: "none",
        outline: "none",
        overflow: "hidden",
        borderRadius: "8px",
        ...(highContrastMode ? { outline: "3px solid #ffff00" } : {}),
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Video element                                                         */}
      {/* ------------------------------------------------------------------ */}
      <video
        ref={videoRef}
        poster={poster}
        muted={initialMuted}
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onVolumeChange={handleVolumeChange}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onClick={togglePlayPause}
        aria-label={title}
        style={{
          width: "100%",
          display: "block",
          cursor: "pointer",
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Sign language side panel (rendered outside video overlay)            */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {activeSignTrack && signLanguageMode === "side-panel" && (
          <SignLanguageOverlay track={activeSignTrack} mode="side-panel" />
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Overlay layer (captions, AD, sign overlay, buffering)                */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="false"
      >
        {/* Buffering spinner */}
        <AnimatePresence>
          {isBuffering && (
            <motion.div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-label="Buffering"
              role="status"
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: "4px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  animation: "ap-spin 0.8s linear infinite",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Caption overlay */}
        {captionsEnabled && (
          <CaptionOverlay
            cue={activeCaptionCue}
            style={captionStyle}
            highContrast={highContrastMode}
          />
        )}

        {/* Sign language overlay */}
        <AnimatePresence>
          {activeSignTrack && signLanguageMode === "overlay" && (
            <div style={{ pointerEvents: "auto" }}>
              <SignLanguageOverlay track={activeSignTrack} mode="overlay" />
            </div>
          )}
        </AnimatePresence>

        {/* Audio description live region (screen reader) */}
        <AudioDescriptionLiveRegion text={currentADText} />

        {/* Polite announcements for keyboard actions */}
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          }}
        >
          {announceText}
        </div>

        {/* Audio description toast (sighted users) */}
        <AnimatePresence>
          {audioDescEnabled && currentADText && (
            <motion.div
              role="status"
              style={{
                position: "absolute",
                top: "12px",
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: "rgba(0,0,0,0.82)",
                color: "#fff",
                padding: "6px 14px",
                borderRadius: "4px",
                fontSize: "14px",
                maxWidth: "80%",
                textAlign: "center",
                pointerEvents: "none",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              🔊 {currentADText}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Controls bar                                                          */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: highContrastMode
                ? "#000"
                : "linear-gradient(transparent, rgba(0,0,0,0.85))",
              padding: "8px 10px 10px",
            }}
          >
            {/* Progress bar */}
            <div style={{ marginBottom: "6px", position: "relative" }}>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={handleSeekChange}
                aria-label={`Seek: ${formatTime(currentTime)} of ${formatTime(duration)}`}
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={currentTime}
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                style={{
                  width: "100%",
                  appearance: "none",
                  height: "4px",
                  cursor: "pointer",
                  background: `linear-gradient(to right, ${highContrastMode ? "#ffff00" : "#e53e3e"} ${progressPercent}%, rgba(255,255,255,0.3) ${progressPercent}%)`,
                  borderRadius: "2px",
                  outline: "none",
                }}
              />
            </div>

            {/* Controls row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                flexWrap: "wrap",
              }}
            >
              {/* Play/Pause */}
              <button
                onClick={togglePlayPause}
                aria-label={isPlaying ? "Pause" : "Play"}
                style={ctrlBtnStyle}
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>

              {/* Mute */}
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                title={`${isMuted ? "Unmute" : "Mute"} (M)`}
                style={ctrlBtnStyle}
              >
                {isMuted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
              </button>

              {/* Volume slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeSlider}
                aria-label={`Volume: ${Math.round(volume * 100)}%`}
                aria-valuetext={`${Math.round(volume * 100)} percent`}
                style={{
                  width: "70px",
                  height: "4px",
                  cursor: "pointer",
                  accentColor: highContrastMode ? "#ffff00" : "#e53e3e",
                }}
              />

              {/* Time display */}
              <span
                aria-label={`Time: ${formatTime(currentTime)} of ${formatTime(duration)}`}
                style={{
                  color: highContrastMode ? "#ffff00" : "#fff",
                  fontSize: "13px",
                  minWidth: "80px",
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Playback speed */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowSpeedMenu((v) => !v)}
                  aria-label={`Playback speed: ${playbackRate}×`}
                  aria-expanded={showSpeedMenu}
                  aria-haspopup="listbox"
                  title="Playback speed (< / >)"
                  style={ctrlBtnStyle}
                >
                  {playbackRate}×
                </button>
                <AnimatePresence>
                  {showSpeedMenu && (
                    <motion.ul
                      role="listbox"
                      aria-label="Playback speed options"
                      style={{
                        position: "absolute",
                        bottom: "36px",
                        right: 0,
                        backgroundColor: "#1a1a1a",
                        border: "1px solid rgba(255,255,255,0.2)",
                        borderRadius: "6px",
                        padding: "4px 0",
                        listStyle: "none",
                        margin: 0,
                        zIndex: 60,
                        minWidth: "80px",
                      }}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.15 }}
                    >
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <li key={speed}>
                          <button
                            role="option"
                            aria-selected={playbackRate === speed}
                            onClick={() => {
                              setPlaybackRate(speed);
                              setShowSpeedMenu(false);
                              setAnnounceText(`Speed set to ${speed}×`);
                            }}
                            style={{
                              ...ctrlBtnStyle,
                              width: "100%",
                              justifyContent: "center",
                              backgroundColor:
                                playbackRate === speed
                                  ? "rgba(255,255,255,0.15)"
                                  : "transparent",
                              fontSize: "13px",
                              padding: "6px 12px",
                            }}
                          >
                            {speed}×
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Captions toggle */}
              {(captionCues.length > 0 || Object.keys(captionTracks).length > 0) && (
                <button
                  onClick={() => setCaptionsEnabled((v) => !v)}
                  aria-label={captionsEnabled ? "Disable captions (C)" : "Enable captions (C)"}
                  aria-pressed={captionsEnabled}
                  title="Toggle captions (C)"
                  style={{
                    ...ctrlBtnStyle,
                    backgroundColor: captionsEnabled
                      ? highContrastMode
                        ? "#ffff00"
                        : "rgba(255,255,255,0.25)"
                      : "transparent",
                    color: captionsEnabled && highContrastMode ? "#000" : "#fff",
                  }}
                >
                  CC
                </button>
              )}

              {/* Caption language selector */}
              {captionsEnabled && captionLanguageOptions.length > 1 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowCaptionLanguageMenu((v) => !v)}
                    aria-label={`Caption language: ${captionLanguage}`}
                    aria-expanded={showCaptionLanguageMenu}
                    aria-haspopup="listbox"
                    style={ctrlBtnStyle}
                    title="Caption language"
                  >
                    🌐
                  </button>
                  <AnimatePresence>
                    {showCaptionLanguageMenu && (
                      <motion.ul
                        role="listbox"
                        aria-label="Caption language"
                        style={{
                          position: "absolute",
                          bottom: "36px",
                          right: 0,
                          backgroundColor: "#1a1a1a",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "6px",
                          padding: "4px 0",
                          listStyle: "none",
                          margin: 0,
                          zIndex: 60,
                          minWidth: "100px",
                        }}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.15 }}
                      >
                        {captionLanguageOptions.map((opt) => (
                          <li key={opt.key}>
                            <button
                              role="option"
                              aria-selected={captionLanguage === opt.key}
                              onClick={() => {
                                setCaptionLanguage(opt.key);
                                setShowCaptionLanguageMenu(false);
                                setAnnounceText(`Captions: ${opt.label}`);
                              }}
                              style={{
                                ...ctrlBtnStyle,
                                width: "100%",
                                justifyContent: "center",
                                backgroundColor:
                                  captionLanguage === opt.key
                                    ? "rgba(255,255,255,0.15)"
                                    : "transparent",
                                fontSize: "13px",
                                padding: "6px 12px",
                              }}
                            >
                              {opt.label}
                            </button>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Caption style settings */}
              {captionsEnabled && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowCaptionSettings((v) => !v)}
                    aria-label="Caption style settings"
                    aria-expanded={showCaptionSettings}
                    aria-haspopup="dialog"
                    title="Caption settings"
                    style={ctrlBtnStyle}
                  >
                    ⚙️
                  </button>
                  <AnimatePresence>
                    {showCaptionSettings && (
                      <CaptionSettingsPanel
                        style={captionStyle}
                        onChange={handleCaptionStyleChange}
                        onClose={() => setShowCaptionSettings(false)}
                        labelPrefix={instanceId}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Audio description toggle */}
              {audioDescriptionCues.length > 0 && (
                <button
                  onClick={() => setAudioDescEnabled((v) => !v)}
                  aria-label={
                    audioDescEnabled
                      ? "Disable audio descriptions (A)"
                      : "Enable audio descriptions (A)"
                  }
                  aria-pressed={audioDescEnabled}
                  title="Toggle audio descriptions (A)"
                  style={{
                    ...ctrlBtnStyle,
                    backgroundColor: audioDescEnabled
                      ? highContrastMode
                        ? "#ffff00"
                        : "rgba(255,255,255,0.25)"
                      : "transparent",
                    color: audioDescEnabled && highContrastMode ? "#000" : "#fff",
                  }}
                >
                  AD
                </button>
              )}

              {/* Sign language */}
              {signLanguageTracks.length > 0 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowSignLanguageMenu((v) => !v)}
                    aria-label={`Sign language: ${signLanguageMode === "none" ? "off" : signLanguageTracks[activeSignTrackIndex]?.label ?? "on"}`}
                    aria-expanded={showSignLanguageMenu}
                    aria-haspopup="dialog"
                    aria-pressed={signLanguageMode !== "none"}
                    title="Sign language"
                    style={{
                      ...ctrlBtnStyle,
                      backgroundColor:
                        signLanguageMode !== "none"
                          ? highContrastMode
                            ? "#ffff00"
                            : "rgba(255,255,255,0.25)"
                          : "transparent",
                      color: signLanguageMode !== "none" && highContrastMode ? "#000" : "#fff",
                    }}
                  >
                    🤟
                  </button>
                  <AnimatePresence>
                    {showSignLanguageMenu && (
                      <motion.div
                        role="dialog"
                        aria-label="Sign language settings"
                        style={{
                          position: "absolute",
                          bottom: "36px",
                          right: 0,
                          backgroundColor: "#1a1a1a",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "6px",
                          padding: "10px",
                          zIndex: 60,
                          minWidth: "160px",
                          color: "#fff",
                          fontSize: "13px",
                        }}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.15 }}
                      >
                        <strong style={{ display: "block", marginBottom: "8px" }}>
                          Sign Language
                        </strong>

                        {/* Track selection */}
                        {signLanguageTracks.length > 1 && (
                          <div style={{ marginBottom: "8px" }}>
                            <label style={{ display: "block", marginBottom: "4px" }}>
                              Track
                            </label>
                            <select
                              value={activeSignTrackIndex}
                              onChange={(e) =>
                                setActiveSignTrackIndex(Number(e.target.value))
                              }
                              aria-label="Sign language track"
                              style={{
                                width: "100%",
                                backgroundColor: "#333",
                                color: "#fff",
                                border: "1px solid #555",
                                borderRadius: "4px",
                                padding: "3px",
                              }}
                            >
                              {signLanguageTracks.map((track, idx) => (
                                <option key={idx} value={idx}>
                                  {track.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Display mode */}
                        <div>
                          <label style={{ display: "block", marginBottom: "4px" }}>
                            Display
                          </label>
                          {(["none", "overlay", "side-panel"] as SignLanguageMode[]).map(
                            (mode) => (
                              <label
                                key={mode}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  marginBottom: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`${instanceId}-sl-mode`}
                                  value={mode}
                                  checked={signLanguageMode === mode}
                                  onChange={() => {
                                    setSignLanguageMode(mode);
                                    setShowSignLanguageMenu(false);
                                    setAnnounceText(
                                      mode === "none"
                                        ? "Sign language off"
                                        : `Sign language ${mode}`
                                    );
                                  }}
                                />
                                {mode === "none"
                                  ? "Off"
                                  : mode === "overlay"
                                  ? "Overlay"
                                  : "Side Panel"}
                              </label>
                            )
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* High contrast mode */}
              <button
                onClick={() => setHighContrastMode((v) => !v)}
                aria-label={
                  highContrastMode
                    ? "Disable high contrast mode (H)"
                    : "Enable high contrast mode (H)"
                }
                aria-pressed={highContrastMode}
                title="High contrast mode (H)"
                style={{
                  ...ctrlBtnStyle,
                  backgroundColor: highContrastMode
                    ? "#ffff00"
                    : "transparent",
                  color: highContrastMode ? "#000" : "#fff",
                }}
              >
                ◑
              </button>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
                title={`${isFullscreen ? "Exit" : "Enter"} fullscreen (F)`}
                style={ctrlBtnStyle}
              >
                {isFullscreen ? "⊡" : "⛶"}
              </button>
            </div>

            {/* Keyboard shortcuts help */}
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "11px",
                marginTop: "4px",
                textAlign: "center",
              }}
              aria-hidden="true"
            >
              Space/K: Play · M: Mute · F: Fullscreen · C: Captions · A: Audio Desc · H: High Contrast · {"< / >: Speed"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Keyframe animation for buffering spinner (injected once)             */}
      {/* ------------------------------------------------------------------ */}
      <style>{`
        @keyframes ap-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
