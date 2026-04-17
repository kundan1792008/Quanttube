/**
 * Tests for new Quanttube MVP endpoints:
 *  - GET  /api/v1/stream/:mediaId
 *  - POST /api/v1/cinema/:mediaId/choices
 *  - POST /api/v1/feed/signals
 *  - GET  /api/v1/feed/:userId/recommendation
 *  - GET  /api/v1/feed/:userId/signals
 */
import request from "supertest";
import app from "../app";
import { _resetTelepathicFeed } from "../services/telepathic-feed";

beforeEach(() => {
  _resetTelepathicFeed();
});

// ---------------------------------------------------------------------------
// Adaptive HLS Streaming – GET /api/v1/stream/:mediaId
// ---------------------------------------------------------------------------

describe("GET /api/v1/stream/:mediaId", () => {
  it("returns a stub HLS manifest with default engagement score", async () => {
    const res = await request(app).get("/api/v1/stream/movie-001");
    expect(res.status).toBe(200);
    expect(res.body.mediaId).toBe("movie-001");
    expect(res.body.hlsManifestUrl).toContain("movie-001");
    expect(res.body.selectedTier).toBeDefined();
    expect(res.body.allTiers).toHaveLength(7);
  });

  it("returns a DASH manifest URL alongside HLS", async () => {
    const res = await request(app).get("/api/v1/stream/movie-001");
    expect(res.status).toBe(200);
    expect(res.body.dashManifestUrl).toContain("movie-001");
    expect(res.body.dashManifestUrl).toContain("manifest.mpd");
    expect(res.body.syncMetadata).toBeDefined();
    expect(res.body.syncMetadata.targetSyncOffsetMs).toBe(100);
  });

  it("selects 4K tier for engagement score 0.9", async () => {
    const res = await request(app)
      .get("/api/v1/stream/movie-001")
      .query({ engagementScore: "0.9" });
    expect(res.status).toBe(200);
    expect(res.body.selectedTier.resolution).toBe("2160p");
  });

  it("selects audio tier for audio-only mode", async () => {
    const res = await request(app)
      .get("/api/v1/stream/podcast-001")
      .query({ mode: "audio-only" });
    expect(res.status).toBe(200);
    expect(res.body.selectedTier.resolution).toBe("audio");
    expect(res.body.syncMetadata.protocol).toBe("hls-audio-only");
  });

  it("rejects invalid engagementScore", async () => {
    const res = await request(app)
      .get("/api/v1/stream/movie-001")
      .query({ engagementScore: "1.5" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid mode", async () => {
    const res = await request(app)
      .get("/api/v1/stream/movie-001")
      .query({ mode: "invalid-mode" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Interactive Cinema – POST /api/v1/cinema/:mediaId/choices
// ---------------------------------------------------------------------------

describe("POST /api/v1/cinema/:mediaId/choices", () => {
  it("returns AI story choices with defaults", async () => {
    const res = await request(app)
      .post("/api/v1/cinema/series-001/choices")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.mediaId).toBe("series-001");
    expect(Array.isArray(res.body.choices)).toBe(true);
    expect(res.body.choices.length).toBe(3); // default count
    expect(res.body.choices[0]).toHaveProperty("id");
    expect(res.body.choices[0]).toHaveProperty("label");
    expect(res.body.choices[0]).toHaveProperty("aiScore");
  });

  it("respects count parameter", async () => {
    const res = await request(app)
      .post("/api/v1/cinema/series-001/choices")
      .send({ count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.choices.length).toBe(2);
  });

  it("personalises choices using userTags", async () => {
    const res = await request(app)
      .post("/api/v1/cinema/series-001/choices")
      .send({ userTags: ["mystery", "tension"], count: 6 });
    expect(res.status).toBe(200);
    // The mystery/tension-tagged choice should rank higher
    expect(res.body.choices[0].aiScore).toBeGreaterThan(0);
  });

  it("rejects invalid progressFraction", async () => {
    const res = await request(app)
      .post("/api/v1/cinema/series-001/choices")
      .send({ progressFraction: 1.5 });
    expect(res.status).toBe(400);
  });

  it("rejects count greater than 6", async () => {
    const res = await request(app)
      .post("/api/v1/cinema/series-001/choices")
      .send({ count: 10 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Telepathic Feed Engine – signal ingestion and recommendations
// ---------------------------------------------------------------------------

describe("POST /api/v1/feed/signals", () => {
  it("accepts a valid cross-app signal", async () => {
    const res = await request(app)
      .post("/api/v1/feed/signals")
      .send({
        userId: "user-001",
        signalType: "QUANTMAIL_FLIGHT_TICKET",
        payload: { destination: "Paris" },
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });

  it("rejects missing userId", async () => {
    const res = await request(app)
      .post("/api/v1/feed/signals")
      .send({ signalType: "QUANTMAIL_FLIGHT_TICKET", payload: {} });
    expect(res.status).toBe(400);
  });

  it("rejects invalid signalType", async () => {
    const res = await request(app)
      .post("/api/v1/feed/signals")
      .send({ userId: "user-001", signalType: "FAKE_SIGNAL", payload: {} });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/feed/:userId/recommendation", () => {
  it("returns a default recommendation for a new user", async () => {
    const res = await request(app).get("/api/v1/feed/user-new/recommendation");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-new");
    expect(res.body.preferredMode).toBeDefined();
    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body.confidenceScore).toBeDefined();
  });

  it("returns personalised recommendation after ingesting a flight signal", async () => {
    await request(app)
      .post("/api/v1/feed/signals")
      .send({
        userId: "user-traveller",
        signalType: "QUANTMAIL_FLIGHT_TICKET",
        payload: { destination: "Tokyo" },
      });

    const res = await request(app).get("/api/v1/feed/user-traveller/recommendation");
    expect(res.status).toBe(200);
    expect(res.body.tags).toContain("tokyo");
    expect(res.body.tags).toContain("travel");
    expect(res.body.preferredMode).toBe("cinema");
  });

  it("switches to audio-only mode after chat keyword signal", async () => {
    await request(app)
      .post("/api/v1/feed/signals")
      .send({
        userId: "user-driver",
        signalType: "QUANTCHAT_KEYWORD",
        payload: { keyword: "driving" },
      });

    const res = await request(app).get("/api/v1/feed/user-driver/recommendation");
    expect(res.status).toBe(200);
    expect(res.body.preferredMode).toBe("audio-only");
  });
});

describe("GET /api/v1/feed/:userId/signals", () => {
  it("returns empty signals for new user", async () => {
    const res = await request(app).get("/api/v1/feed/user-empty/signals");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.signals).toEqual([]);
  });

  it("returns ingested signals for a user", async () => {
    await request(app)
      .post("/api/v1/feed/signals")
      .send({
        userId: "user-signaled",
        signalType: "QUANTSINK_POST_REACTION",
        payload: { topic: "music" },
      });

    const res = await request(app).get("/api/v1/feed/user-signaled/signals");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.signals[0].signalType).toBe("QUANTSINK_POST_REACTION");
  });
});
