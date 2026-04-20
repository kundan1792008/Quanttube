export type EmotionalAxis = "high-energy" | "educational" | "relaxing";

export interface SequencerContentInput {
  videoId: string;
  title: string;
  tags?: string[];
  category?: string;
  durationSecs: number;
}

export interface EmotionalVector {
  axis: EmotionalAxis;
  energy: number;
  focus: number;
  calm: number;
}

export interface SequencedContent extends SequencerContentInput {
  vector: EmotionalVector;
  arcPosition: number;
  bridgeLabel: string;
  score: number;
}

export interface SequenceOptions {
  arcLength?: number;
  preferredAxes?: EmotionalAxis[];
}

const AXIS_KEYWORDS: Record<EmotionalAxis, readonly string[]> = {
  "high-energy": ["action", "hype", "fast", "intense", "sports", "dance", "trailer"],
  educational: ["learn", "guide", "tutorial", "explainer", "lecture", "science", "history"],
  relaxing: ["calm", "sleep", "ambient", "lofi", "meditation", "nature", "slow"],
};

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function inferAxis(input: SequencerContentInput): EmotionalAxis {
  const haystack = [input.title, input.category ?? "", ...(input.tags ?? [])]
    .join(" ")
    .toLowerCase();

  let bestAxis: EmotionalAxis = "educational";
  let bestScore = -1;

  for (const [axis, keywords] of Object.entries(AXIS_KEYWORDS) as [EmotionalAxis, readonly string[]][]) {
    const score = keywords.reduce((acc, keyword) => (haystack.includes(keyword) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestAxis = axis;
    }
  }

  return bestAxis;
}

function durationEnergy(durationSecs: number): number {
  if (durationSecs <= 90) return 0.92;
  if (durationSecs <= 300) return 0.75;
  if (durationSecs <= 900) return 0.58;
  return 0.42;
}

export function mapContentToEmotionalVector(input: SequencerContentInput): EmotionalVector {
  const axis = inferAxis(input);
  const baseEnergy = durationEnergy(input.durationSecs);

  switch (axis) {
    case "high-energy":
      return {
        axis,
        energy: clamp01(baseEnergy + 0.12),
        focus: clamp01(0.52 + (input.durationSecs > 600 ? 0.12 : 0)),
        calm: 0.14,
      };
    case "educational":
      return {
        axis,
        energy: clamp01(baseEnergy - 0.08),
        focus: clamp01(0.78 + (input.durationSecs > 1200 ? 0.06 : 0)),
        calm: 0.44,
      };
    case "relaxing":
      return {
        axis,
        energy: clamp01(baseEnergy - 0.28),
        focus: 0.42,
        calm: clamp01(0.72 + (input.durationSecs > 1200 ? 0.1 : 0)),
      };
  }
}

function buildArcTargets(length: number): EmotionalVector[] {
  const safeLength = Math.max(1, length);
  const targets: EmotionalVector[] = [];

  for (let i = 0; i < safeLength; i += 1) {
    // Guard single-item sequences so we never divide by zero in arc progress.
    const progress = safeLength === 1 ? 1 : i / (safeLength - 1);
    const intensityCurve = progress <= 0.6 ? progress / 0.6 : (1 - progress) / 0.4;
    const energy = clamp01(0.35 + intensityCurve * 0.5);
    const calm = clamp01(0.72 - intensityCurve * 0.42);
    const focus = clamp01(0.55 + (progress > 0.35 && progress < 0.85 ? 0.22 : 0));

    targets.push({
      axis: progress < 0.33 ? "educational" : progress < 0.66 ? "high-energy" : "relaxing",
      energy,
      calm,
      focus,
    });
  }

  return targets;
}

function vectorDistance(a: EmotionalVector, b: EmotionalVector): number {
  const e = Math.abs(a.energy - b.energy);
  const f = Math.abs(a.focus - b.focus);
  const c = Math.abs(a.calm - b.calm);
  const axisPenalty = a.axis === b.axis ? 0 : 0.08;
  return e * 0.46 + f * 0.34 + c * 0.2 + axisPenalty;
}

function bridgeLabel(current: EmotionalVector, next: EmotionalVector): string {
  if (current.axis === next.axis) return `Maintain ${next.axis} momentum`;
  if (next.axis === "relaxing") return "Ease into a calmer segment";
  if (next.axis === "high-energy") return "Lift pace with a high-energy transition";
  return "Shift toward focused exploration";
}

/**
 * Build a deterministic, emotionally-smoothed sequence that can be preloaded
 * as a continuous playback queue.
 */
export function buildPredictiveSequence(
  content: SequencerContentInput[],
  options: SequenceOptions = {}
): SequencedContent[] {
  if (content.length === 0) return [];

  const arcLength = options.arcLength ?? content.length;
  const targets = buildArcTargets(arcLength);
  const preferredAxes = new Set(options.preferredAxes ?? []);

  const available = content.map((item) => ({ item, vector: mapContentToEmotionalVector(item) }));
  const selected: SequencedContent[] = [];

  for (let position = 0; position < targets.length && available.length > 0; position += 1) {
    const target = targets[position];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[i];
      const axisBoost = preferredAxes.has(candidate.vector.axis) ? -0.06 : 0;
      const continuityPenalty =
        selected.length > 0
          ? vectorDistance(selected[selected.length - 1].vector, candidate.vector) * 0.2
          : 0;
      const score = vectorDistance(candidate.vector, target) + axisBoost + continuityPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const picked = available.splice(bestIndex, 1)[0];
    selected.push({
      ...picked.item,
      vector: picked.vector,
      arcPosition: position,
      bridgeLabel: selected.length === 0 ? "Session opener" : bridgeLabel(selected[selected.length - 1].vector, picked.vector),
      score: Number(bestScore.toFixed(4)),
    });
  }

  return selected;
}
