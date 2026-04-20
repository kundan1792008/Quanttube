"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlaybackMode, useMedia } from "../context/MediaContext";
import styles from "./QuantMediaContainer.module.css";
import PlotSelector, { PlotChoice } from "./PlotSelector";

const QUANTTUBE_CONFIG = {
  apiBaseUrl: process.env.NEXT_PUBLIC_QUANTTUBE_API_BASE_URL ?? "http://localhost:4000",
  groupId: process.env.NEXT_PUBLIC_QUANTCHAT_GROUP_ID ?? "group-alpha",
  sharedBy: process.env.NEXT_PUBLIC_QUANTCHAT_MEMBER_ID ?? "member-owner",
  memberIds: (process.env.NEXT_PUBLIC_QUANTCHAT_MEMBER_IDS ?? "member-a,member-b,member-c")
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean),
} as const;

type DeepLinkPlatform = "ios" | "android" | "web";

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
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ReelShareResponse | null>(null);
  const [dashboard, setDashboard] = useState<AvatarDashboardState[]>([]);

  const { apiBaseUrl, groupId, sharedBy, memberIds } = QUANTTUBE_CONFIG;

  /**
   * Registry of in-flight AbortControllers.
   * On unmount every pending request is aborted to prevent state updates
   * on an unmounted component and to release network resources.
   */
  const pendingControllersRef = useRef<Set<AbortController>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const controllers = pendingControllersRef.current;
    return () => {
      mountedRef.current = false;
      for (const ctrl of controllers) {
        ctrl.abort();
      }
      controllers.clear();
    };
  }, []);

  /** Create an AbortController that is automatically de-registered on completion. */
  function createController(): AbortController {
    const ctrl = new AbortController();
    pendingControllersRef.current.add(ctrl);
    ctrl.signal.addEventListener("abort", () => {
      pendingControllersRef.current.delete(ctrl);
    });
    return ctrl;
  }

  const spectrumConfig = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const base = 28 + (i % 6) * 8;
        const peak = Math.min(92, base + 24 + (i % 4) * 4);
        const duration = 0.45 + (i % 5) * 0.08;
        return { base, peak, duration };
      }),
    []
  );

  async function refreshDashboard(signal?: AbortSignal) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/reels/quantsink/${encodeURIComponent(groupId)}/avatars`, { signal });
      if (!response.ok || !mountedRef.current) return;
      const payload = (await response.json()) as AvatarDashboardState[];
      if (mountedRef.current) setDashboard(payload);
    } catch {
      // noop for local dev without backend or when request is aborted
    }
  }

  async function shareReelToQuantchat() {
    const controller = createController();
    setShareLoading(true);
    setShareError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/reels/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reelId: "reel-hyper-001",
          groupId,
          sharedBy,
          memberIds,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ReelShareResponse | { error: string };
      if (!mountedRef.current) return;
      if (!response.ok) {
        setShareError("error" in payload ? payload.error : "Failed to share reel");
        return;
      }
      setShareData(payload as ReelShareResponse);
      await refreshDashboard(controller.signal);
    } catch {
      if (mountedRef.current) {
        setShareError(`Backend unavailable at ${apiBaseUrl}`);
      }
    } finally {
      pendingControllersRef.current.delete(controller);
      if (mountedRef.current) {
        setShareLoading(false);
      }
    }
  }

  async function simulateMemberClick(memberId: string, platform: DeepLinkPlatform) {
    if (!shareData) return;
    const controller = createController();
    try {
      await fetch(`${apiBaseUrl}/api/reels/share/${shareData.shareId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, platform }),
        signal: controller.signal,
      });
      if (mountedRef.current) await refreshDashboard(controller.signal);
    } catch {
      // noop for local dev without backend or when request is aborted
    } finally {
      pendingControllersRef.current.delete(controller);
    }
  }

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
          {state.mode === PlaybackMode.ShortReel && (
            <ShortReelView
              apiBaseUrl={apiBaseUrl}
              shareLoading={shareLoading}
              shareError={shareError}
              shareData={shareData}
              dashboard={dashboard}
              onShare={shareReelToQuantchat}
              onRefreshDashboard={refreshDashboard}
              onSimulateClick={simulateMemberClick}
            />
          )}
          {state.mode === PlaybackMode.AudioOnly && (
            <AudioOnlyView spectrumConfig={spectrumConfig} />
          )}
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

interface ShortReelViewProps {
  apiBaseUrl: string;
  shareLoading: boolean;
  shareError: string | null;
  shareData: ReelShareResponse | null;
  dashboard: AvatarDashboardState[];
  onShare: () => Promise<void>;
  onRefreshDashboard: () => Promise<void>;
  onSimulateClick: (memberId: string, platform: DeepLinkPlatform) => Promise<void>;
}

function ShortReelView({
  apiBaseUrl,
  shareLoading,
  shareError,
  shareData,
  dashboard,
  onShare,
  onRefreshDashboard,
  onSimulateClick,
}: ShortReelViewProps) {
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [choices, setChoices] = useState<PlotChoice[]>([]);
  const narrativeTokenRef = useRef<string | null>(null);
  const fallbackChoices = useMemo<PlotChoice[]>(
    () => [
      {
        id: "plot-negotiate",
        label: "Negotiate with the rival pilot before the storm closes in",
        contextHint: "Higher trust arc, lower immediate risk",
      },
      {
        id: "plot-pursue",
        label: "Pursue the encrypted beacon through the restricted zone",
        contextHint: "High-intensity chase with uncertain payoff",
      },
      {
        id: "plot-regroup",
        label: "Regroup with allies and reroute through the old tunnel",
        contextHint: "Safer route, possible lost time",
      },
    ],
    []
  );
  const effectiveChoices = choices.length > 0 ? choices : fallbackChoices;

  const fetchNarrativeChoices = useCallback(
    async (signal?: AbortSignal, selectedChoiceId?: string): Promise<void> => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/narrative/next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            userId: "quanttube-short-reel-user",
            preferences: ["adventure", "mystery"],
            continuityToken: narrativeTokenRef.current ?? undefined,
            selectedChoiceId,
          }),
        });
        if (!response.ok) {
          setChoices(fallbackChoices);
          return;
        }
        const payload = (await response.json()) as NarrativeSegmentResponse;
        narrativeTokenRef.current = payload.continuityToken;
        setChoices(
          payload.choices.map((choice) => ({
            id: choice.id,
            label: choice.label,
            contextHint: `Tone: ${choice.emotionalTone}`,
          }))
        );
      } catch {
        setChoices(fallbackChoices);
      }
    },
    [apiBaseUrl, fallbackChoices]
  );

  return (
    <div className={styles.reelInner}>
      <div className={styles.videoPlaceholder}>
        <span>▶ Short Reel – 9 : 16</span>
      </div>
      <aside className={styles.reelActions}>
        <button aria-label="Like">♥</button>
        <button aria-label="Comment">💬</button>
        <button aria-label="Share to Quantchat" onClick={() => void onShare()}>
          ↗
        </button>
      </aside>
      <section className={styles.reelPanel} aria-label="Quantchat reel share panel">
        <p className={styles.panelTitle}>Quantchat Group Share + FOMO Payload</p>
        <div className={styles.panelActions}>
          <button onClick={() => void onShare()} disabled={shareLoading}>
            {shareLoading ? "Sharing..." : "Share Reel"}
          </button>
          <button onClick={() => void onRefreshDashboard()}>Refresh Quantsink</button>
        </div>
        {shareError && <p className={styles.errorText}>{shareError}</p>}
        {shareData && (
          <div className={styles.payloadBlock}>
            <p>
              <strong>Share ID:</strong> {shareData.shareId}
            </p>
            <p>
              <strong>Payload:</strong> {shareData.fomoPayload.label} (
              {shareData.fomoPayload.pressureWindowSeconds}s)
            </p>
            <p>
              <strong>Deep Links:</strong> iOS / Android / Web
            </p>
            <ul>
              <li>{shareData.deepLinks.ios}</li>
              <li>{shareData.deepLinks.android}</li>
              <li>{shareData.deepLinks.web}</li>
            </ul>
            <div className={styles.panelActions}>
              {shareData.memberStates.map((member) => (
                <button
                  key={member.memberId}
                  onClick={() => void onSimulateClick(member.memberId, "android")}
                >
                  Click as {member.memberId}
                </button>
              ))}
            </div>
          </div>
        )}
        {dashboard.length > 0 && (
          <div className={styles.avatarGrid}>
            {dashboard.map((avatar) => (
              <div key={avatar.memberId} className={styles.avatarCard}>
                <span
                  className={`${styles.avatarDot} ${
                    avatar.avatarState === "gray"
                      ? styles.avatarGray
                      : avatar.avatarState === "pending"
                        ? styles.avatarPending
                        : styles.avatarActive
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{avatar.memberId}</strong>
                  <p>{avatar.avatarState}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <PlotSelector
          choices={effectiveChoices}
          onSelect={(choice) => {
            setSelectedPlotId(choice.id);
            void fetchNarrativeChoices(undefined, choice.id);
          }}
        />
        {selectedPlotId && (
          <p>
            <strong>Active branch:</strong> {selectedPlotId}
          </p>
        )}
      </section>
    </div>
  );
}

function AudioOnlyView({ spectrumConfig }: { spectrumConfig: SpectrumBarConfig[] }) {
  return (
    <div className={styles.audioInner}>
      <div className={styles.spectrumBar} aria-hidden="true">
        {spectrumConfig.map((bar, i) => (
          <motion.div
            key={i}
            className={styles.bar}
            animate={{ height: [`${bar.base}%`, `${bar.peak}%`] }}
            transition={{
              repeat: Infinity,
              repeatType: "reverse",
              duration: bar.duration,
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

interface FomoPayload {
  label: "FOMO_PAYLOAD";
  pressureWindowSeconds: number;
}

interface ReelShareResponse {
  shareId: string;
  deepLinks: {
    ios: string;
    android: string;
    web: string;
  };
  memberStates: Array<{ memberId: string }>;
  fomoPayload: FomoPayload;
}

interface AvatarDashboardState {
  memberId: string;
  avatarState: "active" | "pending" | "gray";
}

interface SpectrumBarConfig {
  base: number;
  peak: number;
  duration: number;
}

interface NarrativeSegmentResponse {
  continuityToken: string;
  choices: Array<{
    id: string;
    label: string;
    emotionalTone: "tense" | "hopeful" | "curious";
  }>;
}
