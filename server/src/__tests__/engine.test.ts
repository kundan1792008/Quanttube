import request from "supertest";
import app from "../app";
import { _resetStores } from "../services";
import { PlaybackMode, DubbingJobStatus, SUPPORTED_LANGUAGES } from "../types";

beforeEach(() => {
  _resetStores();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("returns engine info", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("format-shifting-engine");
  });
});

// ---------------------------------------------------------------------------
// Sessions – Contextual State Handler
// ---------------------------------------------------------------------------

describe("POST /api/sessions", () => {
  it("creates a session in cinema mode by default", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe(PlaybackMode.Cinema);
    expect(res.body.cacheRetained).toBe(true);
    expect(res.body.sessionId).toBeDefined();
  });

  it("rejects missing streamUrl", async () => {
    const res = await request(app).post("/api/sessions").send({});
    expect(res.status).toBe(400);
  });

  it("rejects invalid mode", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8", mode: "invalid" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/:id", () => {
  it("retrieves a created session", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app).get(`/api/sessions/${create.body.sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.streamUrl).toBe("https://cdn.example.com/movie.m3u8");
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app).get("/api/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Mode Transition – Background / Drive Mode → Audio-Only
// ---------------------------------------------------------------------------

describe("PATCH /api/sessions/:id/mode", () => {
  it("transitions to audio-only while retaining cache", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .patch(`/api/sessions/${create.body.sessionId}/mode`)
      .send({ mode: PlaybackMode.AudioOnly });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe(PlaybackMode.AudioOnly);
    expect(res.body.cacheRetained).toBe(true);
  });

  it("transitions back to cinema from audio-only", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    await request(app)
      .patch(`/api/sessions/${create.body.sessionId}/mode`)
      .send({ mode: PlaybackMode.AudioOnly });
    const res = await request(app)
      .patch(`/api/sessions/${create.body.sessionId}/mode`)
      .send({ mode: PlaybackMode.Cinema });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe(PlaybackMode.Cinema);
    expect(res.body.cacheRetained).toBe(true);
  });

  it("transitions to short-reel mode", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/reel.mp4" });
    const res = await request(app)
      .patch(`/api/sessions/${create.body.sessionId}/mode`)
      .send({ mode: PlaybackMode.ShortReel });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe(PlaybackMode.ShortReel);
  });

  it("rejects invalid mode", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .patch(`/api/sessions/${create.body.sessionId}/mode`)
      .send({ mode: "invalid" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Audio Buffer Extraction – Podcast / Spotify mode
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:id/audio", () => {
  it("extracts audio buffer from an active session", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app).get(
      `/api/sessions/${create.body.sessionId}/audio`
    );
    expect(res.status).toBe(200);
    expect(res.body.format).toBe("opus");
    expect(res.body.sampleRate).toBe(48000);
    expect(res.body.channels).toBe(2);
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app).get("/api/sessions/nonexistent/audio");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Deep-Dubbing ML Endpoints
// ---------------------------------------------------------------------------

describe("GET /api/dubbing/languages", () => {
  it("lists 150 supported languages", async () => {
    const res = await request(app).get("/api/dubbing/languages");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(150);
    expect(res.body.languages).toHaveLength(150);
  });
});

describe("POST /api/dubbing/jobs", () => {
  it("creates a dubbing job for a valid session and language", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "hi" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(DubbingJobStatus.Queued);
    expect(res.body.targetLanguage).toBe("hi");
  });

  it("rejects unsupported language", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "xx-invalid" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown session", async () => {
    const res = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: "nonexistent", targetLanguage: "en" });
    expect(res.status).toBe(400);
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/api/dubbing/jobs").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/dubbing/jobs/:id", () => {
  it("retrieves a created dubbing job", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const job = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "es" });
    const res = await request(app).get(`/api/dubbing/jobs/${job.body.jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.targetLanguage).toBe("es");
  });

  it("returns 404 for unknown job", async () => {
    const res = await request(app).get("/api/dubbing/jobs/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe("DELETE /api/sessions/:id", () => {
  it("deletes a session", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app).delete(
      `/api/sessions/${create.body.sessionId}`
    );
    expect(res.status).toBe(204);
  });

  it("returns 404 when deleting nonexistent session", async () => {
    const res = await request(app).delete("/api/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  it("lists all sessions", async () => {
    await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/a.m3u8" });
    await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/b.m3u8" });
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_LANGUAGES integrity
// ---------------------------------------------------------------------------

describe("SUPPORTED_LANGUAGES", () => {
  it("contains exactly 150 unique entries", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(150);
    expect(new Set(SUPPORTED_LANGUAGES).size).toBe(150);
  });
});
