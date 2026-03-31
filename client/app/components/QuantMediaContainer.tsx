"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlaybackMode, useMedia } from "../context/MediaContext";
import styles from "./QuantMediaContainer.module.css";

/**
 * QuantMediaContainer – the Shape-Shifting Player UI.
 *
 * Dynamically switches its layout based on the global playback mode:
 *   • Cinema   – standard widescreen 16:9 video layout
 *   • ShortReel – immersive 9:16 vertical short-reel layout
 *   • AudioOnly – pure audio spectral-analyzer visualization
 *
 * Uses Framer Motion for immediate liquid-state transitions between layouts.
 */
export default function QuantMediaContainer() {
  const { state, setMode } = useMedia();

  return (
    <div className={styles.wrapper}>
      {/* Mode selector */}
      <nav className={styles.nav} aria-label="Playback mode selector">
        {Object.values(PlaybackMode).map((m) => (
          <button
            key={m}
            className={`${styles.modeBtn} ${state.mode === m ? styles.active : ""}`}
            onClick={() => setMode(m)}
            aria-pressed={state.mode === m}
          >
            {modeLabel(m)}
          </button>
        ))}
      </nav>

      {/* Animated layout container */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state.mode}
          className={`${styles.player} ${styles[state.mode]}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          role="region"
          aria-label={`${modeLabel(state.mode)} player`}
        >
          {state.mode === PlaybackMode.Cinema && <CinemaView />}
          {state.mode === PlaybackMode.ShortReel && <ShortReelView />}
          {state.mode === PlaybackMode.AudioOnly && <AudioOnlyView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-views for each layout                                           */
/* ------------------------------------------------------------------ */

function CinemaView() {
  return (
    <div className={styles.cinemaInner}>
      <div className={styles.videoPlaceholder}>
        <span>▶ Cinema Mode – 16 : 9</span>
      </div>
      <div className={styles.controls}>
        <span>⏮</span> <span>⏯</span> <span>⏭</span>
      </div>
    </div>
  );
}

function ShortReelView() {
  return (
    <div className={styles.reelInner}>
      <div className={styles.videoPlaceholder}>
        <span>▶ Short Reel – 9 : 16</span>
      </div>
      <aside className={styles.reelActions}>
        <button aria-label="Like">♥</button>
        <button aria-label="Comment">💬</button>
        <button aria-label="Share">↗</button>
      </aside>
    </div>
  );
}

function AudioOnlyView() {
  return (
    <div className={styles.audioInner}>
      <div className={styles.spectrumBar} aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <motion.div
            key={i}
            className={styles.bar}
            animate={{ height: `${20 + Math.random() * 60}%` }}
            transition={{
              repeat: Infinity,
              repeatType: "reverse",
              duration: 0.4 + Math.random() * 0.4,
            }}
          />
        ))}
      </div>
      <p className={styles.audioLabel}>🎧 Audio Only – Podcast / Spotify Mode</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function modeLabel(mode: PlaybackMode): string {
  switch (mode) {
    case PlaybackMode.Cinema:
      return "Cinema";
    case PlaybackMode.ShortReel:
      return "Short Reel";
    case PlaybackMode.AudioOnly:
      return "Audio Only";
  }
}
