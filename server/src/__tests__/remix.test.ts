/**
 * Tests for the AI Video Remix Engine:
 *   - RemixEngine service + `/api/remixes/*` video endpoints
 *   - AudioRemixService + `/api/remixes/audio/*` endpoints
 *   - Publish / trending / chains
 *   - Catalogues
 */
import request from "supertest";
import app from "../app";
import {
  _resetRemixEngine,
  applyStyleTransfer,
  swapBackground,
  generateAlternateEnding,
  addVisualEffects,
  publishRemix,
  remixEvents,
  STYLE_PRESETS,
  BACKGROUND_PRESETS,
  VISUAL_EFFECTS,
} from "../services/RemixEngine";
import {
  _resetAudioRemixService,
  changeMusic,
  addSoundEffects,
  speedChange,
  voiceClone,
  MUSIC_GENRES,
  SFX_IDS,
  VOICE_BANK,
} from "../services/AudioRemixService";

/** Wait until the `setImmediate`-based job pipeline drains. */
function flushJobs(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

beforeEach(() => {
  _resetRemixEngine();
  _resetAudioRemixService();
});

// ---------------------------------------------------------------------------
// RemixEngine service
// ---------------------------------------------------------------------------

describe("RemixEngine service", () => {
  it("applyStyleTransfer starts jobs in queued state", () => {
    const job = applyStyleTransfer("video-1", "anime");
    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.type).toBe("style-transfer");
    expect(job.params).toEqual({ style: "anime" });
  });

  it("applyStyleTransfer completes asynchronously with an output URL", async () => {
    const job = applyStyleTransfer("video-1", "cyberpunk");
    await flushJobs();
    expect(job.status).toBe("completed");
    expect(job.progress).toBe(100);
    expect(job.outputVideoUrl).toContain(job.jobId);
  });

  it("applyStyleTransfer rejects unknown styles", () => {
    expect(() =>
      applyStyleTransfer("video-1", "watercolour" as never),
    ).toThrow(/Unsupported style/);
  });

  it("swapBackground accepts presets and custom https URLs", async () => {
    const preset = swapBackground("video-1", "beach");
    const custom = swapBackground("video-1", "https://cdn.example.com/bg.jpg");
    await flushJobs();
    expect(preset.status).toBe("completed");
    expect(custom.status).toBe("completed");
    expect((preset.params as { isPreset: boolean }).isPreset).toBe(true);
    expect((custom.params as { isCustomUrl: boolean }).isCustomUrl).toBe(true);
  });

  it("swapBackground rejects non-URL non-preset strings", () => {
    expect(() => swapBackground("video-1", "mystery-background")).toThrow();
  });

  it("generateAlternateEnding populates generatedScript on completion", async () => {
    const job = generateAlternateEnding("video-1", "the villain was right");
    await flushJobs();
    expect(job.status).toBe("completed");
    expect(job.generatedScript).toBeDefined();
    expect(job.generatedScript!).toMatch(/the villain was right/);
  });

  it("generateAlternateEnding rejects prompts over 500 chars", () => {
    expect(() =>
      generateAlternateEnding("video-1", "x".repeat(501)),
    ).toThrow(/500/);
  });

  it("generateAlternateEnding handles empty prompt gracefully", async () => {
    const job = generateAlternateEnding("video-1", "");
    await flushJobs();
    expect(job.status).toBe("completed");
    expect(job.generatedScript).toBeDefined();
  });

  it("addVisualEffects deduplicates and preserves order", async () => {
    const job = addVisualEffects("video-1", [
      "rain",
      "glitch",
      "rain",
      "lens-flare",
    ]);
    await flushJobs();
    expect(job.status).toBe("completed");
    expect(job.params.effects).toEqual(["rain", "glitch", "lens-flare"]);
  });

  it("addVisualEffects rejects empty arrays and unknown effects", () => {
    expect(() => addVisualEffects("video-1", [])).toThrow(/non-empty/);
    expect(() =>
      addVisualEffects("video-1", ["sparkle" as never]),
    ).toThrow(/Unsupported/);
  });

  it("emits job.created, job.progress, and job.completed events", async () => {
    const events: string[] = [];
    remixEvents.on("job.created", () => events.push("created"));
    remixEvents.on("job.progress", () => events.push("progress"));
    remixEvents.on("job.completed", () => events.push("completed"));
    applyStyleTransfer("video-1", "noir");
    await flushJobs();
    expect(events[0]).toBe("created");
    expect(events).toContain("progress");
    expect(events[events.length - 1]).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// AudioRemixService service
// ---------------------------------------------------------------------------

describe("AudioRemixService service", () => {
  it("changeMusic validates genre", () => {
    expect(() => changeMusic("video-1", "polka" as never)).toThrow();
  });

  it("changeMusic completes and marks speech preserved", async () => {
    const job = changeMusic("video-1", "lofi");
    await flushJobs();
    expect(job.status).toBe("completed");
    expect((job.params as { speechPreserved: boolean }).speechPreserved).toBe(true);
    expect(job.outputAudioUrl).toContain(job.jobId);
  });

  it("addSoundEffects sorts entries by timestamp", async () => {
    const job = addSoundEffects("video-1", [
      { timestampSecs: 10, effectId: "boom" },
      { timestampSecs: 2, effectId: "applause", volumeDb: -3 },
      { timestampSecs: 5, effectId: "whoosh" },
    ]);
    await flushJobs();
    const entries = (job.params as { entries: { timestampSecs: number }[] }).entries;
    expect(entries.map((e) => e.timestampSecs)).toEqual([2, 5, 10]);
  });

  it("addSoundEffects rejects negative timestamps and out-of-range volume", () => {
    expect(() =>
      addSoundEffects("video-1", [
        { timestampSecs: -1, effectId: "ding" },
      ]),
    ).toThrow();
    expect(() =>
      addSoundEffects("video-1", [
        { timestampSecs: 0, effectId: "ding", volumeDb: 99 },
      ]),
    ).toThrow();
  });

  it("addSoundEffects rejects empty entries", () => {
    expect(() => addSoundEffects("video-1", [])).toThrow(/non-empty/);
  });

  it("speedChange enforces [0.25, 4.0] range", () => {
    expect(() => speedChange("video-1", 0.1)).toThrow();
    expect(() => speedChange("video-1", 5)).toThrow();
    expect(() => speedChange("video-1", Number.NaN)).toThrow();
  });

  it("speedChange completes with pitchPreserved flag", async () => {
    const job = speedChange("video-1", 1.5);
    await flushJobs();
    expect(job.status).toBe("completed");
    expect((job.params as { pitchPreserved: boolean }).pitchPreserved).toBe(true);
  });

  it("voiceClone reports lipSyncOffsetMs < 100", async () => {
    const job = voiceClone("video-1", "narrator-male");
    await flushJobs();
    expect(job.status).toBe("completed");
    expect(job.lipSyncOffsetMs).toBeGreaterThan(0);
    expect(job.lipSyncOffsetMs!).toBeLessThan(100);
  });

  it("voiceClone rejects unknown voice IDs", () => {
    expect(() => voiceClone("video-1", "celebrity-xyz" as never)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// HTTP – video remix endpoints
// ---------------------------------------------------------------------------

describe("POST /api/remixes/style", () => {
  it("returns 202 with a queued job", async () => {
    const res = await request(app)
      .post("/api/remixes/style")
      .send({ videoId: "v1", style: "anime" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.type).toBe("style-transfer");
  });

  it("rejects missing videoId", async () => {
    const res = await request(app)
      .post("/api/remixes/style")
      .send({ style: "anime" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid style", async () => {
    const res = await request(app)
      .post("/api/remixes/style")
      .send({ videoId: "v1", style: "watercolour" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/background", () => {
  it("accepts a preset", async () => {
    const res = await request(app)
      .post("/api/remixes/background")
      .send({ videoId: "v1", newBackground: "space" });
    expect(res.status).toBe(202);
    expect(res.body.params.isPreset).toBe(true);
  });

  it("accepts a custom https URL", async () => {
    const res = await request(app)
      .post("/api/remixes/background")
      .send({ videoId: "v1", newBackground: "https://cdn.example.com/b.jpg" });
    expect(res.status).toBe(202);
    expect(res.body.params.isCustomUrl).toBe(true);
  });

  it("rejects arbitrary strings that are neither preset nor URL", async () => {
    const res = await request(app)
      .post("/api/remixes/background")
      .send({ videoId: "v1", newBackground: "not-a-preset" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/ending", () => {
  it("accepts a prompt and eventually populates generatedScript", async () => {
    const res = await request(app)
      .post("/api/remixes/ending")
      .send({ videoId: "v1", prompt: "everyone becomes friends" });
    expect(res.status).toBe(202);
    const jobId = res.body.jobId;
    await flushJobs();
    const status = await request(app).get(`/api/remixes/jobs/${jobId}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("completed");
    expect(status.body.generatedScript).toMatch(/everyone becomes friends/);
  });

  it("rejects prompts over 500 chars", async () => {
    const res = await request(app)
      .post("/api/remixes/ending")
      .send({ videoId: "v1", prompt: "a".repeat(501) });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/effects", () => {
  it("accepts one or more effects", async () => {
    const res = await request(app)
      .post("/api/remixes/effects")
      .send({ videoId: "v1", effects: ["rain", "glitch"] });
    expect(res.status).toBe(202);
    expect(res.body.params.effects).toEqual(["rain", "glitch"]);
  });

  it("rejects empty arrays and invalid effects", async () => {
    const empty = await request(app)
      .post("/api/remixes/effects")
      .send({ videoId: "v1", effects: [] });
    expect(empty.status).toBe(400);

    const bad = await request(app)
      .post("/api/remixes/effects")
      .send({ videoId: "v1", effects: ["sparkle"] });
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/remixes/jobs", () => {
  it("lists jobs and supports filtering", async () => {
    applyStyleTransfer("v1", "noir");
    swapBackground("v2", "forest");
    addVisualEffects("v1", ["rain"]);
    await flushJobs();

    const all = await request(app).get("/api/remixes/jobs");
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);

    const onlyV1 = await request(app).get("/api/remixes/jobs?videoId=v1");
    expect(onlyV1.body.total).toBe(2);

    const onlyStyle = await request(app).get(
      "/api/remixes/jobs?type=style-transfer",
    );
    expect(onlyStyle.body.total).toBe(1);

    const completed = await request(app).get(
      "/api/remixes/jobs?status=completed",
    );
    expect(completed.body.total).toBe(3);
  });
});

describe("GET /api/remixes/jobs/:jobId", () => {
  it("returns 404 for unknown IDs", async () => {
    const res = await request(app).get("/api/remixes/jobs/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// HTTP – audio endpoints
// ---------------------------------------------------------------------------

describe("POST /api/remixes/audio/music", () => {
  it("queues a music-change job", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "v1", genre: "lofi" });
    expect(res.status).toBe(202);
    expect(res.body.type).toBe("music-change");
  });
  it("rejects invalid genre", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/music")
      .send({ videoId: "v1", genre: "polka" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/audio/sfx", () => {
  it("queues SFX with valid entries", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "v1",
        entries: [
          { timestampSecs: 0.5, effectId: "ding" },
          { timestampSecs: 3, effectId: "boom", volumeDb: 6 },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.params.entries).toHaveLength(2);
  });
  it("rejects out-of-range volume", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/sfx")
      .send({
        videoId: "v1",
        entries: [{ timestampSecs: 1, effectId: "ding", volumeDb: 99 }],
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/audio/speed", () => {
  it("accepts a valid factor", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "v1", factor: 0.75 });
    expect(res.status).toBe(202);
  });
  it("rejects factors outside [0.25, 4.0]", async () => {
    const res = await request(app)
      .post("/api/remixes/audio/speed")
      .send({ videoId: "v1", factor: 10 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remixes/audio/voice", () => {
  it("reports lipSyncOffsetMs under 100 on completion", async () => {
    const post = await request(app)
      .post("/api/remixes/audio/voice")
      .send({ videoId: "v1", targetVoiceId: "narrator-female" });
    expect(post.status).toBe(202);
    const { jobId } = post.body;
    await flushJobs();
    const get = await request(app).get(`/api/remixes/audio/jobs/${jobId}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe("completed");
    expect(get.body.lipSyncOffsetMs).toBeLessThan(100);
  });
});

describe("GET /api/remixes/audio/jobs", () => {
  it("filters by videoId", async () => {
    changeMusic("v1", "lofi");
    changeMusic("v2", "rock");
    await flushJobs();
    const res = await request(app).get("/api/remixes/audio/jobs?videoId=v1");
    expect(res.body.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Publish lifecycle
// ---------------------------------------------------------------------------

describe("POST /api/remixes/jobs/:jobId/publish", () => {
  it("publishes a completed job", async () => {
    const job = applyStyleTransfer("v1", "retro-vhs");
    await flushJobs();
    const res = await request(app)
      .post(`/api/remixes/jobs/${job.jobId}/publish`)
      .send({
        title: "My Retro Remix",
        description: "A retro VHS take",
        tags: ["retro", "vhs"],
        originalCreatorHandle: "ogcreator",
      });
    expect(res.status).toBe(201);
    expect(res.body.remixId).toBeDefined();
    expect(res.body.originalCreatorHandle).toBe("ogcreator");
    expect(res.body.originalVideoId).toBe("v1");
  });

  it("returns 409 when publishing an in-flight job", async () => {
    jest.useFakeTimers();
    try {
      const job = applyStyleTransfer("v1", "anime");
      // Job is queued; setImmediate has not yet fired.
      const res = await request(app)
        .post(`/api/remixes/jobs/${job.jobId}/publish`)
        .send({ title: "Too early" });
      expect(res.status).toBe(409);
      expect(job.status).toBe("queued");
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns 409 when publishing twice", async () => {
    const job = applyStyleTransfer("v1", "anime");
    await flushJobs();
    const first = await request(app)
      .post(`/api/remixes/jobs/${job.jobId}/publish`)
      .send({ title: "Once" });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/remixes/jobs/${job.jobId}/publish`)
      .send({ title: "Twice" });
    expect(second.status).toBe(409);
  });

  it("returns 404 for an unknown job", async () => {
    const res = await request(app)
      .post("/api/remixes/jobs/not-a-real-job/publish")
      .send({ title: "X" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when title is missing", async () => {
    const job = applyStyleTransfer("v1", "anime");
    await flushJobs();
    const res = await request(app)
      .post(`/api/remixes/jobs/${job.jobId}/publish`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Trending + chains
// ---------------------------------------------------------------------------

describe("GET /api/remixes/trending", () => {
  it("sorts by viewCount desc and includes attribution", async () => {
    const j1 = applyStyleTransfer("v1", "anime");
    const j2 = applyStyleTransfer("v1", "noir");
    await flushJobs();
    const r1 = publishRemix(j1.jobId, {
      title: "Anime",
      originalCreatorHandle: "alice",
    });
    const r2 = publishRemix(j2.jobId, {
      title: "Noir",
      originalCreatorHandle: "alice",
    });
    // Bump r2's views by hitting its endpoint twice.
    await request(app).get(`/api/remixes/published/${r2.remixId}`);
    await request(app).get(`/api/remixes/published/${r2.remixId}`);
    // And r1 once.
    await request(app).get(`/api/remixes/published/${r1.remixId}`);

    const res = await request(app).get("/api/remixes/trending");
    expect(res.status).toBe(200);
    expect(res.body.items[0].remixId).toBe(r2.remixId);
    expect(res.body.items[0].attribution).toBe("Remixed from @alice");
  });

  it("respects the limit query", async () => {
    for (let i = 0; i < 3; i += 1) {
      const j = applyStyleTransfer(`v${i}`, "anime");
      await flushJobs();
      publishRemix(j.jobId, { title: `R${i}` });
    }
    const res = await request(app).get("/api/remixes/trending?limit=2");
    expect(res.body.items).toHaveLength(2);
  });

  it("falls back to videoId attribution when no creator handle is given", async () => {
    const j = applyStyleTransfer("vX", "anime");
    await flushJobs();
    publishRemix(j.jobId, { title: "Anon" });
    const res = await request(app).get("/api/remixes/trending");
    expect(res.body.items[0].attribution).toMatch(/Remixed from video vX/);
  });
});

describe("GET /api/remixes/chains/:originalVideoId", () => {
  it("returns only remixes of the given original", async () => {
    const a = applyStyleTransfer("v-orig", "anime");
    const b = applyStyleTransfer("v-orig", "noir");
    const c = applyStyleTransfer("v-other", "cyberpunk");
    await flushJobs();
    publishRemix(a.jobId, { title: "A" });
    publishRemix(b.jobId, { title: "B" });
    publishRemix(c.jobId, { title: "C" });

    const res = await request(app).get("/api/remixes/chains/v-orig");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { title: string }) => r.title).sort()).toEqual([
      "A",
      "B",
    ]);
  });

  it("returns an empty chain when no remixes exist", async () => {
    const res = await request(app).get("/api/remixes/chains/unknown");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/remixes/published/:remixId", () => {
  it("increments viewCount on each fetch", async () => {
    const j = applyStyleTransfer("v1", "anime");
    await flushJobs();
    const r = publishRemix(j.jobId, { title: "V" });
    const a = await request(app).get(`/api/remixes/published/${r.remixId}`);
    const b = await request(app).get(`/api/remixes/published/${r.remixId}`);
    expect(a.body.viewCount).toBe(1);
    expect(b.body.viewCount).toBe(2);
  });

  it("returns 404 for unknown remixId", async () => {
    const res = await request(app).get("/api/remixes/published/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

describe("GET /api/remixes/meta/*", () => {
  it("exposes style/background/effect catalogues", async () => {
    const styles = await request(app).get("/api/remixes/meta/styles");
    expect(styles.body.items).toEqual([...STYLE_PRESETS]);

    const backgrounds = await request(app).get("/api/remixes/meta/backgrounds");
    expect(backgrounds.body.items).toEqual([...BACKGROUND_PRESETS]);

    const effects = await request(app).get("/api/remixes/meta/effects");
    expect(effects.body.items).toEqual([...VISUAL_EFFECTS]);
  });

  it("exposes genre/sfx/voice catalogues", async () => {
    const genres = await request(app).get("/api/remixes/meta/genres");
    expect(genres.body.items).toEqual([...MUSIC_GENRES]);

    const sfx = await request(app).get("/api/remixes/meta/sfx");
    expect(sfx.body.items).toEqual([...SFX_IDS]);

    const voices = await request(app).get("/api/remixes/meta/voices");
    expect(voices.body.items).toEqual([...VOICE_BANK]);
  });
});
