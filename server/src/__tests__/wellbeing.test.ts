/**
 * Tests for the Watch Wellbeing subsystem.
 */
import request from "supertest";
import app from "../app";
import { _resetWellbeing, DEFAULT_PREFERENCES } from "../services/wellbeing";

beforeEach(() => {
  _resetWellbeing();
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

describe("GET /api/v1/wellbeing/:userId/preferences", () => {
  it("returns sane defaults for a new user", async () => {
    const res = await request(app).get("/api/v1/wellbeing/user-1/preferences");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-1");
    expect(res.body.dailyLimitMinutes).toBe(DEFAULT_PREFERENCES.dailyLimitMinutes);
    expect(res.body.autoplayEnabled).toBe(false);
    expect(res.body.quietHours.enabled).toBe(false);
  });
});

describe("PATCH /api/v1/wellbeing/:userId/preferences", () => {
  it("updates daily limit, autoplay, and quiet hours", async () => {
    const res = await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({
        dailyLimitMinutes: 45,
        autoplayEnabled: true,
        autoplayCountdownSeconds: 10,
        quietHours: { enabled: true, startHour: 22, endHour: 6 },
      });
    expect(res.status).toBe(200);
    expect(res.body.dailyLimitMinutes).toBe(45);
    expect(res.body.autoplayEnabled).toBe(true);
    expect(res.body.autoplayCountdownSeconds).toBe(10);
    expect(res.body.quietHours).toEqual({ enabled: true, startHour: 22, endHour: 6 });
  });

  it("persists between calls", async () => {
    await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ dailyLimitMinutes: 30 });
    const res = await request(app).get("/api/v1/wellbeing/user-1/preferences");
    expect(res.body.dailyLimitMinutes).toBe(30);
  });

  it("rejects out-of-range dailyLimitMinutes", async () => {
    const res = await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ dailyLimitMinutes: 99999 });
    expect(res.status).toBe(400);
  });

  it("rejects invalid quiet-hour values", async () => {
    const res = await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ quietHours: { startHour: 25 } });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema)", async () => {
    const res = await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ surveillance: true });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Watch sessions
// ---------------------------------------------------------------------------

describe("POST /api/v1/wellbeing/:userId/sessions", () => {
  it("records a watch session", async () => {
    const res = await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "video-1", durationSeconds: 600 });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("user-1");
    expect(res.body.mediaId).toBe("video-1");
    expect(res.body.durationSeconds).toBe(600);
    expect(res.body.sessionId).toBeDefined();
  });

  it("rejects negative durations", async () => {
    const res = await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "video-1", durationSeconds: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects implausibly long durations", async () => {
    const res = await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "video-1", durationSeconds: 60 * 60 * 24 });
    expect(res.status).toBe(400);
  });

  it("rejects missing mediaId", async () => {
    const res = await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ durationSeconds: 60 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/wellbeing/:userId/sessions", () => {
  it("lists recorded sessions", async () => {
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v1", durationSeconds: 60 });
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v2", durationSeconds: 90 });
    const res = await request(app).get("/api/v1/wellbeing/user-1/sessions");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.sessions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Real-time status
// ---------------------------------------------------------------------------

describe("GET /api/v1/wellbeing/:userId/status", () => {
  it("reports remaining time and disallows autoplay by default", async () => {
    const res = await request(app).get("/api/v1/wellbeing/user-1/status");
    expect(res.status).toBe(200);
    expect(res.body.dailyLimitSeconds).toBe(DEFAULT_PREFERENCES.dailyLimitMinutes * 60);
    expect(res.body.remainingSeconds).toBe(DEFAULT_PREFERENCES.dailyLimitMinutes * 60);
    expect(res.body.limitReached).toBe(false);
    expect(res.body.autoplayAllowed).toBe(false);
    expect(res.body.autoplayReason).toMatch(/disabled/i);
  });

  it("flips limitReached once watch time meets the daily cap", async () => {
    await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ dailyLimitMinutes: 5, autoplayEnabled: true });
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v1", durationSeconds: 5 * 60 });

    const res = await request(app).get("/api/v1/wellbeing/user-1/status");
    expect(res.body.limitReached).toBe(true);
    expect(res.body.remainingSeconds).toBe(0);
    expect(res.body.autoplayAllowed).toBe(false);
    expect(res.body.autoplayReason).toMatch(/limit/i);
  });

  it("treats dailyLimitMinutes=0 as unlimited", async () => {
    await request(app)
      .patch("/api/v1/wellbeing/user-1/preferences")
      .send({ dailyLimitMinutes: 0, autoplayEnabled: true });
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v1", durationSeconds: 9999 });

    const res = await request(app).get("/api/v1/wellbeing/user-1/status");
    expect(res.body.dailyLimitSeconds).toBeNull();
    expect(res.body.remainingSeconds).toBeNull();
    expect(res.body.limitReached).toBe(false);
    expect(res.body.autoplayAllowed).toBe(true);
  });

  it("reports inQuietHours and blocks autoplay during the quiet window", async () => {
    jest.useFakeTimers();
    // 02:00 local time falls inside a 23 → 7 quiet window
    jest.setSystemTime(new Date(2026, 0, 1, 2, 0, 0));
    try {
      await request(app)
        .patch("/api/v1/wellbeing/user-1/preferences")
        .send({
          autoplayEnabled: true,
          quietHours: { enabled: true, startHour: 23, endHour: 7 },
        });
      const res = await request(app).get("/api/v1/wellbeing/user-1/status");
      expect(res.body.inQuietHours).toBe(true);
      expect(res.body.autoplayAllowed).toBe(false);
      expect(res.body.autoplayReason).toMatch(/quiet/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it("allows autoplay outside the quiet window", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    try {
      await request(app)
        .patch("/api/v1/wellbeing/user-1/preferences")
        .send({
          autoplayEnabled: true,
          quietHours: { enabled: true, startHour: 23, endHour: 7 },
        });
      const res = await request(app).get("/api/v1/wellbeing/user-1/status");
      expect(res.body.inQuietHours).toBe(false);
      expect(res.body.autoplayAllowed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

describe("GET /api/v1/wellbeing/:userId/insights", () => {
  it("returns 7 daily buckets and aggregates totals", async () => {
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v1", durationSeconds: 600 }); // 10 min today
    await request(app)
      .post("/api/v1/wellbeing/user-1/sessions")
      .send({ mediaId: "v2", durationSeconds: 1200 }); // 20 min today

    const res = await request(app).get("/api/v1/wellbeing/user-1/insights");
    expect(res.status).toBe(200);
    expect(res.body.dailyMinutes).toHaveLength(7);
    expect(res.body.totalMinutes).toBe(30);
    expect(res.body.longestSessionMinutes).toBe(20);
    // Today's bucket is last
    expect(res.body.dailyMinutes[6].minutes).toBe(30);
  });

  it("returns zeros for a user with no sessions", async () => {
    const res = await request(app).get("/api/v1/wellbeing/new-user/insights");
    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(0);
    expect(res.body.averageMinutesPerDay).toBe(0);
    expect(res.body.longestSessionMinutes).toBe(0);
  });
});
