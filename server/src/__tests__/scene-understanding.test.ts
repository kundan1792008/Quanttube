import request from "supertest";
import app from "../app";
import {
  buildSceneUnderstandingReport,
  detectSceneBoundaries,
  detectHighlightMoments,
  generateChapters,
  rankThumbnailCandidates,
  buildSceneSegments,
  DEFAULT_SCENE_UNDERSTANDING_CONFIG,
  type FrameSignalInput,
} from "../services/SceneUnderstandingService";
import { _resetVideoStores } from "../routes/videos";

function makeHistogram(seed: number, bins = 8): { red: number[]; green: number[]; blue: number[] } {
  const pivot = Math.abs(seed) % bins;
  const altPivot = (pivot + 2) % bins;
  const coldPivot = (pivot + 4) % bins;
  const red = Array.from({ length: bins }, (_, i) => (i === pivot ? 120 : i === altPivot ? 48 : 6));
  const green = Array.from({ length: bins }, (_, i) => (i === altPivot ? 110 : i === pivot ? 36 : 5));
  const blue = Array.from({ length: bins }, (_, i) => (i === coldPivot ? 132 : i === altPivot ? 24 : 4));
  return { red, green, blue };
}

function generateSignals(durationMs: number, frameIntervalMs: number): FrameSignalInput[] {
  const frames: FrameSignalInput[] = [];
  let timestampMs = 0;
  let idx = 0;

  while (timestampMs <= durationMs) {
    const sceneBand = timestampMs < durationMs * 0.33 ? 2 : timestampMs < durationMs * 0.66 ? 18 : 41;
    const burst = idx % 18 === 0 ? 0.9 : idx % 11 === 0 ? 0.76 : 0.42;
    const speech = idx % 15 < 7 ? 0.68 : 0.26;
    const sentiment = idx % 20 === 0 ? 0.88 : idx % 9 === 0 ? -0.61 : 0.2;
    const textDensity = idx % 14 === 0 ? 0.58 : 0.19;
    const histogramSeed = sceneBand + Math.floor((idx % 7) * 0.7);

    frames.push({
      timestampMs,
      histogram: makeHistogram(histogramSeed, 8),
      motionEnergy: burst,
      audioRms: idx % 12 === 0 ? 0.87 : 0.45,
      speechConfidence: speech,
      sentimentShift: sentiment,
      faceSaliency: idx % 10 < 4 ? 0.73 : 0.29,
      textDensity,
      edgeDensity: idx % 5 === 0 ? 0.74 : 0.49,
      sharpness: idx % 8 === 0 ? 0.91 : 0.62,
      brightness: idx % 6 === 0 ? 0.63 : 0.47,
      contrast: idx % 9 === 0 ? 0.81 : 0.59,
      ruleOfThirdsAlignment: idx % 13 < 6 ? 0.78 : 0.39,
      objectCount: idx % 9 === 0 ? 7 : 4,
    });

    idx += 1;
    timestampMs += frameIntervalMs;
  }

  return frames;
}

beforeEach(() => {
  _resetVideoStores();
});

describe("SceneUnderstandingService - histogram scene detection", () => {
  it("returns boundaries ordered by timestamp with valid confidence values", () => {
    const signals = generateSignals(90_000, 500);
    const boundaries = detectSceneBoundaries(signals, {
      ...DEFAULT_SCENE_UNDERSTANDING_CONFIG,
      histogramCutSensitivity: 0.6,
      minSceneDurationMs: 800,
    });
    expect(Array.isArray(boundaries)).toBe(true);
    expect(
      boundaries.every((boundary, index, arr) =>
        index === 0 ? boundary.timestampMs >= 0 : boundary.timestampMs >= arr[index - 1].timestampMs
      )
    ).toBe(true);
    expect(boundaries.every((boundary) => boundary.confidence >= 0 && boundary.confidence <= 1)).toBe(true);
  });

  it("builds contiguous scene segments spanning the full duration", () => {
    const durationMs = 90_000;
    const signals = generateSignals(durationMs, 500);
    const boundaries = detectSceneBoundaries(signals, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const scenes = buildSceneSegments(signals, boundaries, durationMs, DEFAULT_SCENE_UNDERSTANDING_CONFIG);

    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes[0].startMs).toBe(0);
    expect(scenes[scenes.length - 1].endMs).toBe(durationMs);
    expect(scenes.every((scene) => scene.durationMs > 0)).toBe(true);
  });

  it("computes highlights from multi-signal peaks", () => {
    const durationMs = 100_000;
    const signals = generateSignals(durationMs, 400);
    const boundaries = detectSceneBoundaries(signals, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const scenes = buildSceneSegments(signals, boundaries, durationMs, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const highlights = detectHighlightMoments(
      signals,
      boundaries,
      scenes,
      { ...DEFAULT_SCENE_UNDERSTANDING_CONFIG, maxHighlights: 32 }
    );

    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.some((highlight) => highlight.reasons.includes("motion-spike"))).toBe(true);
    expect(highlights.some((highlight) => highlight.reasons.includes("audio-spike"))).toBe(true);
  });

  it("ranks thumbnails with composition and quality scores", () => {
    const durationMs = 120_000;
    const signals = generateSignals(durationMs, 500);
    const boundaries = detectSceneBoundaries(signals, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const scenes = buildSceneSegments(signals, boundaries, durationMs, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const highlights = detectHighlightMoments(signals, boundaries, scenes, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const thumbnails = rankThumbnailCandidates(
      signals,
      scenes,
      highlights,
      { ...DEFAULT_SCENE_UNDERSTANDING_CONFIG, maxThumbnails: 24 }
    );

    expect(thumbnails.length).toBeGreaterThan(0);
    expect(thumbnails.some((thumb) => thumb.source === "highlight")).toBe(true);
    expect(thumbnails.every((thumb) => thumb.finalScore >= 0 && thumb.finalScore <= 1)).toBe(true);
    expect(thumbnails.every((thumb) => thumb.crop.width > 0 && thumb.crop.height > 0)).toBe(true);
  });

  it("generates timeline chapters from scenes and highlights", () => {
    const durationMs = 150_000;
    const signals = generateSignals(durationMs, 500);
    const boundaries = detectSceneBoundaries(signals, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const scenes = buildSceneSegments(signals, boundaries, durationMs, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const highlights = detectHighlightMoments(signals, boundaries, scenes, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const thumbnails = rankThumbnailCandidates(signals, scenes, highlights, DEFAULT_SCENE_UNDERSTANDING_CONFIG);
    const chapters = generateChapters(
      scenes,
      highlights,
      thumbnails,
      durationMs,
      { ...DEFAULT_SCENE_UNDERSTANDING_CONFIG, targetChapterDurationMs: 45_000 }
    );

    expect(chapters.length).toBeGreaterThanOrEqual(1);
    expect(chapters[0].startMs).toBe(0);
    expect(chapters[chapters.length - 1].endMs).toBe(durationMs);
    expect(chapters.every((chapter) => chapter.durationMs > 0)).toBe(true);
  });

  it("builds a full report with coverage metrics", () => {
    const durationMs = 95_000;
    const signals = generateSignals(durationMs, 500);
    const report = buildSceneUnderstandingReport({
      videoId: "video-report-001",
      durationMs,
      frameSignals: signals,
      config: {
        maxHighlights: 20,
        maxThumbnails: 14,
        targetChapterDurationMs: 35_000,
      },
    });

    expect(report.videoId).toBe("video-report-001");
    expect(report.scenes.length).toBeGreaterThan(0);
    expect(report.highlights.length).toBeGreaterThan(0);
    expect(report.thumbnails.length).toBeGreaterThan(0);
    expect(report.chapters.length).toBeGreaterThan(0);
    expect(report.metrics.frameCount).toBe(signals.length);
    expect(report.metrics.chapterCoverage).toBeGreaterThan(0.95);
  });
});

describe("Scene understanding API endpoints", () => {
  async function createVideo(): Promise<string> {
    const create = await request(app)
      .post("/api/v1/videos")
      .send({
        title: "Scene Understanding Demo",
        description: "Long-form media for timeline analysis",
        category: "education",
        tags: ["ai", "scene", "timeline"],
        isPublished: true,
      });

    expect(create.status).toBe(201);
    return create.body.id;
  }

  it("rejects analyze requests for unknown videos", async () => {
    const payload = {
      durationMs: 50_000,
      frameSignals: generateSignals(50_000, 1_000),
    };

    const res = await request(app).post("/api/v1/videos/missing-id/scene-understanding/analyze").send(payload);
    expect(res.status).toBe(404);
  });

  it("rejects malformed frame signal payloads", async () => {
    const videoId = await createVideo();
    const res = await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({
        durationMs: 90_000,
        frameSignals: [
          {
            timestampMs: 0,
            histogram: { red: [1], green: [1], blue: [1] },
          },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("creates and stores a scene understanding report", async () => {
    const videoId = await createVideo();
    const durationMs = 90_000;
    const frameSignals = generateSignals(durationMs, 1_000);

    const analyze = await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({
        durationMs,
        frameSignals,
        config: {
          histogramCutSensitivity: 1.7,
          maxHighlights: 24,
          maxThumbnails: 16,
          targetChapterDurationMs: 42_000,
        },
      });

    expect(analyze.status).toBe(201);
    expect(analyze.body.videoId).toBe(videoId);
    expect(analyze.body.metrics.frameCount).toBe(frameSignals.length);
    expect(analyze.body.scenes.length).toBeGreaterThan(0);
    expect(analyze.body.highlights.length).toBeGreaterThan(0);
    expect(analyze.body.thumbnails.length).toBeGreaterThan(0);
    expect(analyze.body.chapters.length).toBeGreaterThan(0);

    const report = await request(app).get(`/api/v1/videos/${videoId}/scene-understanding`);
    expect(report.status).toBe(200);
    expect(report.body.reportId).toBe(analyze.body.reportId);
  });

  it("returns chapter-only subset endpoint", async () => {
    const videoId = await createVideo();
    const durationMs = 90_000;

    await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({
        durationMs,
        frameSignals: generateSignals(durationMs, 1_000),
      });

    const chapterRes = await request(app).get(`/api/v1/videos/${videoId}/scene-understanding/chapters`);
    expect(chapterRes.status).toBe(200);
    expect(chapterRes.body.videoId).toBe(videoId);
    expect(Array.isArray(chapterRes.body.chapters)).toBe(true);
    expect(chapterRes.body.total).toBe(chapterRes.body.chapters.length);
    expect(chapterRes.body.chapters[0]).toHaveProperty("title");
    expect(chapterRes.body.chapters[0]).toHaveProperty("summary");
  });

  it("returns highlight-only subset endpoint", async () => {
    const videoId = await createVideo();
    const durationMs = 90_000;

    await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({
        durationMs,
        frameSignals: generateSignals(durationMs, 1_000),
      });

    const highlightRes = await request(app).get(`/api/v1/videos/${videoId}/scene-understanding/highlights`);
    expect(highlightRes.status).toBe(200);
    expect(highlightRes.body.videoId).toBe(videoId);
    expect(Array.isArray(highlightRes.body.highlights)).toBe(true);
    expect(highlightRes.body.total).toBe(highlightRes.body.highlights.length);
    expect(highlightRes.body.highlights[0]).toHaveProperty("reasons");
    expect(highlightRes.body.highlights[0]).toHaveProperty("localSignals");
  });

  it("returns thumbnail-only subset endpoint", async () => {
    const videoId = await createVideo();
    const durationMs = 90_000;

    await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({
        durationMs,
        frameSignals: generateSignals(durationMs, 1_000),
      });

    const thumbRes = await request(app).get(`/api/v1/videos/${videoId}/scene-understanding/thumbnails`);
    expect(thumbRes.status).toBe(200);
    expect(thumbRes.body.videoId).toBe(videoId);
    expect(Array.isArray(thumbRes.body.thumbnails)).toBe(true);
    expect(thumbRes.body.total).toBe(thumbRes.body.thumbnails.length);
    expect(thumbRes.body.thumbnails[0]).toHaveProperty("compositionScore");
    expect(thumbRes.body.thumbnails[0]).toHaveProperty("finalScore");
  });

  it("returns 404 for subset endpoints when no report exists", async () => {
    const videoId = await createVideo();

    const [chaptersRes, highlightsRes, thumbsRes, reportRes] = await Promise.all([
      request(app).get(`/api/v1/videos/${videoId}/scene-understanding/chapters`),
      request(app).get(`/api/v1/videos/${videoId}/scene-understanding/highlights`),
      request(app).get(`/api/v1/videos/${videoId}/scene-understanding/thumbnails`),
      request(app).get(`/api/v1/videos/${videoId}/scene-understanding`),
    ]);

    expect(chaptersRes.status).toBe(404);
    expect(highlightsRes.status).toBe(404);
    expect(thumbsRes.status).toBe(404);
    expect(reportRes.status).toBe(404);
  });

  it("overwrites prior report when analyze is re-run", async () => {
    const videoId = await createVideo();
    const durationMs = 80_000;
    const frameSignals = generateSignals(durationMs, 1_000);

    const first = await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({ durationMs, frameSignals, config: { maxHighlights: 10, maxThumbnails: 8 } });

    const second = await request(app)
      .post(`/api/v1/videos/${videoId}/scene-understanding/analyze`)
      .send({ durationMs, frameSignals, config: { maxHighlights: 18, maxThumbnails: 14 } });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.reportId).not.toBe(first.body.reportId);
    expect(second.body.highlights.length).toBeGreaterThanOrEqual(first.body.highlights.length);

    const fetched = await request(app).get(`/api/v1/videos/${videoId}/scene-understanding`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.reportId).toBe(second.body.reportId);
  });
});
