"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Chapter {
  time: string;
  title: string;
  summary: string;
}

const MOCK_CHAPTERS: Chapter[] = [
  { time: "0:00", title: "Introduction to Quantum Mechanics", summary: "Overview of wave-particle duality and the historical context of quantum physics." },
  { time: "3:22", title: "The Double-Slit Experiment", summary: "Explores how observation affects quantum behavior; the foundational paradox of modern physics." },
  { time: "7:45", title: "Schrödinger's Cat & Superposition", summary: "Understanding quantum superposition through the famous thought experiment." },
  { time: "11:10", title: "Quantum Entanglement", summary: "How entangled particles share state regardless of distance — Einstein's 'spooky action.'" },
  { time: "14:55", title: "Real-World Applications", summary: "Quantum computing, quantum cryptography, and the future of technology in 2040." },
];

interface SmartTranscriptProps {
  videoId: string;
}

export default function SmartTranscript({ videoId: _videoId }: SmartTranscriptProps) {
  const [isGenerating, setIsGenerating] = useState(true);
  const [visibleChapters, setVisibleChapters] = useState<Chapter[]>([]);
  const [saved, setSaved] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < MOCK_CHAPTERS.length) {
        setVisibleChapters((prev) => [...prev, MOCK_CHAPTERS[i]]);
        i++;
      } else {
        setIsGenerating(false);
        clearInterval(interval);
      }
    }, 600);
    return () => clearInterval(interval);
  }, []);

  async function handleSave() {
    setSaved(true);
    await new Promise((r) => setTimeout(r, 1500));
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <h2 className="font-semibold text-sm text-white">AI Smart Chapters</h2>
          {isGenerating && (
            <motion.span
              className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30"
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              Live
            </motion.span>
          )}
        </div>
        <motion.button
          onClick={() => void handleSave()}
          disabled={saved || isGenerating}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
            saved
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-purple-600/80 hover:bg-purple-600 text-white disabled:opacity-50"
          }`}
          whileHover={!saved ? { scale: 1.04 } : undefined}
          whileTap={!saved ? { scale: 0.96 } : undefined}
        >
          {saved ? "✓ Saved to QuantDocs" : "✨ Save to QuantDocs"}
        </motion.button>
      </div>

      {/* Chapters */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
        <AnimatePresence>
          {visibleChapters.map((chapter, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setActiveChapter(i)}
              className={`rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                activeChapter === i
                  ? "bg-purple-500/20 border border-purple-500/40"
                  : "bg-white/5 border border-white/10 hover:bg-white/10"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-mono text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded">
                  {chapter.time}
                </span>
                <p className="text-sm font-semibold text-white">{chapter.title}</p>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">{chapter.summary}</p>
            </motion.div>
          ))}
        </AnimatePresence>

        {isGenerating && (
          <motion.div
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="flex gap-1">
              {[0, 1, 2].map((dot) => (
                <motion.div
                  key={dot}
                  className="w-1.5 h-1.5 rounded-full bg-purple-400"
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.2 }}
                />
              ))}
            </div>
            <span className="text-xs text-white/40">Analyzing video with Quant AI...</span>
          </motion.div>
        )}
      </div>

      {/* Full Transcript Toggle */}
      {!isGenerating && (
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-xs text-white/30 text-center">
            {MOCK_CHAPTERS.length} chapters generated • Click to navigate
          </p>
        </div>
      )}
    </div>
  );
}
