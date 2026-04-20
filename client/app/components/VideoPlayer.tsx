"use client";

/**
 * VideoPlayer.tsx – Custom HLS.js adaptive-bitrate video player.
 *
 * Features:
 *  • HLS.js integration with adaptive bitrate switching (auto + manual).
 *  • Custom controls: play/pause, seek bar, volume, fullscreen, PiP, speed.
 *  • Keyboard shortcuts: Space=play/pause, F=fullscreen, M=mute, arrows=seek±5s.
 *  • Double-tap left/right sides to seek ±10 s (mobile).
 *  • Thumbnail preview on seek bar hover.
 *  • Analytics tracking: watchTime, completionRate, qualitySwitches.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  QuantumBitrateRecovery,
  type RecoveryTelemetry,
} from "../services/BitrateRecovery";
import {
  QuantumFrameGenerator,
  type QuantumFrameTelemetry,
  type QuantumInterpolationProfile,
} from "../services/FrameGenerator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityLevel {
  index: number;
  label: string;
  height: number;
  bitrate: number;
}

export interface PlayerAnalytics {
  watchTime: number;
  completionRate: number;
  qualitySwitches: number;
  bufferingEvents: number;
  playbackStartedAt: string | null;
}

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  /** Thumbnail sprite URL for seek-bar preview */
  thumbnailSpriteUrl?: string;
  autoPlay?: boolean;
  muted?: boolean;
  startTime?: number;
  onAnalytics?: (analytics: PlayerAnalytics) => void;
  onEnded?: () => void;
  className?: string;
  quantumProfile?: Partial<QuantumInterpolationProfile>;
}

// ---------------------------------------------------------------------------
// HLS.js type stubs (avoids adding hls.js as a dependency in this stub)
// We dynamically import hls.js at runtime.
// ---------------------------------------------------------------------------

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, callback: (eventName: string, data: unknown) => void): void;
  currentLevel: number;
  levels: Array<{ height: number; bitrate: number }>;
  autoLevelEnabled: boolean;
  startLevel: number;
}

interface HlsStatic {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
}

interface NetworkInformationLike {
  downlink?: number;
}

const DEFAULT_QUANTUM_PROFILE: QuantumInterpolationProfile = {
  enabled: true,
  sourceFrameRate: 30,
  targetFrameRate: 120,
  generatedFramesPerSecond: 90,
  preferredRenderer: "webgpu-optical-flow",
  frameHistorySize: 12,
  telemetryIntervalMs: 500,
  memoryBudgetMb: 128,
  recovery: {
    strategy: "optical-flow-bridge",
    maxSyntheticSeconds: 8,
    rejoinGraceMs: 800,
    minBufferedSeconds: 1.5,
  },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNetworkConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

// ---------------------------------------------------------------------------
// VideoPlayer component
// ---------------------------------------------------------------------------

export default function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
  muted: initialMuted = false,
  startTime = 0,
  onAnalytics,
  onEnded,
  className = "",
  quantumProfile,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const analyticsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLInputElement>(null);
  const quantumFrameGeneratorRef = useRef<QuantumFrameGenerator | null>(null);
  const bitrateRecoveryRef = useRef<QuantumBitrateRecovery | null>(null);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const [quantumTelemetry, setQuantumTelemetry] = useState<QuantumFrameTelemetry | null>(null);
  const [recoveryTelemetry, setRecoveryTelemetry] = useState<RecoveryTelemetry | null>(null);

  // Quality state
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Speed options
  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Analytics
  const analyticsRef = useRef<PlayerAnalytics>({
    watchTime: 0,
    completionRate: 0,
    qualitySwitches: 0,
    bufferingEvents: 0,
    playbackStartedAt: null,
  });

  // Double-tap detection for mobile seek
  const lastTapRef = useRef<{ side: "left" | "right"; time: number } | null>(null);
  const [seekFeedback, setSeekFeedback] = useState<{ side: "left" | "right"; visible: boolean }>({
    side: "left",
    visible: false,
  });

  const resolvedQuantumProfile = useMemo<QuantumInterpolationProfile>(
    () => ({
      ...DEFAULT_QUANTUM_PROFILE,
      ...quantumProfile,
      recovery: {
        ...DEFAULT_QUANTUM_PROFILE.recovery,
        ...quantumProfile?.recovery,
      },
    }),
    [quantumProfile]
  );

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
          const { default: Hls } = await import("hls.js" as string) as { default: HlsStatic };

          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 90,
            });

            hls.loadSource(src);
            hls.attachMedia(video);
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, (_eventName, data) => {
              const d = data as { levels?: Array<{ height: number; bitrate: number }> };
              const levels: QualityLevel[] = (d?.levels ?? []).map((level, i) => ({
                index: i,
                label: `${level.height}p`,
                height: level.height,
                bitrate: level.bitrate,
              }));
              setQualityLevels(levels);
              setCurrentQuality(-1); // Auto
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (_eventName, data) => {
              const d = data as { level?: number };
              const lvl = d?.level ?? -1;
              analyticsRef.current.qualitySwitches += 1;
              setCurrentQuality(lvl);
            });

            hls.on(Hls.Events.ERROR, (_eventName, data) => {
              const d = data as { fatal?: boolean };
              if (d?.fatal) {
                hls.destroy();
              }
            });

          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Native HLS (Safari / iOS)
            video.src = src;
          }
        } catch {
          // hls.js not available – fall back to native or direct src
          video.src = src;
        }
      } else {
        video.src = src;
      }

      if (autoPlay) {
        video.play().catch(() => {
          // Autoplay blocked – set to paused state
          setIsPlaying(false);
        });
      }
    };

    initHls();

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, autoPlay, startTime]);

  useEffect(() => {
    const frameGenerator = new QuantumFrameGenerator(resolvedQuantumProfile);
    const bitrateRecovery = new QuantumBitrateRecovery(resolvedQuantumProfile);
    const unsubscribeFrameGenerator = frameGenerator.subscribe(setQuantumTelemetry);
    const unsubscribeBitrateRecovery = bitrateRecovery.subscribe(setRecoveryTelemetry);

    frameGenerator.setVideo(videoRef.current);
    quantumFrameGeneratorRef.current = frameGenerator;
    bitrateRecoveryRef.current = bitrateRecovery;

    return () => {
      unsubscribeFrameGenerator();
      unsubscribeBitrateRecovery();
      quantumFrameGeneratorRef.current?.dispose();
      bitrateRecoveryRef.current?.dispose();
      quantumFrameGeneratorRef.current = null;
      bitrateRecoveryRef.current = null;
    };
  }, [resolvedQuantumProfile]);

  useEffect(() => {
    quantumFrameGeneratorRef.current?.setVideo(videoRef.current);
  }, [src]);

  // ---------------------------------------------------------------------------
  // Video event handlers
  // ---------------------------------------------------------------------------

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    if (!analyticsRef.current.playbackStartedAt) {
      analyticsRef.current.playbackStartedAt = new Date().toISOString();
    }
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);

    if (duration > 0) {
      analyticsRef.current.completionRate = video.currentTime / duration;
    }

    const currentLevel =
      currentQuality >= 0 ? qualityLevels.find((level) => level.index === currentQuality) : qualityLevels[0];
    const connection = getNetworkConnection();

    bitrateRecoveryRef.current?.update({
      bufferedAheadSeconds: getBufferedAhead(video),
      buffering: isBuffering,
      currentBitrateKbps: currentLevel ? Math.round(currentLevel.bitrate / 1000) : 2500,
      playbackRate,
      throughputKbps: connection?.downlink ? Math.round(connection.downlink * 1000) : undefined,
    });
  }, [currentQuality, duration, isBuffering, playbackRate, qualityLevels]);

  const handleDurationChange = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
  }, []);

  const handleWaiting = useCallback(() => {
    setIsBuffering(true);
    analyticsRef.current.bufferingEvents += 1;
    quantumFrameGeneratorRef.current?.setBuffering(true);
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    quantumFrameGeneratorRef.current?.setBuffering(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    analyticsRef.current.completionRate = 1.0;
    onEnded?.();
  }, [onEnded]);

  const handleVolumeChange = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsMuted(video.muted);
    setVolume(video.volume);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("volumechange", handleVolumeChange);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [handlePlay, handlePause, handleTimeUpdate, handleDurationChange, handleWaiting, handleCanPlay, handleEnded, handleVolumeChange]);

  // ---------------------------------------------------------------------------
  // Analytics timer
  // ---------------------------------------------------------------------------

  useEffect(() => {
    analyticsTimerRef.current = setInterval(() => {
      if (isPlaying) {
        analyticsRef.current.watchTime += 1;
      }
      onAnalytics?.({ ...analyticsRef.current });
    }, 1000);

    return () => {
      if (analyticsTimerRef.current) clearInterval(analyticsTimerRef.current);
    };
  }, [isPlaying, onAnalytics]);

  // ---------------------------------------------------------------------------
  // Controls visibility timer
  // ---------------------------------------------------------------------------

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if (document.activeElement?.tagName === "INPUT") return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) {
            void video.play();
          } else {
            video.pause();
          }
          break;
        case "f":
        case "F":
          if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
          } else {
            document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
          }
          break;
        case "m":
        case "M":
          video.muted = !video.muted;
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = clamp(video.volume + 0.1, 0, 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = clamp(video.volume - 0.1, 0, 1);
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------------------------------------------------------------------------
  // Control actions
  // ---------------------------------------------------------------------------

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clamp(time, 0, video.duration);
  }, []);

  const handleSeekBarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  }, [seek]);

  const handleSeekBarHover = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    setSeekPreviewTime(fraction * duration);
  }, [duration]);

  const handleVolumeInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const v = parseFloat(e.target.value);
    video.volume = v;
    video.muted = v === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else {
        await video.requestPictureInPicture();
        setIsPip(true);
      }
    } catch {
      // PiP not supported
    }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  }, []);

  const setQuality = useCallback((levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    if (levelIndex === -1) {
      hls.currentLevel = -1;
      hls.autoLevelEnabled = true;
    } else {
      hls.currentLevel = levelIndex;
    }

    setCurrentQuality(levelIndex);
    setShowQualityMenu(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Double-tap (mobile seek)
  // ---------------------------------------------------------------------------

  const handleDoubleTap = useCallback((side: "left" | "right") => {
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && last.side === side && now - last.time < 400) {
      // Double-tap confirmed
      const video = videoRef.current;
      if (!video) return;

      const delta = side === "right" ? 10 : -10;
      video.currentTime = clamp(video.currentTime + delta, 0, video.duration);

      setSeekFeedback({ side, visible: true });
      setTimeout(() => setSeekFeedback((prev) => ({ ...prev, visible: false })), 800);
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { side, time: now };
      setTimeout(() => {
        if (lastTapRef.current?.time === now) {
          lastTapRef.current = null;
          togglePlayPause();
        }
      }, 400);
    }
  }, [togglePlayPause]);

  // ---------------------------------------------------------------------------
  // Progress bar fill
  // ---------------------------------------------------------------------------

  const progressPct = useMemo(
    () => (duration > 0 ? (currentTime / duration) * 100 : 0),
    [currentTime, duration]
  );

  const currentQualityLabel = useMemo(() => {
    if (currentQuality === -1) return "Auto";
    return qualityLevels.find((q) => q.index === currentQuality)?.label ?? "Auto";
  }, [currentQuality, qualityLevels]);

  const quantumStatusLabel = useMemo(() => {
    if (!quantumTelemetry?.active) return "Audio continuity";
    if (recoveryTelemetry?.status === "recovering") return "Recovery bridge active";
    if (recoveryTelemetry?.status === "protecting") return "Guarding playback";
    return "Interpolation stable";
  }, [quantumTelemetry, recoveryTelemetry]);

  const displaySourceFrameRate = useMemo<string>(
    () => (quantumTelemetry?.measuredSourceFrameRate ?? resolvedQuantumProfile.sourceFrameRate).toFixed(1),
    [quantumTelemetry, resolvedQuantumProfile.sourceFrameRate]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={`quant-player relative bg-black overflow-hidden select-none ${className}`}
      onMouseMove={resetControlsTimer}
      onMouseEnter={resetControlsTimer}
      style={{ aspectRatio: "16/9", borderRadius: "0.5rem" }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        poster={poster}
        muted={isMuted}
        playsInline
        className="w-full h-full object-contain"
        aria-label={title ?? "Video player"}
      />

      {(quantumTelemetry || recoveryTelemetry) && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "grid",
            gap: 6,
            maxWidth: 240,
            padding: "10px 12px",
            borderRadius: 12,
            background: "rgba(5, 10, 30, 0.72)",
            border: "1px solid rgba(120, 119, 255, 0.28)",
            color: "#fff",
            pointerEvents: "none",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <strong style={{ fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Quantum Playback
            </strong>
            <span
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 999,
                background:
                  recoveryTelemetry?.status === "recovering"
                    ? "rgba(244, 114, 182, 0.22)"
                    : "rgba(34, 197, 94, 0.22)",
              }}
            >
              {quantumStatusLabel}
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {displaySourceFrameRate} fps → {quantumTelemetry?.targetFrameRate ?? resolvedQuantumProfile.targetFrameRate} fps
          </div>
          <div style={{ fontSize: 11, opacity: 0.78 }}>
            Renderer: {formatRendererLabel(quantumTelemetry?.renderer ?? resolvedQuantumProfile.preferredRenderer)}
            {quantumTelemetry?.webgpuSupported ? " · WebGPU ready" : " · GPU fallback"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.78 }}>
            Synthetic frames: {Math.round(quantumTelemetry?.syntheticFramesPerSecond ?? 0)} / sec
          </div>
          <div style={{ fontSize: 11, opacity: 0.78 }}>
            Recovery window: {recoveryTelemetry?.plan.syntheticCoverageSeconds ?? 0}s · pressure{" "}
            {quantumTelemetry?.bufferPressure ?? "nominal"}
          </div>
        </div>
      )}

      {/* Buffering spinner */}
      <AnimatePresence>
        {isBuffering && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div
              style={{
                width: 48,
                height: 48,
                border: "4px solid rgba(255,255,255,0.3)",
                borderTop: "4px solid #fff",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Double-tap seek feedback */}
      <AnimatePresence>
        {seekFeedback.visible && (
          <motion.div
            key={seekFeedback.side}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              top: "50%",
              [seekFeedback.side === "left" ? "left" : "right"]: "12%",
              transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.6)",
              borderRadius: "50%",
              width: 64,
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 22,
              pointerEvents: "none",
            }}
          >
            {seekFeedback.side === "left" ? "⏪" : "⏩"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile tap zones */}
      <div
        style={{ position: "absolute", top: 0, left: 0, width: "30%", height: "100%", cursor: "pointer" }}
        onClick={() => handleDoubleTap("left")}
      />
      <div
        style={{ position: "absolute", top: 0, right: 0, width: "30%", height: "100%", cursor: "pointer" }}
        onClick={() => handleDoubleTap("right")}
      />

      {/* Controls overlay */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
              padding: "0 12px 10px",
            }}
          >
            {/* Title */}
            {title && (
              <div style={{ color: "#fff", fontSize: 13, paddingBottom: 6, opacity: 0.9 }}>
                {title}
              </div>
            )}

            {/* Seek bar */}
            <div style={{ position: "relative", marginBottom: 6 }}>
              <input
                ref={seekBarRef}
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeekBarChange}
                onMouseMove={handleSeekBarHover}
                onMouseLeave={() => setSeekPreviewTime(null)}
                aria-label="Seek"
                style={{
                  width: "100%",
                  accentColor: "#e63946",
                  cursor: "pointer",
                  height: 4,
                }}
              />
              {/* Seek preview tooltip */}
              {seekPreviewTime !== null && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 18,
                    left: `${(seekPreviewTime / (duration || 1)) * 100}%`,
                    transform: "translateX(-50%)",
                    background: "rgba(0,0,0,0.8)",
                    color: "#fff",
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatTime(seekPreviewTime)}
                </div>
              )}
            </div>

            {/* Controls row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
              {/* Play/Pause */}
              <button
                onClick={togglePlayPause}
                aria-label={isPlaying ? "Pause" : "Play"}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
              >
                {isPlaying ? "⏸" : "▶️"}
              </button>

              {/* Volume */}
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}
              >
                {isMuted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeInput}
                aria-label="Volume"
                style={{ width: 64, accentColor: "#e63946", cursor: "pointer" }}
              />

              {/* Time */}
              <span style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Playback speed */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => { setShowSpeedMenu((p) => !p); setShowQualityMenu(false); }}
                  aria-label="Playback speed"
                  style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
                >
                  {playbackRate}×
                </button>
                <AnimatePresence>
                  {showSpeedMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{
                        position: "absolute",
                        bottom: "110%",
                        right: 0,
                        background: "rgba(0,0,0,0.9)",
                        borderRadius: 6,
                        overflow: "hidden",
                        minWidth: 70,
                      }}
                    >
                      {SPEED_OPTIONS.map((rate) => (
                        <button
                          key={rate}
                          onClick={() => setSpeed(rate)}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "6px 10px",
                            background: playbackRate === rate ? "#e63946" : "transparent",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                            textAlign: "left",
                          }}
                        >
                          {rate}×
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Quality selector */}
              {qualityLevels.length > 0 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => { setShowQualityMenu((p) => !p); setShowSpeedMenu(false); }}
                    aria-label="Quality"
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
                  >
                    {currentQualityLabel}
                  </button>
                  <AnimatePresence>
                    {showQualityMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        style={{
                          position: "absolute",
                          bottom: "110%",
                          right: 0,
                          background: "rgba(0,0,0,0.9)",
                          borderRadius: 6,
                          overflow: "hidden",
                          minWidth: 80,
                        }}
                      >
                        <button
                          onClick={() => setQuality(-1)}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "6px 10px",
                            background: currentQuality === -1 ? "#e63946" : "transparent",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                            textAlign: "left",
                          }}
                        >
                          Auto
                        </button>
                        {[...qualityLevels].reverse().map((q) => (
                          <button
                            key={q.index}
                            onClick={() => setQuality(q.index)}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "6px 10px",
                              background: currentQuality === q.index ? "#e63946" : "transparent",
                              border: "none",
                              color: "#fff",
                              cursor: "pointer",
                              fontSize: 12,
                              textAlign: "left",
                            }}
                          >
                            {q.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* PiP */}
              {"pictureInPictureEnabled" in document && (
                <button
                  onClick={togglePip}
                  aria-label="Picture in Picture"
                  style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}
                >
                  {isPip ? "⬛" : "📺"}
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}
              >
                {isFullscreen ? "⊡" : "⊞"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress bar (always visible thin bar at bottom) */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 3,
          width: `${progressPct}%`,
          background: "#e63946",
          transition: "width 0.25s linear",
          pointerEvents: "none",
        }}
      />

      {/* Keyframe animation for spinner */}
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function getBufferedAhead(video: HTMLVideoElement): number {
  const { buffered, currentTime } = video;
  for (let i = 0; i < buffered.length; i += 1) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    if (currentTime >= start && currentTime <= end) {
      return Math.max(0, end - currentTime);
    }
  }
  return 0;
}

function formatRendererLabel(renderer: QuantumInterpolationProfile["preferredRenderer"]): string {
  switch (renderer) {
    case "webgpu-optical-flow":
      return "WebGPU optical flow";
    case "webgl-motion-fallback":
      return "WebGL fallback";
    case "audio-only":
      return "Audio-only bridge";
  }
}
