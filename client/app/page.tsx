"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { MediaProvider } from "./context/MediaContext";
import QuantMediaContainer from "./components/QuantMediaContainer";
import PremiumPaywall from "./components/PremiumPaywall";

type GenState = "idle" | "generating" | "done";

const EXAMPLE_VIDEOS = [
  { id: "1", title: "Cyberpunk City: A Visual Journey", channel: "NeonDreams", views: "2.4M", duration: "12:34", thumb: "🌆" },
  { id: "2", title: "The Quantum Universe Explained", channel: "ScienceAI", views: "5.1M", duration: "18:22", thumb: "🔭" },
  { id: "3", title: "Lo-Fi Beats for Deep Focus", channel: "ChillWave", views: "890K", duration: "1:02:45", thumb: "🎵" },
  { id: "4", title: "AI Generates Your Next Meal", channel: "FoodFuture", views: "1.2M", duration: "8:15", thumb: "🍜" },
  { id: "5", title: "Black Holes: The Dark Frontier", channel: "CosmosAI", views: "3.7M", duration: "22:10", thumb: "🕳️" },
  { id: "6", title: "Neural Interface: 2040 Preview", channel: "TechVision", views: "4.9M", duration: "15:08", thumb: "🧠" },
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [genState, setGenState] = useState<GenState>("idle");
  const [showPaywall, setShowPaywall] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState("");

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenState("generating");
    setGeneratedTitle(prompt);
    await new Promise((r) => setTimeout(r, 2800));
    setGenState("done");
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-white/10 backdrop-blur-md bg-black/60">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">Quant</span>
          <span className="text-white">tube</span>
        </Link>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowPaywall(true)}
            className="px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-purple-600 to-cyan-600 hover:opacity-90 transition"
          >
            ✦ Go Pro
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-sm font-bold">
            Q
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-12 space-y-16">
        {/* Hero AI Prompt Section */}
        <section className="text-center space-y-8">
          <motion.h1
            className="text-5xl md:text-7xl font-extrabold tracking-tight"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
              Infinite AI Cinema
            </span>
          </motion.h1>
          <motion.p
            className="text-white/50 text-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            Every video ever imagined. Generated on demand.
          </motion.p>

          {/* Glowing Prompt Bar */}
          <motion.div
            className="relative max-w-3xl mx-auto"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600/30 to-cyan-600/30 rounded-2xl blur-xl" />
            <div className="relative flex gap-3 p-3 rounded-2xl border border-white/20 bg-white/5 backdrop-blur-md shadow-2xl">
              <span className="text-2xl self-center pl-2">✨</span>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleGenerate()}
                placeholder="What do you want to watch today?"
                className="flex-1 bg-transparent text-white placeholder-white/40 text-lg outline-none py-2"
              />
              <button
                onClick={() => void handleGenerate()}
                disabled={genState === "generating" || !prompt.trim()}
                className="px-6 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-600 to-cyan-600 hover:opacity-90 disabled:opacity-50 transition whitespace-nowrap"
              >
                Generate ▶
              </button>
            </div>
          </motion.div>

          {/* Generation State */}
          <AnimatePresence mode="wait">
            {genState === "generating" && (
              <motion.div
                key="generating"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8"
              >
                <div className="relative w-24 h-24">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute inset-0 rounded-full border-2 border-purple-500/60"
                      animate={{ scale: [1, 1.6 + i * 0.3], opacity: [0.8, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.4 }}
                    />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center text-4xl">🎬</div>
                </div>
                <p className="text-purple-300 text-lg font-semibold animate-pulse">
                  Generating Video with Quant AI...
                </p>
                <p className="text-white/40 text-sm">Synthesizing: &ldquo;{generatedTitle}&rdquo;</p>
              </motion.div>
            )}

            {genState === "done" && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-3xl mx-auto space-y-4"
              >
                <p className="text-green-400 text-sm font-semibold">✓ Video Generated Successfully</p>
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/5 backdrop-blur-md aspect-video flex items-center justify-center">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 to-cyan-900/30" />
                  <div className="relative z-10 text-center space-y-3">
                    <div className="text-6xl">▶</div>
                    <p className="text-white/80 font-semibold px-8">{generatedTitle}</p>
                    <Link
                      href="/watch/ai-generated-001"
                      className="inline-block px-6 py-2 rounded-full bg-gradient-to-r from-purple-600 to-cyan-600 text-sm font-semibold hover:opacity-90 transition"
                    >
                      Watch Now →
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Example Videos Feed */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-white/80">Trending Now</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {EXAMPLE_VIDEOS.map((video, i) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <Link href={`/watch/${video.id}`}>
                  <div className="group rounded-2xl overflow-hidden border border-white/10 bg-white/5 backdrop-blur-md hover:border-purple-500/50 hover:bg-white/10 transition-all duration-300 cursor-pointer">
                    <div className="aspect-video bg-gradient-to-br from-purple-900/40 to-cyan-900/40 flex items-center justify-center text-6xl group-hover:scale-105 transition-transform duration-300">
                      {video.thumb}
                    </div>
                    <div className="p-4 space-y-1">
                      <p className="font-semibold text-white line-clamp-2">{video.title}</p>
                      <p className="text-white/50 text-sm">{video.channel}</p>
                      <div className="flex gap-3 text-white/40 text-xs">
                        <span>{video.views} views</span>
                        <span>{video.duration}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Format Shifter Section */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-white/80">Format Shifter</h2>
          <p className="text-white/40 text-sm">Switch seamlessly between Cinema, Short Reel, and Podcast modes.</p>
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
