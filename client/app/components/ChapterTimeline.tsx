"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import styles from "./ChapterTimeline.module.css";
import Image from "next/image";

export interface TimelineChapter {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  confidence: number;
  summary: string;
  thumbnailUrl?: string;
}

export interface TimelineHighlight {
  id: string;
  timestampMs: number;
  score: number;
  confidence: number;
  reasons: string[];
}

export interface TimelineThumbnail {
  id: string;
  timestampMs: number;
  score: number;
  previewUrl: string;
  tags: string[];
}

export interface ChapterTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  chapters: TimelineChapter[];
  highlights: TimelineHighlight[];
  thumbnails: TimelineThumbnail[];
  onSeek: (timeMs: number) => void;
  onChapterSelect?: (chapterId: string) => void;
  title?: string;
}

interface HoverState {
  xPx: number;
  timestampMs: number;
}

const SEEK_STEP_MS = 5_000;
const SEEK_STEP_LARGE_MS = 15_000;

export default function ChapterTimeline({
  durationMs,
  currentTimeMs,
  chapters,
  highlights,
  thumbnails,
  onSeek,
  onChapterSelect,
  title = "Chapter Timeline",
}: ChapterTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isKeyboardFocus, setIsKeyboardFocus] = useState(false);

  const safeDurationMs = Math.max(durationMs, 1);
  const currentPercent = clamp((currentTimeMs / safeDurationMs) * 100, 0, 100);

  const chapterPalette = useMemo(
    () => [
      "#7c3aed",
      "#0ea5e9",
      "#22c55e",
      "#eab308",
      "#f97316",
      "#ef4444",
      "#ec4899",
      "#14b8a6",
    ],
    []
  );

  const chapterSegments = useMemo(() => {
    return chapters.map((chapter, idx) => {
      const startPct = clamp((chapter.startMs / safeDurationMs) * 100, 0, 100);
      const endPct = clamp((chapter.endMs / safeDurationMs) * 100, 0, 100);
      return {
        ...chapter,
        index: idx,
        startPct,
        endPct,
        widthPct: Math.max(0.8, endPct - startPct),
        color: chapterPalette[idx % chapterPalette.length],
      };
    });
  }, [chapters, safeDurationMs, chapterPalette]);

  const highlightMarkers = useMemo(() => {
    return highlights.map((highlight) => ({
      ...highlight,
      leftPct: clamp((highlight.timestampMs / safeDurationMs) * 100, 0, 100),
      radiusPx: clamp(6 + highlight.score * 2.4, 6, 16),
    }));
  }, [highlights, safeDurationMs]);

  const thumbnailLookup = useMemo(() => {
    const sorted = [...thumbnails].sort((a, b) => a.timestampMs - b.timestampMs);

    return (timestampMs: number): TimelineThumbnail | null => {
      if (sorted.length === 0) return null;
      let nearest: TimelineThumbnail = sorted[0];
      let nearestDistance = Math.abs(sorted[0].timestampMs - timestampMs);
      for (let i = 1; i < sorted.length; i += 1) {
        const distance = Math.abs(sorted[i].timestampMs - timestampMs);
        if (distance < nearestDistance) {
          nearest = sorted[i];
          nearestDistance = distance;
        }
      }
      return nearest;
    };
  }, [thumbnails]);

  const chapterAtCurrentTime = useMemo(() => {
    return (
      chapterSegments.find(
        (chapter) => currentTimeMs >= chapter.startMs && currentTimeMs < chapter.endMs
      ) ?? chapterSegments[chapterSegments.length - 1] ?? null
    );
  }, [chapterSegments, currentTimeMs]);

  const hoverPreview = useMemo(() => {
    if (!hover) return null;
    const chapter =
      chapterSegments.find(
        (candidate) => hover.timestampMs >= candidate.startMs && hover.timestampMs < candidate.endMs
      ) ?? null;
    const thumbnail = thumbnailLookup(hover.timestampMs);
    const nearestHighlight =
      highlightMarkers.reduce<{ marker: TimelineHighlight | null; distance: number }>(
        (best, marker) => {
          const distance = Math.abs(marker.timestampMs - hover.timestampMs);
          if (distance < best.distance) {
            return { marker, distance };
          }
          return best;
        },
        { marker: null, distance: Number.POSITIVE_INFINITY }
      ).marker ?? null;
    return { chapter, thumbnail, nearestHighlight };
  }, [hover, chapterSegments, thumbnailLookup, highlightMarkers]);

  const seekByPointerEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relative = clamp((clientX - rect.left) / rect.width, 0, 1);
      const timestampMs = Math.floor(relative * safeDurationMs);
      onSeek(timestampMs);
    },
    [onSeek, safeDurationMs]
  );

  const updateHoverByPointerEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relative = clamp((clientX - rect.left) / rect.width, 0, 1);
      setHover({
        xPx: relative * rect.width,
        timestampMs: Math.floor(relative * safeDurationMs),
      });
    },
    [safeDurationMs]
  );

  const seekWithDelta = useCallback(
    (deltaMs: number) => {
      const target = clamp(currentTimeMs + deltaMs, 0, safeDurationMs);
      onSeek(target);
    },
    [currentTimeMs, safeDurationMs, onSeek]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          seekWithDelta(SEEK_STEP_MS);
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekWithDelta(-SEEK_STEP_MS);
          break;
        case "PageDown":
          event.preventDefault();
          seekWithDelta(SEEK_STEP_LARGE_MS);
          break;
        case "PageUp":
          event.preventDefault();
          seekWithDelta(-SEEK_STEP_LARGE_MS);
          break;
        case "Home":
          event.preventDefault();
          onSeek(0);
          break;
        case "End":
          event.preventDefault();
          onSeek(safeDurationMs);
          break;
      }
    },
    [onSeek, safeDurationMs, seekWithDelta]
  );

  useEffect(() => {
    const onWindowMouseUp = () => {
      setIsKeyboardFocus(false);
    };
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const update = () => setTrackWidth(track.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(track);

    return () => observer.disconnect();
  }, []);

  return (
    <section className={styles.wrapper} aria-label={title}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          <p className={styles.subtitle}>
            Histogram scene boundaries, multi-signal highlights, and composition-ranked thumbnails
          </p>
        </div>
        <div className={styles.metaBlock}>
          <span>{formatMs(currentTimeMs)}</span>
          <span className={styles.separator}>/</span>
          <span>{formatMs(safeDurationMs)}</span>
        </div>
      </header>

      <div className={styles.trackOuter}>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Chapter timeline seek bar"
          aria-valuemin={0}
          aria-valuemax={safeDurationMs}
          aria-valuenow={Math.floor(clamp(currentTimeMs, 0, safeDurationMs))}
          aria-valuetext={formatMs(currentTimeMs)}
          className={`${styles.track} ${isKeyboardFocus ? styles.trackFocused : ""}`}
          onFocus={() => setIsKeyboardFocus(true)}
          onBlur={() => setIsKeyboardFocus(false)}
          onKeyDown={handleKeyDown}
          onMouseMove={(event) => updateHoverByPointerEvent(event.clientX)}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => seekByPointerEvent(event.clientX)}
        >
          <div className={styles.trackBase} />

          {chapterSegments.map((chapter) => (
            <motion.button
              key={chapter.id}
              className={styles.chapterSegment}
              style={{
                left: `${chapter.startPct}%`,
                width: `${chapter.widthPct}%`,
                background: chapter.color,
                opacity: chapterAtCurrentTime?.id === chapter.id ? 0.82 : 0.44,
              }}
              whileHover={{ opacity: 0.95, scaleY: 1.06 }}
              transition={{ duration: 0.15 }}
              aria-label={`Seek to ${chapter.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onSeek(chapter.startMs);
                onChapterSelect?.(chapter.id);
              }}
            />
          ))}

          <div className={styles.progressFill} style={{ width: `${currentPercent}%` }} />

          {highlightMarkers.map((highlight) => (
            <motion.button
              key={highlight.id}
              className={styles.highlightMarker}
              style={{
                left: `${highlight.leftPct}%`,
                width: highlight.radiusPx,
                height: highlight.radiusPx,
              }}
              animate={{
                boxShadow: [
                  "0 0 0 0 rgba(251, 191, 36, 0.15)",
                  "0 0 0 6px rgba(251, 191, 36, 0.1)",
                  "0 0 0 0 rgba(251, 191, 36, 0.05)",
                ],
              }}
              transition={{ duration: 1.8, repeat: Infinity }}
              aria-label={`Highlight at ${formatMs(highlight.timestampMs)}`}
              onClick={(event) => {
                event.stopPropagation();
                onSeek(highlight.timestampMs);
              }}
            />
          ))}

          <div className={styles.playhead} style={{ left: `${currentPercent}%` }} />

          <AnimatePresence>
            {hover && hoverPreview && (
              <motion.aside
                className={styles.hoverCard}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                style={{ left: clamp(hover.xPx, 72, Math.max(72, trackWidth - 72)) }}
              >
                <div className={styles.hoverTimestamp}>{formatMs(hover.timestampMs)}</div>
                {hoverPreview.thumbnail && (
                  <Image
                    src={hoverPreview.thumbnail.previewUrl}
                    alt=""
                    className={styles.previewImage}
                    width={320}
                    height={180}
                    loading="lazy"
                  />
                )}
                {hoverPreview.chapter && (
                  <div className={styles.hoverChapter}>
                    <strong>{hoverPreview.chapter.title}</strong>
                    <span>{hoverPreview.chapter.summary}</span>
                  </div>
                )}
                {hoverPreview.nearestHighlight && (
                  <div className={styles.hoverHighlight}>
                    <span className={styles.badge}>Highlight</span>
                    <span>
                      {hoverPreview.nearestHighlight.reasons.slice(0, 2).join(" · ") || "multi-signal"}
                    </span>
                  </div>
                )}
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className={styles.chapterList}>
        {chapterSegments.map((chapter) => {
          const active = chapterAtCurrentTime?.id === chapter.id;
          const chapterHighlights = highlightMarkers.filter(
            (highlight) => highlight.timestampMs >= chapter.startMs && highlight.timestampMs < chapter.endMs
          );

          return (
            <motion.button
              key={chapter.id}
              className={`${styles.chapterCard} ${active ? styles.chapterCardActive : ""}`}
              onClick={() => {
                onSeek(chapter.startMs);
                onChapterSelect?.(chapter.id);
              }}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.99 }}
            >
              <span className={styles.chapterColor} style={{ background: chapter.color }} />
              <div className={styles.chapterMain}>
                <div className={styles.chapterRow}>
                  <strong>{chapter.title}</strong>
                  <span>{formatMs(chapter.startMs)} - {formatMs(chapter.endMs)}</span>
                </div>
                <p>{chapter.summary}</p>
                <div className={styles.chapterMeta}>
                  <span>Confidence {Math.round(chapter.confidence * 100)}%</span>
                  <span>{chapterHighlights.length} highlights</span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function formatMs(timestampMs: number): string {
  const safeMs = Math.max(0, Math.floor(timestampMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
