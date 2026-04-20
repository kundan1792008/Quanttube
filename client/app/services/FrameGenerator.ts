"use client";

export interface QuantumRecoveryProfile {
  strategy: "optical-flow-bridge" | "audio-priority-continuity";
  maxSyntheticSeconds: number;
  rejoinGraceMs: number;
  minBufferedSeconds: number;
}

export interface QuantumInterpolationProfile {
  enabled: boolean;
  sourceFrameRate: number;
  targetFrameRate: number;
  generatedFramesPerSecond: number;
  preferredRenderer: "webgpu-optical-flow" | "webgl-motion-fallback" | "audio-only";
  frameHistorySize: number;
  telemetryIntervalMs: number;
  memoryBudgetMb: number;
  recovery: QuantumRecoveryProfile;
}

export interface QuantumFrameTelemetry {
  active: boolean;
  renderer: QuantumInterpolationProfile["preferredRenderer"];
  webgpuSupported: boolean;
  measuredSourceFrameRate: number;
  targetFrameRate: number;
  syntheticFramesPerSecond: number;
  frameHistoryDepth: number;
  estimatedMemoryMb: number;
  bufferPressure: "nominal" | "elevated" | "critical";
}

interface VideoFrameCallbackMetadata {
  mediaTime: number;
  width: number;
  height: number;
  expectedDisplayTime?: number;
}

interface VideoFrameSample {
  mediaTime: number;
  wallClockMs: number;
  width: number;
  height: number;
}

type HTMLVideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void
  ) => number;
};

type QuantumTelemetryListener = (telemetry: QuantumFrameTelemetry) => void;

const MAX_MEMORY_PRESSURE_TRIM_RATIO = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasWebGpuSupport(): boolean {
  if (typeof navigator === "undefined") return false;
  return "gpu" in navigator;
}

function canCancelVideoFrameCallback(
  video: HTMLVideoElementWithFrameCallback
): video is HTMLVideoElementWithFrameCallback & {
  cancelVideoFrameCallback: (handle: number) => void;
} {
  return typeof video.cancelVideoFrameCallback === "function";
}

export class QuantumFrameGenerator {
  private video: HTMLVideoElementWithFrameCallback | null = null;
  private profile: QuantumInterpolationProfile;
  private listeners = new Set<QuantumTelemetryListener>();
  private frameHistory: VideoFrameSample[] = [];
  private animationFrameId: number | null = null;
  private videoFrameCallbackHandle: number | null = null;
  private buffering = false;
  private disposed = false;

  constructor(profile: QuantumInterpolationProfile) {
    this.profile = profile;
  }

  subscribe(listener: QuantumTelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.buildTelemetry());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video = video as HTMLVideoElementWithFrameCallback | null;
    this.frameHistory = [];
    this.restart();
  }

  setProfile(profile: QuantumInterpolationProfile): void {
    this.profile = profile;
    this.pruneFrameHistory();
    this.emit();
    this.restart();
  }

  setBuffering(buffering: boolean): void {
    this.buffering = buffering;
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.frameHistory = [];
    this.video = null;
  }

  private restart(): void {
    this.stop();
    if (this.disposed || !this.video || !this.profile.enabled) {
      this.emit();
      return;
    }
    this.scheduleNextSample();
  }

  private stop(): void {
    if (this.animationFrameId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (
      this.video &&
      this.videoFrameCallbackHandle !== null &&
      canCancelVideoFrameCallback(this.video)
    ) {
      this.video.cancelVideoFrameCallback(this.videoFrameCallbackHandle);
      this.videoFrameCallbackHandle = null;
    }
  }

  private scheduleNextSample(): void {
    if (!this.video || this.disposed) return;

    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.videoFrameCallbackHandle = this.video.requestVideoFrameCallback((now, metadata) => {
        this.recordFrame({
          mediaTime: metadata.mediaTime,
          width: metadata.width,
          height: metadata.height,
          wallClockMs: metadata.expectedDisplayTime ?? now,
        });
        this.scheduleNextSample();
      });
      return;
    }

    if (typeof window !== "undefined") {
      this.animationFrameId = window.requestAnimationFrame((now) => {
        this.recordFrame({
          mediaTime: this.video?.currentTime ?? 0,
          width: this.video?.videoWidth ?? 0,
          height: this.video?.videoHeight ?? 0,
          wallClockMs: now,
        });
        this.scheduleNextSample();
      });
    }
  }

  private recordFrame(sample: VideoFrameSample): void {
    if (this.disposed || !this.video) return;
    if (sample.width <= 0 || sample.height <= 0) {
      this.emit();
      return;
    }

    this.frameHistory.push(sample);
    this.pruneFrameHistory();
    this.emit();
  }

  private pruneFrameHistory(): void {
    const maxFrames = Math.max(2, this.profile.frameHistorySize);
    if (this.frameHistory.length > maxFrames) {
      this.frameHistory.splice(0, this.frameHistory.length - maxFrames);
    }

    const estimatedMemoryMb = this.estimateMemoryMb();
    if (estimatedMemoryMb <= this.profile.memoryBudgetMb || this.frameHistory.length <= 2) {
      return;
    }

    const memoryPressureRatio = estimatedMemoryMb / this.profile.memoryBudgetMb;
    const framesToTrim = Math.ceil(
      Math.min(
        this.frameHistory.length - 2,
        Math.max(1, this.frameHistory.length * Math.min(MAX_MEMORY_PRESSURE_TRIM_RATIO, memoryPressureRatio - 1))
      )
    );
    this.frameHistory.splice(0, framesToTrim);
  }

  private buildTelemetry(): QuantumFrameTelemetry {
    const measuredSourceFrameRate = this.measureSourceFrameRate();
    const estimatedMemoryMb = this.estimateMemoryMb();
    const pressureRatio =
      this.profile.memoryBudgetMb > 0 ? estimatedMemoryMb / this.profile.memoryBudgetMb : 0;

    let bufferPressure: QuantumFrameTelemetry["bufferPressure"] = "nominal";
    if (this.buffering || pressureRatio >= 0.85) bufferPressure = "critical";
    else if (pressureRatio >= 0.65) bufferPressure = "elevated";

    return {
      active: this.profile.enabled,
      renderer: this.profile.preferredRenderer,
      webgpuSupported: hasWebGpuSupport(),
      measuredSourceFrameRate,
      targetFrameRate: this.profile.targetFrameRate,
      syntheticFramesPerSecond: clamp(
        this.profile.targetFrameRate - measuredSourceFrameRate,
        0,
        this.profile.generatedFramesPerSecond || this.profile.targetFrameRate
      ),
      frameHistoryDepth: this.frameHistory.length,
      estimatedMemoryMb,
      bufferPressure,
    };
  }

  private emit(): void {
    const telemetry = this.buildTelemetry();
    for (const listener of this.listeners) {
      listener(telemetry);
    }
  }

  private measureSourceFrameRate(): number {
    if (this.frameHistory.length < 2) {
      return this.profile.sourceFrameRate;
    }

    const intervals: number[] = [];
    for (let i = 1; i < this.frameHistory.length; i += 1) {
      const currentSample = this.frameHistory.at(i);
      const previousSample = this.frameHistory.at(i - 1);
      if (!currentSample || !previousSample) continue;
      const delta = currentSample.wallClockMs - previousSample.wallClockMs;
      if (delta > 0) intervals.push(1000 / delta);
    }

    if (intervals.length === 0) return this.profile.sourceFrameRate;
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    return Number(clamp(average, 1, this.profile.targetFrameRate).toFixed(1));
  }

  private estimateMemoryMb(): number {
    if (this.frameHistory.length === 0) return 0;
    const latest = this.frameHistory[this.frameHistory.length - 1];
    if (!latest) return 0;
    const bytesPerFrame = latest.width * latest.height * 4;
    const totalBytes = bytesPerFrame * this.frameHistory.length;
    return Number((totalBytes / (1024 * 1024)).toFixed(1));
  }
}
