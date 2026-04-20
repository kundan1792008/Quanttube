export interface QuantumRecoveryPolicy {
  strategy: "optical-flow-bridge" | "audio-priority-continuity";
  maxSyntheticSeconds: number;
  rejoinGraceMs: number;
  minBufferedSeconds: number;
}

export interface QuantumInterpolationPlan {
  enabled: boolean;
  sourceFrameRate: number;
  targetFrameRate: number;
  generatedFramesPerSecond: number;
  preferredRenderer: "webgpu-optical-flow" | "webgl-motion-fallback" | "audio-only";
  frameHistorySize: number;
  telemetryIntervalMs: number;
  memoryBudgetMb: number;
  recovery: QuantumRecoveryPolicy;
}

interface BuildQuantumInterpolationPlanInput {
  mode: "cinema" | "short-reel" | "audio-only";
  engagementScore: number;
  selectedResolution: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferSourceFrameRate(selectedResolution: string): number {
  if (selectedResolution === "2160p") return 30;
  if (selectedResolution === "1080p") return 30;
  if (selectedResolution === "720p") return 24;
  if (selectedResolution === "480p") return 24;
  return 24;
}

export function buildQuantumInterpolationPlan(
  input: BuildQuantumInterpolationPlanInput
): QuantumInterpolationPlan {
  if (input.mode === "audio-only") {
    return {
      enabled: false,
      sourceFrameRate: 0,
      targetFrameRate: 0,
      generatedFramesPerSecond: 0,
      preferredRenderer: "audio-only",
      frameHistorySize: 0,
      telemetryIntervalMs: 1000,
      memoryBudgetMb: 0,
      recovery: {
        strategy: "audio-priority-continuity",
        maxSyntheticSeconds: 10,
        rejoinGraceMs: 1200,
        minBufferedSeconds: 1,
      },
    };
  }

  const sourceFrameRate = inferSourceFrameRate(input.selectedResolution);
  const targetFrameRate = input.mode === "short-reel" ? 90 : 120;
  const headroom = clamp(input.engagementScore, 0, 1);
  const frameHistorySize = input.mode === "short-reel" ? 8 : 12;
  const memoryBudgetMb =
    input.selectedResolution === "2160p"
      ? 192
      : input.selectedResolution === "1080p"
        ? 128
        : 96;
  const recoveryWindow = Number((5 + headroom * 5).toFixed(1));

  return {
    enabled: true,
    sourceFrameRate,
    targetFrameRate,
    generatedFramesPerSecond: Math.max(0, targetFrameRate - sourceFrameRate),
    preferredRenderer:
      input.selectedResolution === "2160p" || input.selectedResolution === "1080p"
        ? "webgpu-optical-flow"
        : "webgl-motion-fallback",
    frameHistorySize,
    telemetryIntervalMs: 500,
    memoryBudgetMb,
    recovery: {
      strategy: "optical-flow-bridge",
      maxSyntheticSeconds: recoveryWindow,
      rejoinGraceMs: 800,
      minBufferedSeconds: input.mode === "short-reel" ? 0.75 : 1.5,
    },
  };
}
