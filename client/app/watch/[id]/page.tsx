"use client";

import React, { use, useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import SmartTranscript from "../../components/SmartTranscript";
import PremiumPaywall from "../../components/PremiumPaywall";
import QuantMediaContainer from "../../components/QuantMediaContainer";
import SocialWatchParty from "../../components/SocialWatchParty";
import { MediaProvider } from "../../context/MediaContext";
import ChapterTimeline, {
  type TimelineChapter,
  type TimelineHighlight,
  type TimelineThumbnail,
} from "../../components/ChapterTimeline";

const LANGUAGES = [
  "English", "Japanese", "Spanish", "French", "German",
  "Hindi", "Portuguese", "Korean", "Arabic", "Italian",
  "Chinese (Mandarin)", "Russian", "Turkish", "Dutch", "Swedish",
];

type DubbingState = "idle" | "cloning" | "done";

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedLang, setSelectedLang] = useState("English");
  const [dubbingState, setDubbingState] = useState<DubbingState>("idle");
  const [showPaywall, setShowPaywall] = useState(false);
  const [showAds, setShowAds] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineMs, setTimelineMs] = useState(0);
  const timelineDurationMs = 18 * 60 * 1000 + 22 * 1000;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setTimelineMs((prev) => {
        const next = prev + 1000;
        if (next >= timelineDurationMs) {
          setIsPlaying(false);
          return timelineDurationMs;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPlaying, timelineDurationMs]);

  const chapters = useMemo<TimelineChapter[]>(
    () => [
      {
        id: "chapter-1",
        title: "Chapter 1 · Quantum Foundations",
        startMs: 0,
        endMs: 4 * 60 * 1000 + 5 * 1000,
        confidence: 0.86,
        summary: "Core definitions, visual setup, and baseline narrative context for the episode.",
        thumbnailUrl: "https://picsum.photos/seed/q1/320/180",
      },
      {
        id: "chapter-2",
        title: "Chapter 2 · Wave Function Intuition",
        startMs: 4 * 60 * 1000 + 5 * 1000,
        endMs: 9 * 60 * 1000 + 20 * 1000,
        confidence: 0.82,
        summary: "Dynamic animation segment with high speech confidence and sustained viewer engagement.",
        thumbnailUrl: "https://picsum.photos/seed/q2/320/180",
      },
      {
        id: "chapter-3",
        title: "Chapter 3 · Entanglement in Practice",
        startMs: 9 * 60 * 1000 + 20 * 1000,
        endMs: 14 * 60 * 1000 + 10 * 1000,
        confidence: 0.88,
        summary: "High-impact explanatory scenes with multi-signal highlights and strong composition moments.",
        thumbnailUrl: "https://picsum.photos/seed/q3/320/180",
      },
      {
        id: "chapter-4",
        title: "Chapter 4 · Real-World Applications",
        startMs: 14 * 60 * 1000 + 10 * 1000,
        endMs: timelineDurationMs,
        confidence: 0.8,
        summary: "Case studies and synthesis block concluding with recap and forward-looking insights.",
        thumbnailUrl: "https://picsum.photos/seed/q4/320/180",
      },
    ],
    [timelineDurationMs]
  );

  const highlights = useMemo<TimelineHighlight[]>(
    () => [
      {
        id: "h-1",
        timestampMs: 95_000,
        score: 1.41,
        confidence: 0.88,
        reasons: ["audio-spike", "speech-emphasis"],
      },
      {
        id: "h-2",
        timestampMs: 3 * 60 * 1000 + 42 * 1000,
        score: 1.57,
        confidence: 0.91,
        reasons: ["motion-spike", "scene-novelty"],
      },
      {
        id: "h-3",
        timestampMs: 7 * 60 * 1000 + 11 * 1000,
        score: 1.22,
        confidence: 0.8,
        reasons: ["speech-emphasis", "text-overlay"],
      },
      {
        id: "h-4",
        timestampMs: 10 * 60 * 1000 + 49 * 1000,
        score: 1.69,
        confidence: 0.94,
        reasons: ["sentiment-shift", "face-saliency"],
      },
      {
        id: "h-5",
        timestampMs: 16 * 60 * 1000 + 30 * 1000,
        score: 1.3,
        confidence: 0.83,
        reasons: ["scene-novelty", "audio-spike"],
      },
    ],
    []
  );

  const thumbnails = useMemo<TimelineThumbnail[]>(
    () => [
      { id: "t-1", timestampMs: 70_000, score: 0.81, previewUrl: "https://picsum.photos/seed/t1/320/180", tags: ["faces"] },
      { id: "t-2", timestampMs: 260_000, score: 0.84, previewUrl: "https://picsum.photos/seed/t2/320/180", tags: ["action"] },
      { id: "t-3", timestampMs: 515_000, score: 0.86, previewUrl: "https://picsum.photos/seed/t3/320/180", tags: ["dialogue"] },
      { id: "t-4", timestampMs: 740_000, score: 0.88, previewUrl: "https://picsum.photos/seed/t4/320/180", tags: ["emotion"] },
      { id: "t-5", timestampMs: 980_000, score: 0.8, previewUrl: "https://picsum.photos/seed/t5/320/180", tags: ["high-context"] },
    ],
    []
  );

  async function handleDubbing(lang: string) {
    if (lang === "English") {
      setSelectedLang(lang);
      setDubbingState("idle");
      return;
    }
    setSelectedLang(lang);
    setDubbingState("cloning");
    await new Promise((r) => setTimeout(r, 2200));
    setDubbingState("done");
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-white/10 backdrop-blur-md bg-black/60">
        <Link href="/" className="text-xl font-bold">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">Quant</span>
          <span className="text-white">tube</span>
        </Link>
        <button
          onClick={() => setShowPaywall(true)}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-purple-600 to-cyan-600 hover:opacity-90 transition"
        >
          ✦ Go Pro
        </button>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Player Column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Video Player */}
            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/5 backdrop-blur-md">
              {/* Generative Product Placement Banner */}
              <AnimatePresence>
                {showAds && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between px-4 py-2 rounded-xl bg-black/70 backdrop-blur-md border border-yellow-500/30 text-xs"
                  >
                    <span className="text-yellow-400 font-semibold">
                      💰 Monetization Active: Inserting brand assets into the video stream via QuantAds.
                    </span>
                    <button
                      onClick={() => setShowAds(false)}
                      className="text-white/40 hover:text-white ml-3 transition"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Video Placeholder */}
              <div className="aspect-video bg-gradient-to-br from-purple-900/40 to-cyan-900/40 flex items-center justify-center relative">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 to-black/60" />
                <motion.button
                  className="relative z-10 w-20 h-20 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-4xl hover:bg-white/30 transition"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsPlaying(!isPlaying)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? "⏸" : "▶"}
                </motion.button>
                {dubbingState === "cloning" && (
                  <motion.div
                    className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 z-20"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <motion.div
                      className="w-12 h-12 rounded-full border-2 border-purple-500 border-t-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    <p className="text-purple-300 font-semibold">Cloning Voice in {selectedLang}...</p>
                  </motion.div>
                )}
              </div>

              {/* Player Controls */}
              <div className="p-4 flex flex-wrap items-center gap-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                  <span className="text-white/40 text-sm">
                    {Math.floor(timelineMs / 60_000)}:{String(Math.floor((timelineMs % 60_000) / 1000)).padStart(2, "0")} / 18:22
                  </span>
                </div>

                {/* Auto-Dubbing Dropdown */}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-white/60 text-sm whitespace-nowrap">🎙 Auto-Dub:</span>
                  <div className="relative">
                    <select
                      value={selectedLang}
                      onChange={(e) => void handleDubbing(e.target.value)}
                      className="appearance-none bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm text-white pr-8 cursor-pointer hover:bg-white/15 transition focus:outline-none focus:border-purple-500"
                      aria-label="Select dubbing language"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang} value={lang} className="bg-gray-900 text-white">
                          {lang}
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none">▾</span>
                  </div>
                  {dubbingState === "done" && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-green-400 text-xs font-semibold"
                    >
                      ✓ Dubbed
                    </motion.span>
                  )}
                </div>
              </div>
            </div>

            {/* Video Info */}
            <div className="space-y-3">
              <h1 className="text-2xl font-bold">The Quantum Universe Explained</h1>
              <div className="flex items-center gap-4 text-white/50 text-sm">
                <span>5.1M views</span>
                <span>•</span>
                <span>2 days ago</span>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center font-bold">
                  S
                </div>
                <div>
                  <p className="font-semibold text-sm">ScienceAI</p>
                  <p className="text-white/40 text-xs">2.3M subscribers</p>
                </div>
                <button className="ml-auto px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition">
                  Subscribe
                </button>
              </div>
            </div>

            <ChapterTimeline
              durationMs={timelineDurationMs}
              currentTimeMs={timelineMs}
              chapters={chapters}
              highlights={highlights}
              thumbnails={thumbnails}
              onSeek={setTimelineMs}
              onChapterSelect={() => {
                if (!isPlaying) {
                  setIsPlaying(true);
                }
              }}
            />
          </div>

          {/* Sidebar – Smart Transcript */}
          <div className="lg:col-span-1">
            <SmartTranscript videoId={id} />
          </div>
        </div>


        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-xl font-bold text-white/80">Live Watch Party</h2>
            <p className="text-sm text-white/40">
              Sync playback and chat with friends in real-time via WebSocket.
            </p>
          </div>
          <SocialWatchParty partyId={`party-${id}`} userId="viewer-local" />
        </section>

        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-xl font-bold text-white/80">Format Shift Engine</h2>
            <p className="text-sm text-white/40">
              Switch this session between cinema, short-reel, and audio-only layouts.
            </p>
          </div>
          <MediaProvider>
            <QuantMediaContainer />
          </MediaProvider>
        </section>
      </div>

      <AnimatePresence>
        {showPaywall && <PremiumPaywall onClose={() => setShowPaywall(false)} />}
      </AnimatePresence>
    </main>
  );
}
