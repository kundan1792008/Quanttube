import request from "supertest";
import app from "../app";
import { _resetStores } from "../services";
import {
  PlaybackMode,
  DubbingJobStatus,
  SUPPORTED_LANGUAGES,
  DEFAULT_DUB_LANGUAGES,
  AvatarPressureState,
  DeepLinkPlatform,
} from "../types";

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

// ---------------------------------------------------------------------------
// Quantchat reel sharing + deep-linking + Quantsink pressure
// ---------------------------------------------------------------------------

describe("POST /api/reels/share", () => {
  it("creates a reel share with fomo payload and deep links", async () => {
    const res = await request(app).post("/api/reels/share").send({
      reelId: "reel-001",
      groupId: "group-a",
      sharedBy: "member-owner",
      memberIds: ["member-a", "member-b"],
    });
    expect(res.status).toBe(201);
    expect(res.body.fomoPayload.label).toBe("FOMO_PAYLOAD");
    expect(res.body.fomoPayload.pressureWindowSeconds).toBe(300);
    expect(res.body.deepLinks.ios).toContain("quanttube://reels/share/");
    expect(res.body.deepLinks.android).toContain("quanttube://reels/share/");
    expect(res.body.deepLinks.web).toContain("https://quanttube.app/reels/share/");
    expect(res.body.memberStates).toHaveLength(2);
  });

  it("rejects invalid memberIds", async () => {
    const res = await request(app).post("/api/reels/share").send({
      reelId: "reel-001",
      groupId: "group-a",
      sharedBy: "member-owner",
      memberIds: [],
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/reels/share/:shareId/deep-link/:platform", () => {
  it("resolves iOS, Android and Web deep links", async () => {
    const create = await request(app).post("/api/reels/share").send({
      reelId: "reel-002",
      groupId: "group-a",
      sharedBy: "member-owner",
      memberIds: ["member-a"],
    });
    const shareId = create.body.shareId;

    const [ios, android, web] = await Promise.all([
      request(app).get(`/api/reels/share/${shareId}/deep-link/ios`),
      request(app).get(`/api/reels/share/${shareId}/deep-link/android`),
      request(app).get(`/api/reels/share/${shareId}/deep-link/web`),
    ]);

    expect(ios.status).toBe(200);
    expect(android.status).toBe(200);
    expect(web.status).toBe(200);
    expect(ios.body.platform).toBe(DeepLinkPlatform.IOS);
    expect(android.body.platform).toBe(DeepLinkPlatform.Android);
    expect(web.body.platform).toBe(DeepLinkPlatform.Web);
  });
});

describe("Quantsink avatar pressure behavior", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("turns avatar gray if member does not click within 5 minutes", async () => {
    await request(app).post("/api/reels/share").send({
      reelId: "reel-003",
      groupId: "group-pressure",
      sharedBy: "member-owner",
      memberIds: ["member-a", "member-b"],
    });

    let dashboard = await request(app).get("/api/reels/quantsink/group-pressure/avatars");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: "member-a", avatarState: AvatarPressureState.Pending }),
        expect.objectContaining({ memberId: "member-b", avatarState: AvatarPressureState.Pending }),
      ])
    );

    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    dashboard = await request(app).get("/api/reels/quantsink/group-pressure/avatars");
    expect(dashboard.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: "member-a", avatarState: AvatarPressureState.Gray }),
        expect.objectContaining({ memberId: "member-b", avatarState: AvatarPressureState.Gray }),
      ])
    );
  });

  it("keeps clicked member active and non-clicked member gray after pressure window", async () => {
    const share = await request(app).post("/api/reels/share").send({
      reelId: "reel-004",
      groupId: "group-pressure",
      sharedBy: "member-owner",
      memberIds: ["member-a", "member-b"],
    });

    const clicked = await request(app)
      .post(`/api/reels/share/${share.body.shareId}/click`)
      .send({ memberId: "member-a", platform: DeepLinkPlatform.Android });
    expect(clicked.status).toBe(200);

    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    const dashboard = await request(app).get("/api/reels/quantsink/group-pressure/avatars");
    expect(dashboard.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: "member-a", avatarState: AvatarPressureState.Active }),
        expect.objectContaining({ memberId: "member-b", avatarState: AvatarPressureState.Gray }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Batch Deep-Dubbing – POST /api/dubbing/batch
// ---------------------------------------------------------------------------

describe("POST /api/dubbing/batch", () => {
  it("creates 5 default dubbing jobs when no languages specified", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .post("/api/dubbing/batch")
      .send({ sessionId: session.body.sessionId });
    expect(res.status).toBe(201);
    expect(res.body.queued).toHaveLength(DEFAULT_DUB_LANGUAGES.length);
    for (const job of res.body.queued) {
      expect(DEFAULT_DUB_LANGUAGES).toContain(job.targetLanguage);
      expect(job.status).toBe(DubbingJobStatus.Queued);
    }
  });

  it("creates jobs for a custom list of languages", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const res = await request(app)
      .post("/api/dubbing/batch")
      .send({ sessionId: session.body.sessionId, languages: ["fr", "de", "ja"] });
    expect(res.status).toBe(201);
    expect(res.body.queued).toHaveLength(3);
    const langs = res.body.queued.map((j: { targetLanguage: string }) => j.targetLanguage);
    expect(langs).toContain("fr");
    expect(langs).toContain("de");
    expect(langs).toContain("ja");
  });

  it("rejects an unknown session", async () => {
    const res = await request(app)
      .post("/api/dubbing/batch")
      .send({ sessionId: "nonexistent" });
    expect(res.status).toBe(400);
  });

  it("rejects missing sessionId", async () => {
    const res = await request(app).post("/api/dubbing/batch").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a language list exceeding 20 entries", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const tooMany = Array.from({ length: 21 }, (_, i) => `lang-${i}`);
    const res = await request(app)
      .post("/api/dubbing/batch")
      .send({ sessionId: session.body.sessionId, languages: tooMany });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Dubbing job status update + lip-sync – PATCH /api/dubbing/jobs/:id/status
// ---------------------------------------------------------------------------

describe("PATCH /api/dubbing/jobs/:id/status", () => {
  it("transitions a job to processing", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const job = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "es" });
    const res = await request(app)
      .patch(`/api/dubbing/jobs/${job.body.jobId}/status`)
      .send({ status: DubbingJobStatus.Processing });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(DubbingJobStatus.Processing);
  });

  it("records syncOffsetMs on completion (sub-100ms target)", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const job = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "hi" });
    const res = await request(app)
      .patch(`/api/dubbing/jobs/${job.body.jobId}/status`)
      .send({ status: DubbingJobStatus.Completed, syncOffsetMs: 42 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(DubbingJobStatus.Completed);
    expect(res.body.syncOffsetMs).toBe(42);
    expect(res.body.syncOffsetMs).toBeLessThan(100);
  });

  it("returns 404 for unknown job", async () => {
    const res = await request(app)
      .patch("/api/dubbing/jobs/nonexistent/status")
      .send({ status: DubbingJobStatus.Failed });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid status value", async () => {
    const session = await request(app)
      .post("/api/sessions")
      .send({ streamUrl: "https://cdn.example.com/movie.m3u8" });
    const job = await request(app)
      .post("/api/dubbing/jobs")
      .send({ sessionId: session.body.sessionId, targetLanguage: "es" });
    const res = await request(app)
      .patch(`/api/dubbing/jobs/${job.body.jobId}/status`)
      .send({ status: "invalid-status" });
    expect(res.status).toBe(400);
  });
});
