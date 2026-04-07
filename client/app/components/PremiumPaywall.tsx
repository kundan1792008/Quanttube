"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

const FEATURES = [
  { icon: "🎬", label: "4K AI Video Generation", desc: "Generate cinema-quality 4K videos on demand" },
  { icon: "🎙", label: "Unlimited Auto-Dubbing", desc: "Dub any video into 150+ languages instantly" },
  { icon: "✨", label: "AI Smart Notes", desc: "Auto-generate Notion-style docs for every video" },
  { icon: "🚫", label: "Zero Ad Interruptions", desc: "Pure, uninterrupted viewing experience" },
  { icon: "⚡", label: "Priority AI Processing", desc: "Skip the queue — your videos generate first" },
  { icon: "🔒", label: "QuantDocs Sync", desc: "Save and organize all your AI notes in one place" },
];

interface PremiumPaywallProps {
  onClose: () => void;
}

export default function PremiumPaywall({ onClose }: PremiumPaywallProps) {
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubscribe() {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSuccess(true);
    setLoading(false);
    await new Promise((r) => setTimeout(r, 1200));
    onClose();
  }

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-black/90 backdrop-blur-xl overflow-hidden shadow-2xl"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        {/* Gradient header */}
        <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-purple-900/60 to-cyan-900/40 border-b border-white/10">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition"
            aria-label="Close"
          >
            ✕
          </button>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">✦</span>
            <div>
              <p className="text-xs text-purple-300 font-semibold uppercase tracking-wider">Quanttube Pro</p>
              <h2 className="text-2xl font-extrabold text-white">Unlock the Full Cinema</h2>
            </div>
          </div>
          <p className="text-white/60 text-sm">
            4K AI Generation &amp; Unlimited Dubbing — experience video like never before.
          </p>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Plan toggle */}
          <div className="flex rounded-xl bg-white/5 border border-white/10 p-1">
            {(["monthly", "yearly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition capitalize ${
                  plan === p
                    ? "bg-gradient-to-r from-purple-600 to-cyan-600 text-white shadow"
                    : "text-white/50 hover:text-white"
                }`}
              >
                {p === "yearly" ? "Yearly (Save 33%)" : "Monthly"}
              </button>
            ))}
          </div>

          {/* Price */}
          <div className="text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-extrabold text-white">
                ${plan === "monthly" ? "20" : "160"}
              </span>
              <span className="text-white/40">/{plan === "monthly" ? "month" : "year"}</span>
            </div>
            {plan === "yearly" && (
              <p className="text-green-400 text-sm mt-1">You save $80/year</p>
            )}
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-start gap-2 p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-lg">{f.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-white">{f.label}</p>
                  <p className="text-xs text-white/40 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <motion.button
            onClick={() => void handleSubscribe()}
            disabled={loading || success}
            className="w-full py-4 rounded-2xl font-bold text-base bg-gradient-to-r from-purple-600 to-cyan-600 hover:opacity-90 disabled:opacity-70 transition relative overflow-hidden"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.div
                  className="w-4 h-4 rounded-full border-2 border-white border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                />
                Processing...
              </span>
            ) : success ? (
              "✓ Welcome to Quanttube Pro!"
            ) : (
              `Unlock Quanttube Pro — $${plan === "monthly" ? "20" : "160"}/${plan === "monthly" ? "mo" : "yr"}`
            )}
          </motion.button>

          <p className="text-center text-white/30 text-xs">
            Cancel anytime. No hidden fees. Billed via Quantpay.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
