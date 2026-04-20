import { randomUUID } from "crypto";

export const NARRATIVE_PREFERENCES = [
  "action",
  "romance",
  "mystery",
  "adventure",
  "sci-fi",
  "drama",
] as const;

export type NarrativePreference = (typeof NARRATIVE_PREFERENCES)[number];

export interface GenerateNarrativeInput {
  userId: string;
  preferences: NarrativePreference[];
  continuityToken?: string;
  selectedChoiceId?: string;
}

export interface NarrativeChoice {
  id: string;
  label: string;
  emotionalTone: "tense" | "hopeful" | "curious";
}

export interface NarrativeSegment {
  narrativeId: string;
  segmentNumber: number;
  pacing: "build" | "escalate" | "climax" | "resolve";
  stakeLevel: number;
  preferenceFocus: NarrativePreference;
  prompt: string;
  choices: NarrativeChoice[];
  continuityToken: string;
  generatedAt: string;
}

export interface DeepDubbingSimulationInput {
  audioBlockBase64: string;
  targetLanguage: string;
  sceneId?: string;
}

export interface DeepDubbingSimulationJob {
  jobId: string;
  status: "queued";
  targetLanguage: string;
  sceneId: string | null;
  bytesQueued: number;
  estimatedWaitMs: number;
  createdAt: string;
}

const narrativeStateStore = new Map<string, { narrativeId: string; segmentNumber: number }>();
const deepDubbingJobs = new Map<string, DeepDubbingSimulationJob>();

const PACING_SEQUENCE: NarrativeSegment["pacing"][] = ["build", "escalate", "climax", "resolve"];

function fnv1aHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function buildNarrativeKey(userId: string, preferences: NarrativePreference[]): string {
  return `${userId}:${preferences.join("|")}`;
}

function preferenceAt(segmentNumber: number, preferences: NarrativePreference[]): NarrativePreference {
  return preferences[(segmentNumber - 1) % preferences.length];
}

function pacingAt(segmentNumber: number): NarrativeSegment["pacing"] {
  return PACING_SEQUENCE[(segmentNumber - 1) % PACING_SEQUENCE.length];
}

function buildChoices(
  userId: string,
  segmentNumber: number,
  preference: NarrativePreference
): NarrativeChoice[] {
  const seed = fnv1aHash(`${userId}:${segmentNumber}:${preference}`);
  const variantsByPreference: Record<NarrativePreference, string[]> = {
    action: [
      "Dash across the collapsing bridge before the blast wave lands",
      "Disarm the drone swarm while your team evacuates the core chamber",
      "Intercept the armored convoy before it reaches the capital gate",
    ],
    romance: [
      "Reveal your hidden message before the midnight train departs",
      "Accept the dance invitation that could rewrite your alliance",
      "Protect your partner's secret even if it costs your command",
    ],
    mystery: [
      "Trace the cipher hidden in the archive's missing page",
      "Question the witness whose timeline no longer adds up",
      "Follow the impossible footprint into the sealed observatory",
    ],
    adventure: [
      "Navigate the storm canyon using only the ancient star map",
      "Trade supplies with the outpost leader for a mountain shortcut",
      "Cross the ice ridge before the expedition window closes",
    ],
    "sci-fi": [
      "Link your neural key to the dormant orbital lattice",
      "Test the prototype jump drive despite unstable coordinates",
      "Enter the simulation shard to recover a lost consciousness",
    ],
    drama: [
      "Publicly defend your rival to prevent a political collapse",
      "Tell your family the truth before the tribunal hearing begins",
      "Break the silence and expose the deal that saved the company",
    ],
  };
  const variants = variantsByPreference[preference];
  return Array.from({ length: 3 }, (_, i) => {
    const label = variants[(seed + i) % variants.length];
    const emotionalTone: NarrativeChoice["emotionalTone"] =
      i === 0 ? "tense" : i === 1 ? "curious" : "hopeful";
    return {
      id: `choice-${segmentNumber}-${i + 1}`,
      label: `${label} (${preference})`,
      emotionalTone,
    };
  });
}

export function generateNarrativeSegment(input: GenerateNarrativeInput): NarrativeSegment {
  const key = buildNarrativeKey(input.userId, input.preferences);
  const existing = narrativeStateStore.get(key);
  const nextSegmentNumber = (existing?.segmentNumber ?? 0) + 1;
  const narrativeId = existing?.narrativeId ?? `narr-${randomUUID()}`;
  const preferenceFocus = preferenceAt(nextSegmentNumber, input.preferences);
  const pacing = pacingAt(nextSegmentNumber);
  const stakeLevel = Math.min(10, 2 + nextSegmentNumber);
  const selectedChoiceNote = input.selectedChoiceId
    ? `Previous branch selected: ${input.selectedChoiceId}.`
    : "No branch selected yet; start with a high-agency decision.";
  const prompt = [
    `Generate segment ${nextSegmentNumber} for narrative ${narrativeId}.`,
    `Primary tone: ${preferenceFocus}. Pacing mode: ${pacing}.`,
    `Stake level: ${stakeLevel}/10.`,
    selectedChoiceNote,
    "Maintain continuity with prior events and end on a meaningful choice point.",
  ].join(" ");
  const continuityHashSeed = `${input.userId}:${input.continuityToken ?? "new"}:${input.selectedChoiceId ?? "none"}`;
  const continuityToken = `${narrativeId}:${nextSegmentNumber}:${fnv1aHash(
    continuityHashSeed
  ).toString(16)}`;

  narrativeStateStore.set(key, { narrativeId, segmentNumber: nextSegmentNumber });

  return {
    narrativeId,
    segmentNumber: nextSegmentNumber,
    pacing,
    stakeLevel,
    preferenceFocus,
    prompt,
    choices: buildChoices(input.userId, nextSegmentNumber, preferenceFocus),
    continuityToken,
    generatedAt: new Date().toISOString(),
  };
}

export function enqueueDeepDubbingSimulation(
  input: DeepDubbingSimulationInput
): DeepDubbingSimulationJob {
  const normalizedBase64 = input.audioBlockBase64.replace(/\s+/g, "");
  const bytesQueued = Math.floor((normalizedBase64.length * 3) / 4);
  const job: DeepDubbingSimulationJob = {
    jobId: `dubsim-${randomUUID()}`,
    status: "queued",
    targetLanguage: input.targetLanguage.toLowerCase(),
    sceneId: input.sceneId ?? null,
    bytesQueued,
    estimatedWaitMs: Math.max(200, Math.min(5000, Math.round(bytesQueued * 1.2))),
    createdAt: new Date().toISOString(),
  };
  deepDubbingJobs.set(job.jobId, job);
  return job;
}

export function getDeepDubbingSimulationJob(jobId: string): DeepDubbingSimulationJob | null {
  return deepDubbingJobs.get(jobId) ?? null;
}

export function _resetNarrativeGenerator(): void {
  narrativeStateStore.clear();
  deepDubbingJobs.clear();
}
