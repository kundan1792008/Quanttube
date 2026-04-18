"use client";

/**
 * ChapterTimeline.tsx – Visual chapter markers with hover preview and
 * highlight quick-navigation for the Quanttube video player.
 *
 * Features:
 *  • Renders chapter markers as labelled segments on the seek bar.
 *  • Hover over any marker → floating preview card showing chapter
 *    thumbnail, title, start time, and a "Jump" button.
 *  • "Highlights" pill row beneath the timeline for one-click highlight
 *    navigation (top-5 highlights with score badge).
 *  • Share specific chapter / highlight via deep-linkable URL fragment.
 *  • Framer Motion liquid transitions between hover states and highlight
 *    selection.
 *  • Fully keyboard-accessible: Tab to focus markers, Enter/Space to seek.
 *  • Responsive: collapses marker labels on narrow viewports.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types (mirror server-side models, no runtime import needed)
// ---------------------------------------------------------------------------

export interface ChapterData {
  chapterId: string;
  chapterIndex: number;
  startSecs: number;
  endSecs: number;
  durationSecs: number;
  title: string;
  thumbnailTimestampSecs: number;
  thumbnailUrl?: string;
  transcriptExcerpt?: string;
}

export interface HighlightData {
  highlightId: string;
  rank: number;
  startSecs: number;
  endSecs: number;
  durationSecs: number;
  score: number;
  label: string;
  peakFrameTimestampSecs: number;
  shareFragment: string;
  thumbnailUrl?: string;
}

export interface ChapterTimelineProps {
  /** Total video duration in seconds. */
  durationSecs: number;
  /** Current playback position in seconds. */
  currentTimeSecs: number;
  /** Array of chapters to display. */
  chapters: ChapterData[];
  /** Array of highlights to display. */
  highlights: HighlightData[];
  /** Callback to seek the player to a specific time. */
  onSeek: (timeSecs: number) => void;
  /** Optional base URL for generating share links. */
  shareBaseUrl?: string;
  /** Whether to show the highlights row. */
  showHighlights?: boolean;
  /** Class name for the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  }
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function scoreToPercent(score: number): number {
  return Math.round(score * 100);
}

function buildShareUrl(baseUrl: string, fragment: string): string {
  try {
    const url = new URL(baseUrl);
    url.hash = fragment;
    return url.toString();
  } catch {
    return `${baseUrl}#${fragment}`;
  }
}

// ---------------------------------------------------------------------------
// Sub-component: ChapterPreviewCard
// ---------------------------------------------------------------------------

interface ChapterPreviewCardProps {
  chapter: ChapterData;
  positionFraction: number; // 0–1 horizontal position in the timeline
  onJump: () => void;
  onShare: () => void;
  shareUrl: string;
  copied: boolean;
}

const CARD_WIDTH = 220;
const CARD_HEIGHT = 150;

function ChapterPreviewCard({
  chapter,
  positionFraction,
  onJump,
  onShare,
  shareUrl,
  copied,
}: ChapterPreviewCardProps) {
  // Keep the card horizontally within viewport.
  const leftPercent = Math.min(
    Math.max(positionFraction * 100, 5),
    95
  );

  return (
    <motion.div
      key={chapter.chapterId}
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        position: "absolute",
        bottom: "calc(100% + 12px)",
        left: `${leftPercent}%`,
        transform: "translateX(-50%)",
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
        zIndex: 50,
        pointerEvents: "auto",
      }}
      className="qt-chapter-preview-card"
      role="tooltip"
      aria-label={`Chapter preview: ${chapter.title}`}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: "100%",
          height: 110,
          background: chapter.thumbnailUrl
            ? `url(${chapter.thumbnailUrl}) center / cover no-repeat`
            : "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          borderRadius: "8px 8px 0 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Time badge */}
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 8,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          {formatTime(chapter.startSecs)}
        </span>

        {!chapter.thumbnailUrl && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.3)",
              fontSize: 11,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Chapter {chapter.chapterIndex + 1}
          </span>
        )}
      </div>

      {/* Info row */}
      <div
        style={{
          background: "rgba(15, 15, 25, 0.96)",
          backdropFilter: "blur(8px)",
          borderRadius: "0 0 8px 8px",
          padding: "8px 10px 10px",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTop: "none",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "#f0f0f0",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={chapter.title}
        >
          {chapter.title}
        </p>

        {chapter.transcriptExcerpt && (
          <p
            style={{
              margin: "4px 0 0",
              color: "rgba(255,255,255,0.45)",
              fontSize: 10,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {chapter.transcriptExcerpt}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 8,
          }}
        >
          <button
            onClick={onJump}
            style={{
              flex: 1,
              padding: "4px 0",
              background: "#e50914",
              border: "none",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.03em",
            }}
          >
            ▶ Jump
          </button>

          <button
            onClick={onShare}
            title={shareUrl}
            style={{
              padding: "4px 10px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              color: copied ? "#4ade80" : "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              transition: "color 0.2s",
            }}
          >
            {copied ? "✓ Copied" : "Share"}
          </button>
        </div>
      </div>

      {/* Pointer arrow */}
      <div
        style={{
          position: "absolute",
          bottom: -6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid rgba(15, 15, 25, 0.96)",
        }}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: HighlightPill
// ---------------------------------------------------------------------------

interface HighlightPillProps {
  highlight: HighlightData;
  isActive: boolean;
  onClick: () => void;
  onShare: () => void;
  copied: boolean;
}

function HighlightPill({
  highlight,
  isActive,
  onClick,
  onShare,
  copied,
}: HighlightPillProps) {
  const scoreColor = highlight.score > 0.7 ? "#f59e0b" : highlight.score > 0.5 ? "#3b82f6" : "#6b7280";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px 5px 8px",
        background: isActive
          ? "rgba(229, 9, 20, 0.25)"
          : "rgba(255, 255, 255, 0.06)",
        border: isActive
          ? "1px solid rgba(229, 9, 20, 0.6)"
          : "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 20,
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
      }}
      role="button"
      tabIndex={0}
      aria-label={`Jump to highlight: ${highlight.label} at ${formatTime(highlight.startSecs)}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Score dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: scoreColor,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />

      {/* Thumbnail miniature */}
      {highlight.thumbnailUrl && (
        <span
          style={{
            width: 28,
            height: 18,
            borderRadius: 3,
            background: `url(${highlight.thumbnailUrl}) center / cover no-repeat`,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
      )}

      <span
        style={{
          color: isActive ? "#fff" : "rgba(255,255,255,0.75)",
          fontSize: 11,
          fontWeight: isActive ? 700 : 500,
          whiteSpace: "nowrap",
        }}
      >
        {highlight.label}
      </span>

      <span
        style={{
          color: "rgba(255,255,255,0.4)",
          fontSize: 10,
          fontFamily: "monospace",
          marginLeft: 2,
        }}
      >
        {formatTime(highlight.startSecs)}
      </span>

      <span
        style={{
          background: scoreColor,
          color: "#000",
          fontSize: 9,
          fontWeight: 800,
          padding: "1px 4px",
          borderRadius: 3,
          letterSpacing: "0.02em",
        }}
      >
        {scoreToPercent(highlight.score)}%
      </span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onShare();
        }}
        title="Copy share link"
        style={{
          marginLeft: 2,
          padding: "1px 5px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 3,
          color: copied ? "#4ade80" : "rgba(255,255,255,0.5)",
          fontSize: 9,
          cursor: "pointer",
          transition: "color 0.2s",
          lineHeight: 1.4,
        }}
        aria-label="Copy share link for this highlight"
      >
        {copied ? "✓" : "⎘"}
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component: ChapterTimeline
// ---------------------------------------------------------------------------

export default function ChapterTimeline({
  durationSecs,
  currentTimeSecs,
  chapters,
  highlights,
  onSeek,
  shareBaseUrl,
  showHighlights = true,
  className = "",
}: ChapterTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Hover state for chapter preview.
  const [hoveredChapterId, setHoveredChapterId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active highlight (last clicked).
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  // Copy-to-clipboard feedback.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Width tracking for responsive label hiding.
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const showLabels = containerWidth >= 480;

  // ------ Derived values --------------------------------------------------

  const currentFraction = durationSecs > 0 ? currentTimeSecs / durationSecs : 0;

  const hoveredChapter = hoveredChapterId
    ? chapters.find((c) => c.chapterId === hoveredChapterId) ?? null
    : null;

  // ------ Interaction handlers -------------------------------------------

  const handleChapterHoverEnter = useCallback((chapterId: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredChapterId(chapterId);
    }, 120);
  }, []);

  const handleChapterHoverLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredChapterId(null);
    }, 200);
  }, []);

  const keepCardOpen = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  const closeCard = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredChapterId(null);
  }, []);

  const handleJump = useCallback(
    (timeSecs: number) => {
      onSeek(timeSecs);
      closeCard();
    },
    [onSeek, closeCard]
  );

  const handleHighlightClick = useCallback(
    (highlight: HighlightData) => {
      setActiveHighlightId(highlight.highlightId);
      onSeek(highlight.startSecs);
    },
    [onSeek]
  );

  const handleShare = useCallback(
    (id: string, fragment: string) => {
      const base = shareBaseUrl ?? (typeof window !== "undefined" ? window.location.href : "");
      const url = buildShareUrl(base.split("#")[0], fragment);

      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
      }

      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopiedId(id);
      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
    },
    [shareBaseUrl]
  );

  // ------ Render ----------------------------------------------------------

  if (durationSecs <= 0) return null;

  return (
    <div
      ref={containerRef}
      className={`qt-chapter-timeline ${className}`}
      style={{
        position: "relative",
        width: "100%",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      aria-label="Video chapter timeline"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Chapter bar                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
        role="group"
        aria-label="Chapters"
      >
        {chapters.map((chapter) => {
          const startFrac = chapter.startSecs / durationSecs;
          const endFrac = Math.min(1, chapter.endSecs / durationSecs);
          const widthFrac = endFrac - startFrac;
          const isActive =
            currentTimeSecs >= chapter.startSecs &&
            currentTimeSecs < chapter.endSecs;
          const isPast = currentTimeSecs >= chapter.endSecs;
          const isHovered = hoveredChapterId === chapter.chapterId;

          return (
            <div
              key={chapter.chapterId}
              style={{
                position: "relative",
                flex: `0 0 ${widthFrac * 100}%`,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              {/* Segment track */}
              <motion.div
                animate={{
                  height: isHovered ? 10 : isActive ? 8 : 4,
                }}
                transition={{ duration: 0.15 }}
                style={{
                  width: "100%",
                  borderRadius: 4,
                  background: isPast
                    ? "#e50914"
                    : isActive
                    ? "#ff4757"
                    : isHovered
                    ? "rgba(255,255,255,0.5)"
                    : "rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  overflow: "hidden",
                  position: "relative",
                }}
                role="button"
                tabIndex={0}
                aria-label={`${chapter.title} – starts at ${formatTime(chapter.startSecs)}`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => handleJump(chapter.startSecs)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleJump(chapter.startSecs);
                  }
                }}
                onMouseEnter={() => handleChapterHoverEnter(chapter.chapterId)}
                onMouseLeave={handleChapterHoverLeave}
                onFocus={() => handleChapterHoverEnter(chapter.chapterId)}
                onBlur={handleChapterHoverLeave}
              >
                {/* Progress fill within active chapter */}
                {isActive && (
                  <motion.div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      background: "#e50914",
                      borderRadius: 4,
                      width: `${
                        ((currentTimeSecs - chapter.startSecs) /
                          chapter.durationSecs) *
                        100
                      }%`,
                    }}
                  />
                )}
              </motion.div>

              {/* Chapter label */}
              {showLabels && widthFrac > 0.08 && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 14,
                    left: 0,
                    right: 0,
                    color: isActive
                      ? "rgba(255,255,255,0.95)"
                      : "rgba(255,255,255,0.4)",
                    fontSize: 9,
                    fontWeight: isActive ? 700 : 400,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textAlign: "center",
                    letterSpacing: "0.02em",
                    pointerEvents: "none",
                    transition: "color 0.2s",
                  }}
                  aria-hidden="true"
                >
                  {chapter.title}
                </span>
              )}

              {/* Boundary tick */}
              {chapter.chapterIndex > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: -1,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 2,
                    height: 14,
                    background: "rgba(0,0,0,0.6)",
                    borderRadius: 1,
                    zIndex: 2,
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Playhead indicator */}
        <motion.div
          aria-hidden="true"
          animate={{ left: `${currentFraction * 100}%` }}
          transition={{ duration: 0.05 }}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 0 6px rgba(0,0,0,0.6)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        />

        {/* Chapter preview card */}
        <AnimatePresence>
          {hoveredChapter && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                right: 0,
                pointerEvents: "none",
              }}
              onMouseEnter={keepCardOpen}
              onMouseLeave={closeCard}
            >
              <ChapterPreviewCard
                chapter={hoveredChapter}
                positionFraction={
                  (hoveredChapter.startSecs + hoveredChapter.durationSecs / 2) /
                  durationSecs
                }
                onJump={() => handleJump(hoveredChapter.startSecs)}
                onShare={() =>
                  handleShare(
                    hoveredChapter.chapterId,
                    `t=${Math.round(hoveredChapter.startSecs)}`
                  )
                }
                shareUrl={buildShareUrl(
                  shareBaseUrl ??
                    (typeof window !== "undefined" ? window.location.href : ""),
                  `t=${Math.round(hoveredChapter.startSecs)}`
                )}
                copied={copiedId === hoveredChapter.chapterId}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Chapter index row                                                    */}
      {/* ------------------------------------------------------------------ */}
      {chapters.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 6,
            overflowX: "auto",
            paddingBottom: 2,
            scrollbarWidth: "none",
          }}
          aria-label="Chapter list"
          role="list"
        >
          {chapters.map((chapter) => {
            const isActive =
              currentTimeSecs >= chapter.startSecs &&
              currentTimeSecs < chapter.endSecs;

            return (
              <motion.button
                key={chapter.chapterId}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
                style={{
                  flexShrink: 0,
                  padding: "3px 8px",
                  border: `1px solid ${isActive ? "rgba(229, 9, 20, 0.6)" : "rgba(255,255,255,0.12)"}`,
                  borderRadius: 4,
                  background: isActive
                    ? "rgba(229, 9, 20, 0.15)"
                    : "rgba(255, 255, 255, 0.04)",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.55)",
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.02em",
                  transition: "border-color 0.2s, background 0.2s, color 0.2s",
                }}
                aria-label={`Jump to ${chapter.title} at ${formatTime(chapter.startSecs)}`}
                aria-current={isActive ? "true" : undefined}
                role="listitem"
                onClick={() => handleJump(chapter.startSecs)}
                onMouseEnter={() => handleChapterHoverEnter(chapter.chapterId)}
                onMouseLeave={handleChapterHoverLeave}
              >
                <span style={{ opacity: 0.5, marginRight: 4, fontFamily: "monospace" }}>
                  {formatTime(chapter.startSecs)}
                </span>
                {chapter.title}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Highlights row                                                        */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {showHighlights && highlights.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {/* "Highlights" label */}
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
                aria-hidden="true"
              >
                ⚡ Highlights
              </span>

              {/* Scrollable pill row */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  overflowX: "auto",
                  paddingBottom: 2,
                  scrollbarWidth: "none",
                  flex: 1,
                }}
                role="list"
                aria-label="Video highlights"
              >
                <AnimatePresence>
                  {highlights.map((hl) => (
                    <div key={hl.highlightId} role="listitem">
                      <HighlightPill
                        highlight={hl}
                        isActive={activeHighlightId === hl.highlightId}
                        onClick={() => handleHighlightClick(hl)}
                        onShare={() =>
                          handleShare(hl.highlightId, hl.shareFragment)
                        }
                        copied={copiedId === hl.highlightId}
                      />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline styles injected once */}
      <style>{`
        .qt-chapter-timeline *:focus-visible {
          outline: 2px solid #e50914;
          outline-offset: 2px;
        }
        .qt-chapter-preview-card {
          pointer-events: auto;
        }
        /* Hide scrollbar for chapter/highlight rows */
        .qt-chapter-timeline div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
