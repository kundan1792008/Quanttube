import { randomUUID } from "crypto";

export const LIGHTING_PRESETS = [
  "neutral",
  "daylight",
  "golden-hour",
  "neon-night",
  "studio-soft",
] as const;

export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

export interface AvatarFrameSynthesis {
  frameId: string;
  blendStrength: number;
  lightingMatch: number;
}

export interface EnqueueAvatarSynthInput {
  avatarId: string;
  sceneId: string;
  frameIds: string[];
  lightingPreset: LightingPreset;
}

export interface AvatarSynthJob {
  jobId: string;
  avatarId: string;
  sceneId: string;
  lightingPreset: LightingPreset;
  status: "completed";
  synthesizedFrames: AvatarFrameSynthesis[];
  model: "stable-diffusion-sim-v1";
  createdAt: string;
}

const avatarSynthJobs = new Map<string, AvatarSynthJob>();

function scoreFromToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffffffff;
}

export function enqueueAvatarSynthJob(input: EnqueueAvatarSynthInput): AvatarSynthJob {
  const jobId = `avsynth-${randomUUID()}`;
  const synthesizedFrames = input.frameIds.map((frameId) => {
    const blendSeed = scoreFromToken(`${input.avatarId}:${frameId}:blend`);
    const lightingSeed = scoreFromToken(`${input.sceneId}:${frameId}:${input.lightingPreset}:light`);
    return {
      frameId,
      blendStrength: Number((0.72 + blendSeed * 0.24).toFixed(3)),
      lightingMatch: Number((0.7 + lightingSeed * 0.3).toFixed(3)),
    };
  });

  const job: AvatarSynthJob = {
    jobId,
    avatarId: input.avatarId,
    sceneId: input.sceneId,
    lightingPreset: input.lightingPreset,
    status: "completed",
    synthesizedFrames,
    model: "stable-diffusion-sim-v1",
    createdAt: new Date().toISOString(),
  };
  avatarSynthJobs.set(jobId, job);
  return job;
}

export function getAvatarSynthJob(jobId: string): AvatarSynthJob | null {
  return avatarSynthJobs.get(jobId) ?? null;
}

export function _resetAvatarSynthJobs(): void {
  avatarSynthJobs.clear();
}
