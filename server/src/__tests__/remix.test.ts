/**
 * Tests for the AI Video Remix Engine endpoints and services:
 *
 *  Video remix:
 *   POST /api/remixes/style-transfer
 *   POST /api/remixes/background-swap
 *   POST /api/remixes/alternate-ending
 *   POST /api/remixes/visual-effects
 *   GET  /api/remixes/jobs/:jobId
 *   GET  /api/remixes/videos/:videoId/jobs
 *
 *  Audio remix:
 *   POST /api/remixes/audio/music
 *   POST /api/remixes/audio/sfx
 *   POST /api/remixes/audio/speed
 *   POST /api/remixes/audio/voice-clone
 *   GET  /api/remixes/audio/jobs/:jobId
 *   GET  /api/remixes/audio/videos/:videoId/jobs
 *
 *  Feed / attribution:
 *   GET  /api/remixes/trending
 *   GET  /api/remixes/chains/:originalVideoId
 *   GET  /api/remixes/:remixId/attribution
 *   POST /api/remixes/:remixId/publish
 *
 *  Meta:
 *   GET  /api/remixes/meta/styles
 *   GET  /api/remixes/meta/effects
 *   GET  /api/remixes/meta/backgrounds
 *   GET  /api/remixes/meta/music-genres
 *   GET  /api/remixes/meta/sound-effects
 */

import request from "supertest";
import app from "../app";
import { _resetRemixEngine } from "../services/RemixEngine";
import { _resetAudioRemixService } from "../services/AudioRemixService";
import { _resetPublishedRemixes } from "../routes/remixes";

beforeEach(() => {
  _resetRemixEngine();
  _resetAudioRemixService();
  _resetPublishedRemixes();
});

// ---------------------------------------------------------------------------
// Style Transfer
// ---------------------------------------------------------------------------

describe("POST /api/remixes/style-transfer", () => {
  it("creates a style-transfer job and returns 202", async () => {
    const res = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "video-001", style: "anime" });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.type).toBe("style-transfer");
    expect(res.body.style).toBe("anime");
    expect(res.body.status).toBe("queued");
    expect(res.body.videoId).toBe("video-001");
    expect(res.body.outputUrl).toBeNull();
  });

  it("accepts all valid style presets", async () => {
    const styles = ["anime", "oil-painting", "cyberpunk", "noir", "retro-vhs"];
    for (const style of styles) {
      const res = await request(app)
        .post("/api/remixes/style-transfer")
        .send({ videoId: "video-001", style });
      expect(res.status).toBe(202);
      expect(res.body.style).toBe(style);
    }
  });

  it("rejects an unknown style", async () => {
    const res = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "video-001", style: "watercolor" });
    expect(res.status).toBe(400);
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ style: "anime" });
    expect(res.status).toBe(400);
  });

  it("rejects missing style", async () => {
    const res = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "video-001" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Background Swap
// ---------------------------------------------------------------------------

describe("POST /api/remixes/background-swap", () => {
  it("creates a background-swap job", async () => {
    const res = await request(app)
      .post("/api/remixes/background-swap")
      .send({ videoId: "video-002", newBackground: "space" });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("background-swap");
    expect(res.body.newBackground).toBe("space");
    expect(res.body.status).toBe("queued");
  });

  it("accepts a custom background string", async () => {
    const res = await request(app)
      .post("/api/remixes/background-swap")
      .send({ videoId: "video-002", newBackground: "https://example.com/bg.jpg" });
    expect(res.status).toBe(202);
    expect(res.body.newBackground).toBe("https://example.com/bg.jpg");
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/background-swap")
      .send({ newBackground: "beach" });
    expect(res.status).toBe(400);
  });

  it("rejects missing newBackground", async () => {
    const res = await request(app)
      .post("/api/remixes/background-swap")
      .send({ videoId: "video-002" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Alternate Ending
// ---------------------------------------------------------------------------

describe("POST /api/remixes/alternate-ending", () => {
  it("creates an alternate-ending job", async () => {
    const res = await request(app)
      .post("/api/remixes/alternate-ending")
      .send({ videoId: "video-003", prompt: "The hero escapes by building a rocket" });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("alternate-ending");
    expect(res.body.prompt).toBe("The hero escapes by building a rocket");
    expect(res.body.generatedScript).toBeNull();
    expect(res.body.status).toBe("queued");
  });

  it("rejects a prompt longer than 500 characters", async () => {
    const longPrompt = "a".repeat(501);
    const res = await request(app)
      .post("/api/remixes/alternate-ending")
      .send({ videoId: "video-003", prompt: longPrompt });
    expect(res.status).toBe(400);
  });

  it("accepts exactly 500 characters", async () => {
    const prompt = "a".repeat(500);
    const res = await request(app)
      .post("/api/remixes/alternate-ending")
      .send({ videoId: "video-003", prompt });
    expect(res.status).toBe(202);
  });

  it("rejects missing prompt", async () => {
    const res = await request(app)
      .post("/api/remixes/alternate-ending")
      .send({ videoId: "video-003" });
    expect(res.status).toBe(400);
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/alternate-ending")
      .send({ prompt: "some ending" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Visual Effects
// ---------------------------------------------------------------------------

describe("POST /api/remixes/visual-effects", () => {
  it("creates a visual-effects job with multiple effects", async () => {
    const res = await request(app)
      .post("/api/remixes/visual-effects")
      .send({ videoId: "video-004", effects: ["rain", "glitch"] });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("visual-effects");
    expect(res.body.effects).toEqual(expect.arrayContaining(["rain", "glitch"]));
    expect(res.body.status).toBe("queued");
  });

  it("accepts a single effect", async () => {
    const res = await request(app)
      .post("/api/remixes/visual-effects")
      .send({ videoId: "video-004", effects: ["snow"] });
    expect(res.status).toBe(202);
  });

  it("rejects an empty effects array", async () => {
    const res = await request(app)
      .post("/api/remixes/visual-effects")
      .send({ videoId: "video-004", effects: [] });
    expect(res.status).toBe(400);
  });

  it("rejects unknown effects", async () => {
    const res = await request(app)
      .post("/api/remixes/visual-effects")
      .send({ videoId: "video-004", effects: ["laser-beams"] });
    expect(res.status).toBe(400);
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/visual-effects")
      .send({ effects: ["fire"] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Get remix job
// ---------------------------------------------------------------------------

describe("GET /api/remixes/jobs/:jobId", () => {
  it("retrieves a created remix job", async () => {
    const create = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "video-001", style: "noir" });

    const res = await request(app).get(`/api/remixes/jobs/${create.body.jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(create.body.jobId);
    expect(res.body.style).toBe("noir");
  });

  it("returns 404 for unknown job", async () => {
    const res = await request(app).get("/api/remixes/jobs/nonexistent-job");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// List jobs for a video
// ---------------------------------------------------------------------------

describe("GET /api/remixes/videos/:videoId/jobs", () => {
  it("lists all remix jobs for a video", async () => {
    await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "video-multi", style: "anime" });
    await request(app)
      .post("/api/remixes/visual-effects")
      .send({ videoId: "video-multi", effects: ["fire"] });

    const res = await request(app).get("/api/remixes/videos/video-multi/jobs");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.jobs).toHaveLength(2);
  });

  it("returns an empty list for a video with no jobs", async () => {
    const res = await request(app).get("/api/remixes/videos/no-jobs-video/jobs");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.jobs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Music Change
// ---------------------------------------------------------------------------

describe("POST /api/remixes/audio/music", () => {
  it("creates a music-change job", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "video-005", genre: "synthwave" });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("music-change");
    expect(res.body.genre).toBe("synthwave");
    expect(res.body.speechPreserved).toBe(true);
    expect(res.body.status).toBe("queued");
  });

  it("rejects an invalid genre", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "video-005", genre: "death-metal" });
    expect(res.status).toBe(400);
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/music")
      .send({ genre: "jazz" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// SFX Injection
// ---------------------------------------------------------------------------

describe("POST /api/remixes/audio/sfx", () => {
  it("creates an sfx-injection job with timestamps", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "video-006",
        timestamps: [
          { timestampSeconds: 10.5, effectId: "explosion" },
          { timestampSeconds: 45.0, effectId: "crowd-cheer", volume: 0.8 },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("sfx-injection");
    expect(res.body.timestamps).toHaveLength(2);
    expect(res.body.timestamps[0].effectId).toBe("explosion");
    expect(res.body.timestamps[1].volume).toBe(0.8);
  });

  it("uses default volume 1.0 when omitted", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "video-006",
        timestamps: [{ timestampSeconds: 5, effectId: "whoosh" }],
      });
    expect(res.status).toBe(202);
    expect(res.body.timestamps[0].volume).toBe(1.0);
  });

  it("rejects an unknown effectId", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "video-006",
        timestamps: [{ timestampSeconds: 5, effectId: "alien-zap" }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects a negative timestamp", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "video-006",
        timestamps: [{ timestampSeconds: -1, effectId: "thunder" }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an empty timestamps array", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({ videoId: "video-006", timestamps: [] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Speed Change
// ---------------------------------------------------------------------------

describe("POST /api/remixes/audio/speed", () => {
  it("creates a speed-change job with factor 1.5", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: 1.5 });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("speed-change");
    expect(res.body.factor).toBe(1.5);
    expect(res.body.pitchCompensated).toBe(true);
  });

  it("accepts the minimum factor (0.25)", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: 0.25 });
    expect(res.status).toBe(202);
  });

  it("accepts the maximum factor (4.0)", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: 4.0 });
    expect(res.status).toBe(202);
  });

  it("rejects a factor below the minimum", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: 0.1 });
    expect(res.status).toBe(400);
  });

  it("rejects a factor above the maximum", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric factor", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-007", factor: "fast" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Voice Clone
// ---------------------------------------------------------------------------

describe("POST /api/remixes/audio/voice-clone", () => {
  it("creates a voice-clone job", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/voice-clone")
      .send({ videoId: "video-008", targetVoiceId: "voice-morgan-freeman" });

    expect(res.status).toBe(202);
    expect(res.body.type).toBe("voice-clone");
    expect(res.body.targetVoiceId).toBe("voice-morgan-freeman");
    expect(res.body.lipSyncOffsetMs).toBeNull();
    expect(res.body.status).toBe("queued");
  });

  it("rejects missing targetVoiceId", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/voice-clone")
      .send({ videoId: "video-008" });
    expect(res.status).toBe(400);
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/voice-clone")
      .send({ targetVoiceId: "voice-x" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Get audio job
// ---------------------------------------------------------------------------

describe("GET /api/remixes/audio/jobs/:jobId", () => {
  it("retrieves a created audio job", async () => {
    const create = await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "video-009", genre: "lo-fi" });

    const res = await request(app).get(`/api/remixes/audio/jobs/${create.body.jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(create.body.jobId);
    expect(res.body.genre).toBe("lo-fi");
  });

  it("returns 404 for unknown audio job", async () => {
    const res = await request(app).get("/api/remixes/audio/jobs/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// List audio jobs for a video
// ---------------------------------------------------------------------------

describe("GET /api/remixes/audio/videos/:videoId/jobs", () => {
  it("lists all audio jobs for a video", async () => {
    await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "video-audio-multi", genre: "jazz" });
    await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "video-audio-multi", factor: 1.25 });

    const res = await request(app).get("/api/remixes/audio/videos/video-audio-multi/jobs");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.jobs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Trending remixes feed
// ---------------------------------------------------------------------------

describe("GET /api/remixes/trending", () => {
  it("returns the seeded trending remixes sorted by viewCount", async () => {
    const res = await request(app).get("/api/remixes/trending");
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.remixes).toBeDefined();

    const remixes = res.body.remixes as Array<{ stats: { viewCount: number }; attribution: { label: string } }>;
    expect(remixes.length).toBeGreaterThan(0);

    // Verify sorted descending by viewCount
    for (let i = 1; i < remixes.length; i++) {
      expect(remixes[i - 1].stats.viewCount).toBeGreaterThanOrEqual(remixes[i].stats.viewCount);
    }

    // Verify attribution label format
    for (const remix of remixes) {
      expect(remix.attribution.label).toMatch(/^Remixed from @/);
    }
  });
});

// ---------------------------------------------------------------------------
// Remix chains
// ---------------------------------------------------------------------------

describe("GET /api/remixes/chains/:originalVideoId", () => {
  it("returns the remix chain for a seeded original video", async () => {
    const res = await request(app).get("/api/remixes/chains/video-001");
    expect(res.status).toBe(200);
    expect(res.body.originalVideoId).toBe("video-001");
    expect(res.body.chainLength).toBeGreaterThan(0);
    for (const item of res.body.chain) {
      expect(item.attribution.originalVideoId).toBe("video-001");
    }
  });

  it("returns an empty chain for a video with no remixes", async () => {
    const res = await request(app).get("/api/remixes/chains/unknown-original");
    expect(res.status).toBe(200);
    expect(res.body.chainLength).toBe(0);
    expect(res.body.chain).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe("GET /api/remixes/:remixId/attribution", () => {
  it("returns attribution for a seeded remix", async () => {
    const res = await request(app).get("/api/remixes/remix-trending-001/attribution");
    expect(res.status).toBe(200);
    expect(res.body.remixId).toBe("remix-trending-001");
    expect(res.body.originalCreatorHandle).toBe("@speedrunner");
    expect(res.body.label).toMatch(/^Remixed from @/);
    expect(res.body.deepLink).toContain("https://quanttube.app/watch/");
  });

  it("returns 404 for a non-existent remix", async () => {
    const res = await request(app).get("/api/remixes/nonexistent-remix/attribution");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// One-click publish
// ---------------------------------------------------------------------------

describe("POST /api/remixes/:remixId/publish", () => {
  it("publishes a completed style-transfer job", async () => {
    // Wait for processing to complete
    const create = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "vid-publish-test", style: "cyberpunk" });

    // Poll until completed (up to 2 seconds)
    let job = create.body;
    const startTime = Date.now();
    while (job.status !== "completed" && Date.now() - startTime < 2000) {
      await new Promise((r) => setTimeout(r, 100));
      const poll = await request(app).get(`/api/remixes/jobs/${job.jobId}`);
      job = poll.body;
    }

    const res = await request(app)
      .post(`/api/remixes/${job.jobId}/publish`)
      .send({
        title: "Cyberpunk Remix",
        description: "An awesome remix",
        tags: ["cyberpunk", "ai"],
        originalVideoId: "vid-publish-test",
        originalCreatorHandle: "@testcreator",
      });

    expect(res.status).toBe(201);
    expect(res.body.remixId).toBe(job.jobId);
    expect(res.body.title).toBe("Cyberpunk Remix");
    expect(res.body.originalCreatorHandle).toBe("@testcreator");
  });

  it("rejects publishing a job that is not yet completed", async () => {
    const create = await request(app)
      .post("/api/remixes/style-transfer")
      .send({ videoId: "vid-not-done", style: "noir" });

    const res = await request(app)
      .post(`/api/remixes/${create.body.jobId}/publish`)
      .send({
        title: "Too Early",
        originalVideoId: "vid-not-done",
        originalCreatorHandle: "@early",
      });

    expect(res.status).toBe(409);
  });

  it("rejects publishing with missing title", async () => {
    const res = await request(app)
      .post("/api/remixes/some-remix-id/publish")
      .send({
        originalVideoId: "video-001",
        originalCreatorHandle: "@creator",
      });
    expect(res.status).toBe(400);
  });

  it("prevents double-publishing the same remix", async () => {
    // Use an already-seeded published remix
    const res = await request(app)
      .post("/api/remixes/remix-trending-001/publish")
      .send({
        title: "Duplicate",
        originalVideoId: "video-001",
        originalCreatorHandle: "@speedrunner",
      });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Metadata endpoints
// ---------------------------------------------------------------------------

describe("GET /api/remixes/meta/styles", () => {
  it("returns all 5 style presets", async () => {
    const res = await request(app).get("/api/remixes/meta/styles");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    expect(res.body.styles).toContain("anime");
    expect(res.body.styles).toContain("retro-vhs");
  });
});

describe("GET /api/remixes/meta/effects", () => {
  it("returns all 6 visual effects", async () => {
    const res = await request(app).get("/api/remixes/meta/effects");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(6);
    expect(res.body.effects).toContain("glitch");
    expect(res.body.effects).toContain("vhs-scan-lines");
  });
});

describe("GET /api/remixes/meta/backgrounds", () => {
  it("returns available background presets", async () => {
    const res = await request(app).get("/api/remixes/meta/backgrounds");
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.backgrounds).toContain("space");
  });
});

describe("GET /api/remixes/meta/music-genres", () => {
  it("returns all 10 music genres", async () => {
    const res = await request(app).get("/api/remixes/meta/music-genres");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(10);
    expect(res.body.genres).toContain("synthwave");
    expect(res.body.genres).toContain("lo-fi");
  });
});

describe("GET /api/remixes/meta/sound-effects", () => {
  it("returns all 10 sound effects", async () => {
    const res = await request(app).get("/api/remixes/meta/sound-effects");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(10);
    expect(res.body.soundEffects).toContain("explosion");
    expect(res.body.soundEffects).toContain("whoosh");
  });
});
