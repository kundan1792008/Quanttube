import {
  mapContentToEmotionalVector,
  buildPredictiveSequence,
  createSessionDepthState,
  applySessionDepthEvent,
  buildSessionDepthRecommendationSignal,
} from "../services";

describe("ContentSequencer", () => {
  it("maps content into deterministic emotional vectors", () => {
    const highEnergy = mapContentToEmotionalVector({
      videoId: "v1",
      title: "Action Sports Trailer",
      tags: ["hype"],
      durationSecs: 90,
    });

    const relaxing = mapContentToEmotionalVector({
      videoId: "v2",
      title: "Ambient Night Rain",
      tags: ["sleep", "calm"],
      durationSecs: 1800,
    });

    expect(highEnergy.axis).toBe("high-energy");
    expect(highEnergy.energy).toBeGreaterThan(relaxing.energy);
    expect(relaxing.calm).toBeGreaterThan(highEnergy.calm);
  });

  it("builds a smooth predictive sequence with bridge labels", () => {
    const sequence = buildPredictiveSequence([
      { videoId: "a", title: "Quick Math Explainer", tags: ["learn"], durationSecs: 240 },
      { videoId: "b", title: "Cyber Drift Trailer", tags: ["action"], durationSecs: 120 },
      { videoId: "c", title: "Sunset Meditation", tags: ["calm"], durationSecs: 900 },
    ]);

    expect(sequence).toHaveLength(3);
    expect(sequence[0].bridgeLabel).toBe("Session opener");
    expect(sequence[1].bridgeLabel.length).toBeGreaterThan(0);
    expect(sequence[2].arcPosition).toBe(2);
  });
});

describe("SessionDepth", () => {
  it("tracks depth and upgrades tiers with sustained watch behavior", () => {
    let state = createSessionDepthState("session-1", "2026-01-01T00:00:00.000Z");

    state = applySessionDepthEvent(state, { watchedSeconds: 900, completedItem: true }, "2026-01-01T00:15:00.000Z");
    state = applySessionDepthEvent(state, { watchedSeconds: 600, completedItem: true }, "2026-01-01T00:25:00.000Z");

    expect(state.watchSeconds).toBe(1500);
    expect(state.completedItems).toBe(2);
    expect(["engaged", "premium", "exclusive"]).toContain(state.tier);
  });

  it("reduces depth momentum on skips and exposes recommendation signal", () => {
    let state = createSessionDepthState("session-2", "2026-01-01T00:00:00.000Z");

    state = applySessionDepthEvent(state, { watchedSeconds: 1200, completedItem: true });
    const beforeSkip = state.depthPoints;
    state = applySessionDepthEvent(state, { watchedSeconds: 10, skippedItem: true });

    const signal = buildSessionDepthRecommendationSignal(state);

    expect(state.depthPoints).toBeLessThan(beforeSkip);
    expect(signal.continuityWeight).toBeGreaterThan(0.5);
    expect(signal.premiumWeight).toBeGreaterThan(0);
  });
});
