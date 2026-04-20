"use client";

import type { QuantumInterpolationProfile } from "./FrameGenerator";

export interface RecoveryTelemetryInput {
  bufferedAheadSeconds: number;
  buffering: boolean;
  currentBitrateKbps: number;
  playbackRate: number;
  throughputKbps?: number;
}

export interface RecoveryPlan {
  state: "stable" | "protecting" | "recovering";
  targetBitrateKbps: number;
  syntheticCoverageSeconds: number;
  preserveAudio: boolean;
  reason: string;
}

export interface RecoveryTelemetry {
  status: RecoveryPlan["state"];
  plan: RecoveryPlan;
  recentStallCount: number;
}

interface RecoverySample {
  atMs: number;
  bufferedAheadSeconds: number;
  buffering: boolean;
}

type RecoveryListener = (telemetry: RecoveryTelemetry) => void;

const MIN_BITRATE_KBPS = 96;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class QuantumBitrateRecovery {
  private readonly profile: QuantumInterpolationProfile;
  private readonly listeners = new Set<RecoveryListener>();
  private readonly samples: RecoverySample[] = [];
  private lastTelemetry: RecoveryTelemetry;

  constructor(profile: QuantumInterpolationProfile) {
    this.profile = profile;
    this.lastTelemetry = {
      status: "stable",
      plan: {
        state: "stable",
        targetBitrateKbps: 0,
        syntheticCoverageSeconds: 0,
        preserveAudio: true,
        reason: "Quantum recovery idle",
      },
      recentStallCount: 0,
    };
  }

  subscribe(listener: RecoveryListener): () => void {
    this.listeners.add(listener);
    listener(this.lastTelemetry);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(input: RecoveryTelemetryInput): RecoveryTelemetry {
    const now = Date.now();
    this.samples.push({
      atMs: now,
      bufferedAheadSeconds: input.bufferedAheadSeconds,
      buffering: input.buffering,
    });
    this.pruneSamples(now);

    const recentStallCount = this.samples.filter((sample) => sample.buffering).length;
    const currentBitrateKbps = Math.max(MIN_BITRATE_KBPS, input.currentBitrateKbps || MIN_BITRATE_KBPS);
    const bufferFloor = this.profile.recovery.minBufferedSeconds;
    const hasHardDrop =
      input.buffering && input.bufferedAheadSeconds <= bufferFloor * 0.35;
    const atRisk =
      input.bufferedAheadSeconds < bufferFloor ||
      (input.throughputKbps !== undefined && input.throughputKbps < currentBitrateKbps * 0.75);

    let plan: RecoveryPlan;
    if (hasHardDrop) {
      const syntheticCoverageSeconds = clamp(
        this.profile.recovery.maxSyntheticSeconds - recentStallCount * 0.4,
        1,
        this.profile.recovery.maxSyntheticSeconds
      );
      plan = {
        state: "recovering",
        targetBitrateKbps: Math.max(MIN_BITRATE_KBPS, Math.round(currentBitrateKbps * 0.45)),
        syntheticCoverageSeconds: Math.round(syntheticCoverageSeconds * 10) / 10,
        preserveAudio: true,
        reason:
          this.profile.preferredRenderer === "audio-only"
            ? "Audio continuity bridge engaged"
            : "Optical-flow recovery bridge engaged",
      };
    } else if (atRisk) {
      plan = {
        state: "protecting",
        targetBitrateKbps: Math.max(128, Math.round(currentBitrateKbps * 0.7)),
        syntheticCoverageSeconds:
          Math.round(
            clamp(bufferFloor - input.bufferedAheadSeconds, 0, this.profile.recovery.maxSyntheticSeconds) * 10
          ) / 10,
        preserveAudio: true,
        reason: "Pre-emptively lowering bitrate to protect playback continuity",
      };
    } else {
      plan = {
        state: "stable",
        targetBitrateKbps: currentBitrateKbps,
        syntheticCoverageSeconds: 0,
        preserveAudio: true,
        reason: input.playbackRate > 1 ? "Playback stable under accelerated decode" : "Playback stable",
      };
    }

    this.lastTelemetry = {
      status: plan.state,
      plan,
      recentStallCount,
    };
    this.emit();
    return this.lastTelemetry;
  }

  dispose(): void {
    this.samples.length = 0;
    this.listeners.clear();
  }

  private pruneSamples(now: number): void {
    const cutoff = now - 15_000;
    let cutoffIndex = 0;
    while (cutoffIndex < this.samples.length && this.samples[cutoffIndex]!.atMs < cutoff) {
      cutoffIndex += 1;
    }
    if (cutoffIndex > 0) this.samples.splice(0, cutoffIndex);
    if (this.samples.length > 30) {
      this.samples.splice(0, this.samples.length - 30);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.lastTelemetry);
    }
  }
}
