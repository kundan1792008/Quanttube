"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import SmartTranscript from "../../components/SmartTranscript";
import PremiumPaywall from "../../components/PremiumPaywall";
import QuantMediaContainer from "../../components/QuantMediaContainer";
import SocialWatchParty from "../../components/SocialWatchParty";
import VideoPlayer, { type PlayerAnalytics } from "../../components/VideoPlayer";
import { MediaProvider, PlaybackMode, useMedia } from "../../context/MediaContext";
import type { QuantumInterpolationProfile } from "../../services/FrameGenerator";

const LANGUAGES = [
  "English", "Japanese", "Spanish", "French", "German",
  "Hindi", "Portuguese", "Korean", "Arabic", "Italian",
  "Chinese (Mandarin)", "Russian", "Turkish", "Dutch", "Swedish",
];

type DubbingState = "idle" | "cloning" | "done";
type StreamLoadState = "loading" | "ready" | "fallback";

const API_BASE_URL = process.env.NEXT_PUBLIC_QUANTTUBE_API_BASE_URL ?? "http://localhost:4000";
const FALLBACK_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
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

interface StreamMetadataResponse {
  hlsManifestUrl: string;
  selectedTier: {
    resolution: string;
    bitrate: number;
  };
  quantumInterpolation: QuantumInterpolationProfile;
}

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <MediaProvider>
      <WatchExperience id={id} />
    </MediaProvider>
  );
}

function WatchExperience({ id }: { id: string }) {
  const { state } = useMedia();
  const [selectedLang, setSelectedLang] = useState("English");
  const [dubbingState, setDubbingState] = useState<DubbingState>("idle");
  const [showPaywall, setShowPaywall] = useState(false);
  const [showAds, setShowAds] = useState(true);
  const [playerAnalytics, setPlayerAnalytics] = useState<PlayerAnalytics | null>(null);
  const [streamLoadState, setStreamLoadState] = useState<StreamLoadState>("loading");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamSource, setStreamSource] = useState(FALLBACK_VIDEO_URL);
  const [streamTier, setStreamTier] = useState("demo");
  const [quantumProfile, setQuantumProfile] = useState<QuantumInterpolationProfile>(DEFAULT_QUANTUM_PROFILE);
  const lastVisualStreamRef = React.useRef(FALLBACK_VIDEO_URL);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStreamMetadata() {
      setStreamLoadState("loading");
      setStreamError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/v1/stream/${encodeURIComponent(id)}?engagementScore=0.85&mode=${encodeURIComponent(state.mode)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Stream metadata request failed with ${response.status}`);
        const payload = (await response.json()) as StreamMetadataResponse;
        const nextVisualSource = payload.hlsManifestUrl || FALLBACK_VIDEO_URL;
        if (state.mode !== PlaybackMode.AudioOnly) {
          lastVisualStreamRef.current = nextVisualSource;
        }
        setStreamSource(
          state.mode === PlaybackMode.AudioOnly ? lastVisualStreamRef.current : nextVisualSource
        );
        setStreamTier(payload.selectedTier.resolution);
        setQuantumProfile(payload.quantumInterpolation ?? DEFAULT_QUANTUM_PROFILE);
        setStreamLoadState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Failed to load stream metadata", error);
        setStreamSource(lastVisualStreamRef.current || FALLBACK_VIDEO_URL);
        setStreamTier(state.mode === PlaybackMode.AudioOnly ? "audio" : "demo");
        setQuantumProfile(DEFAULT_QUANTUM_PROFILE);
        setStreamLoadState("fallback");
        setStreamError(
          `Live stream metadata unavailable at ${API_BASE_URL}; demo playback enabled.${
            error instanceof Error ? ` ${error.message}` : ""
          }`
        );
      }
    }

    void loadStreamMetadata();
    return () => controller.abort();
  }, [id, state.mode]);

  const playbackHealth = useMemo(() => {
    if (!playerAnalytics) return "Collecting playback telemetry";
    if (playerAnalytics.bufferingEvents > 0) return `${playerAnalytics.bufferingEvents} recovery event(s) bridged`;
    if (streamLoadState === "fallback") return "Fallback stream active";
    return "Playback stable";
  }, [playerAnalytics, streamLoadState]);

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

              <div className="relative">
                <VideoPlayer
                  src={streamSource}
                  title="The Quantum Universe Explained"
                  autoPlay={false}
                  quantumProfile={quantumProfile}
                  onAnalytics={setPlayerAnalytics}
                />
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
              <div className="p-4 flex flex-col gap-4 border-t border-white/10">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Stream Tier</p>
                    <p className="mt-1 text-sm font-semibold text-white">{streamTier}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Quantum Target</p>
                    <p className="mt-1 text-sm font-semibold text-white">{quantumProfile.targetFrameRate} fps</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Recovery Window</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {quantumProfile.recovery.maxSyntheticSeconds}s bridge
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                    {streamLoadState === "ready" ? "Live quantum stream" : "Fallback quantum demo"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70">
                    Mode: {state.mode}
                  </span>
                  <span className="text-sm text-white/50">{playbackHealth}</span>
                  {streamError && <span className="text-sm text-amber-300">{streamError}</span>}
                  {playerAnalytics && (
                    <span className="text-sm text-white/40">
                      Watch time: {playerAnalytics.watchTime}s · Completion:{" "}
                      {Math.round(playerAnalytics.completionRate * 100)}%
                    </span>
                  )}
                </div>

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
          <QuantMediaContainer />
        </section>
      </div>

      <AnimatePresence>
        {showPaywall && <PremiumPaywall onClose={() => setShowPaywall(false)} />}
      </AnimatePresence>
    </main>
  );
}
