"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlaybackMode } from "../context/MediaContext";

export interface TransitionEngineProps {
  mode: PlaybackMode;
  activeSource: string;
  upcomingSources: string[];
  preloadCount?: number;
  bridgeHint?: string;
  children: ReactNode;
}

interface PreloadedAsset {
  src: string;
  kind: "video" | "audio";
}

function detectKind(src: string): "video" | "audio" {
  const normalized = src.toLowerCase();
  if (normalized.endsWith(".mp3") || normalized.endsWith(".aac") || normalized.endsWith(".m4a") || normalized.endsWith(".ogg")) {
    return "audio";
  }
  return "video";
}

/**
 * TransitionEngine preloads upcoming media sources and provides a subtle
 * visual bridge when mode/source changes, keeping playback handoff smooth.
 */
export default function TransitionEngine({
  mode,
  activeSource,
  upcomingSources,
  preloadCount = 2,
  bridgeHint,
  children,
}: TransitionEngineProps) {
  const [preloaded, setPreloaded] = useState<PreloadedAsset[]>([]);

  const queue = useMemo(() => upcomingSources.slice(0, Math.max(0, preloadCount)), [upcomingSources, preloadCount]);

  useEffect(() => {
    let cancelled = false;
    const loaded: PreloadedAsset[] = [];

    async function warmSource(src: string): Promise<void> {
      const kind = detectKind(src);
      if (kind === "audio") {
        const el = new Audio();
        el.preload = "auto";
        el.src = src;
      } else {
        const video = document.createElement("video");
        video.preload = "auto";
        video.src = src;
        video.muted = true;
        video.playsInline = true;
      }
      loaded.push({ src, kind });
    }

    (async () => {
      await Promise.all(queue.map((src) => warmSource(src)));
      if (!cancelled) setPreloaded(loaded);
    })().catch(() => {
      if (!cancelled) setPreloaded([]);
    });

    return () => {
      cancelled = true;
    };
  }, [queue]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <AnimatePresence>
        <motion.div
          key={`${mode}:${activeSource}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.16, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, rgba(20,20,20,0.88), rgba(36,56,88,0.28), rgba(20,20,20,0.88))",
            pointerEvents: "none",
            zIndex: 2,
          }}
          aria-hidden="true"
        />
      </AnimatePresence>

      {bridgeHint ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 10,
            zIndex: 3,
            fontSize: "0.72rem",
            letterSpacing: "0.01em",
            opacity: 0.72,
            padding: "0.24rem 0.5rem",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(4,4,4,0.4)",
          }}
        >
          {bridgeHint}
        </div>
      ) : null}

      {children}

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 10,
          bottom: 10,
          zIndex: 3,
          fontSize: "0.65rem",
          opacity: 0.55,
          padding: "0.24rem 0.46rem",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(0,0,0,0.35)",
        }}
      >
        warm cache: {preloaded.length}
      </div>
    </div>
  );
}
