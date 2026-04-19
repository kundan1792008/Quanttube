"use client";

/**
 * LanguageSelector.tsx – Dubbed-language dropdown for the VideoPlayer.
 *
 * Features:
 *  • Dropdown listing all available dubbed languages with completion status.
 *  • "AI Generated" badge for AI-dubbed tracks.
 *  • "In Progress" badge for tracks being generated.
 *  • Seamless audio track switching without interrupting video playback.
 *  • Animated open/close via Framer Motion.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DubTrackStatus =
  | "available"
  | "in_progress"
  | "pending"
  | "failed";

export interface DubTrack {
  language: string;
  /** Human-readable language name */
  displayName: string;
  status: DubTrackStatus;
  /** Whether this track was AI-generated */
  isAiGenerated: boolean;
  /** URL to the dubbed audio file (null if not yet ready) */
  audioUrl: string | null;
  /** Completion percentage for in-progress tracks */
  progressPct?: number;
}

export interface LanguageSelectorProps {
  /** Currently selected language code */
  currentLanguage: string;
  /** Original/source language of the video */
  originalLanguage?: string;
  /** Available dubbed tracks */
  dubTracks: DubTrack[];
  /** Called when the user selects a language */
  onLanguageSelect: (language: string, audioUrl: string | null) => void;
  /** Whether to show the "Request dub" button */
  showRequestDub?: boolean;
  onRequestDub?: (language: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Language display helpers
// ---------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  fa: "Persian",
  he: "Hebrew",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  ur: "Urdu",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  hu: "Hungarian",
  cs: "Czech",
  sk: "Slovak",
  ro: "Romanian",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  el: "Greek",
  ca: "Catalan",
  sw: "Swahili",
};

export function getLanguageDisplayName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

// Flag emoji helper (returns regional indicator symbols)
export function getLanguageFlag(code: string): string {
  const flagMap: Record<string, string> = {
    en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹",
    pt: "🇵🇹", nl: "🇳🇱", pl: "🇵🇱", ru: "🇷🇺", uk: "🇺🇦",
    ar: "🇸🇦", fa: "🇮🇷", he: "🇮🇱", hi: "🇮🇳", bn: "🇧🇩",
    ta: "🇮🇳", te: "🇮🇳", mr: "🇮🇳", ur: "🇵🇰", zh: "🇨🇳",
    ja: "🇯🇵", ko: "🇰🇷", vi: "🇻🇳", th: "🇹🇭", id: "🇮🇩",
    ms: "🇲🇾", tr: "🇹🇷", sv: "🇸🇪", da: "🇩🇰", no: "🇳🇴",
    fi: "🇫🇮", hu: "🇭🇺", cs: "🇨🇿", sk: "🇸🇰", ro: "🇷🇴",
    bg: "🇧🇬", hr: "🇭🇷", sr: "🇷🇸", sl: "🇸🇮", el: "🇬🇷",
    ca: "🏴", sw: "🇰🇪",
  };
  return flagMap[code] ?? "🌐";
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status, isAiGenerated }: { status: DubTrackStatus; isAiGenerated: boolean }) {
  if (status === "in_progress") {
    return (
      <span
        style={{
          fontSize: 9,
          padding: "2px 5px",
          borderRadius: 10,
          background: "rgba(255,165,0,0.25)",
          color: "#ffaa00",
          border: "1px solid rgba(255,165,0,0.4)",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        IN PROGRESS
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        style={{
          fontSize: 9,
          padding: "2px 5px",
          borderRadius: 10,
          background: "rgba(128,128,128,0.25)",
          color: "#aaa",
          border: "1px solid rgba(128,128,128,0.4)",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        QUEUED
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        style={{
          fontSize: 9,
          padding: "2px 5px",
          borderRadius: 10,
          background: "rgba(255,50,50,0.2)",
          color: "#ff6b6b",
          border: "1px solid rgba(255,50,50,0.4)",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        FAILED
      </span>
    );
  }

  // Available
  if (isAiGenerated) {
    return (
      <span
        style={{
          fontSize: 9,
          padding: "2px 5px",
          borderRadius: 10,
          background: "rgba(99,179,237,0.2)",
          color: "#63b3ed",
          border: "1px solid rgba(99,179,237,0.4)",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        ✦ AI DUBBED
      </span>
    );
  }

  return (
    <span
      style={{
        fontSize: 9,
        padding: "2px 5px",
        borderRadius: 10,
        background: "rgba(72,199,142,0.2)",
        color: "#48c78e",
        border: "1px solid rgba(72,199,142,0.4)",
        whiteSpace: "nowrap",
        fontWeight: 600,
      }}
    >
      ORIGINAL
    </span>
  );
}

// ---------------------------------------------------------------------------
// LanguageSelector component
// ---------------------------------------------------------------------------

export default function LanguageSelector({
  currentLanguage,
  originalLanguage = "en",
  dubTracks,
  onLanguageSelect,
  showRequestDub = false,
  onRequestDub,
  className = "",
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const handleSelect = useCallback(
    async (track: DubTrack | null) => {
      if (switching) return;

      // Allow selecting original language
      const lang = track?.language ?? originalLanguage;
      const audioUrl = track?.audioUrl ?? null;

      if (lang === currentLanguage) {
        setIsOpen(false);
        return;
      }

      setSwitching(true);
      setIsOpen(false);

      // Brief "switching" state for UX
      await new Promise((r) => setTimeout(r, 150));

      onLanguageSelect(lang, audioUrl);
      setSwitching(false);
    },
    [currentLanguage, originalLanguage, onLanguageSelect, switching]
  );

  const currentTrack = dubTracks.find((t) => t.language === currentLanguage);
  const currentLabel = getLanguageDisplayName(currentLanguage);
  const currentFlag = getLanguageFlag(currentLanguage);

  // Sort: original first, then available, then in_progress, then pending/failed
  const sortedTracks = [...dubTracks].sort((a, b) => {
    const priority = (t: DubTrack) => {
      if (t.language === originalLanguage) return 0;
      if (t.status === "available") return 1;
      if (t.status === "in_progress") return 2;
      if (t.status === "pending") return 3;
      return 4;
    };
    return priority(a) - priority(b);
  });

  return (
    <div
      ref={containerRef}
      className={`lang-selector ${className}`}
      style={{ position: "relative", display: "inline-block" }}
    >
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current audio language: ${currentLabel}`}
        disabled={switching}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "rgba(0,0,0,0.7)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 8,
          color: "#fff",
          cursor: switching ? "wait" : "pointer",
          fontSize: 13,
          backdropFilter: "blur(8px)",
          transition: "border-color 0.15s",
        }}
      >
        <span>{currentFlag}</span>
        <span>{switching ? "Switching…" : currentLabel}</span>
        {currentTrack?.isAiGenerated && (
          <span
            style={{
              fontSize: 9,
              padding: "1px 4px",
              borderRadius: 6,
              background: "rgba(99,179,237,0.25)",
              color: "#63b3ed",
              marginLeft: 2,
            }}
          >
            AI
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            transition: "transform 0.2s",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            marginLeft: 2,
          }}
        >
          ▾
        </span>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            aria-label="Select audio language"
            style={{
              position: "absolute",
              bottom: "110%",
              left: 0,
              minWidth: 220,
              maxHeight: 320,
              overflowY: "auto",
              background: "rgba(15,15,20,0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(12px)",
              zIndex: 100,
            }}
          >
            {/* Original language option */}
            <button
              role="option"
              aria-selected={currentLanguage === originalLanguage}
              onClick={() => handleSelect(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 12px",
                background: currentLanguage === originalLanguage
                  ? "rgba(99,179,237,0.12)"
                  : "transparent",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                textAlign: "left",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ fontSize: 16 }}>{getLanguageFlag(originalLanguage)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: currentLanguage === originalLanguage ? 600 : 400 }}>
                  {getLanguageDisplayName(originalLanguage)}
                </div>
                <div style={{ fontSize: 10, opacity: 0.6 }}>Original</div>
              </div>
              <StatusBadge status="available" isAiGenerated={false} />
              {currentLanguage === originalLanguage && (
                <span style={{ color: "#63b3ed", fontSize: 14 }}>✓</span>
              )}
            </button>

            {/* Dubbed tracks */}
            {sortedTracks
              .filter((t) => t.language !== originalLanguage)
              .map((track) => {
                const isSelected = track.language === currentLanguage;
                const isSelectable = track.status === "available";

                return (
                  <button
                    key={track.language}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={!isSelectable}
                    onClick={() => isSelectable ? handleSelect(track) : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
                      background: isSelected ? "rgba(99,179,237,0.12)" : "transparent",
                      border: "none",
                      color: isSelectable ? "#fff" : "rgba(255,255,255,0.45)",
                      cursor: isSelectable ? "pointer" : "default",
                      fontSize: 13,
                      textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (isSelectable) {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = isSelected
                        ? "rgba(99,179,237,0.12)"
                        : "transparent";
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{getLanguageFlag(track.language)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: isSelected ? 600 : 400 }}>
                        {track.displayName || getLanguageDisplayName(track.language)}
                      </div>
                      {track.status === "in_progress" && track.progressPct != null && (
                        <div style={{ marginTop: 3 }}>
                          <div
                            style={{
                              height: 2,
                              background: "rgba(255,255,255,0.15)",
                              borderRadius: 1,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${track.progressPct}%`,
                                background: "#ffaa00",
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <StatusBadge status={track.status} isAiGenerated={track.isAiGenerated} />
                    {isSelected && (
                      <span style={{ color: "#63b3ed", fontSize: 14, marginLeft: 4 }}>✓</span>
                    )}
                  </button>
                );
              })}

            {/* Request dub button */}
            {showRequestDub && onRequestDub && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <button
                  onClick={() => {
                    const lang = prompt("Enter language code (e.g. fr, de, ja):");
                    if (lang?.trim()) onRequestDub(lang.trim());
                  }}
                  style={{
                    width: "100%",
                    padding: "8px",
                    background: "rgba(99,179,237,0.1)",
                    border: "1px solid rgba(99,179,237,0.3)",
                    borderRadius: 6,
                    color: "#63b3ed",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  + Request AI Dub
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
