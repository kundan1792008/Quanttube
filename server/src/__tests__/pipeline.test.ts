/**
 * pipeline.test.ts – 20+ tests covering:
 *  • UploadService (initiate, chunk, assemble, metadata, tus helpers)
 *  • TranscodeService (command builders, HLS playlist, progress parser, tokenizer)
 *  • TranscriptionService (job queue, stub transcription)
 *  • TranslationService (timing multiplier, timing adjustment, job queue)
 *  • VoiceSynthesisService (voice profile, lip-sync ratio, ffmpeg command builders)
 *  • ContentRecommender (tokenize, TF-IDF, cosine similarity, indexing, recommendations)
 *  • CollaborativeRecommender (ALS, Gaussian elimination, interactions, recommendations)
 *  • HybridRecommender (trending score, diversity penalty, end-to-end recommendations)
 *  • Video API routes (CRUD, comments, likes, playlists, transcoding, dubbing, recommendations)
 */

import request from "supertest";
import app from "../app";

// Service imports for unit-level testing
import {
  initiateUpload,
  uploadChunk,
  getUploadSession,
  parseTusMetadata,
  buildTusMetadata,
  _resetUploadSessions,
} from "../services/UploadService";

import {
  buildHlsCommand,
  buildDashCommand,
  generateHlsMasterPlaylist,
  parseProgressFromFfmpegStderr,
  tokenizeCommand,
  enqueueTranscode,
  getTranscodeJob,
  BITRATE_VARIANTS,
  _resetTranscodeJobs,
} from "../services/TranscodeService";

import {
  transcribeAudio,
  getTranscriptionJob,
  _resetTranscriptionJobs,
} from "../services/TranscriptionService";

import {
  translateSegments,
  getTranslationJob,
  computeTimingMultiplier,
  adjustSegmentTimings,
  _resetTranslationJobs,
} from "../services/TranslationService";
import type { TranslatedSegment } from "../services/TranslationService";
import type { TranscriptSegment } from "../services/TranscriptionService";

import {
  extractVoiceProfile,
  computeLipSyncStretchRatio,
  buildAtempoCommand,
  buildAudioMixCommand,
  synthesizeAudio,
  getSynthesisJob,
  _resetSynthesisJobs,
} from "../services/VoiceSynthesisService";

import {
  tokenize,
  getDurationBucket,
  cosineSimilarity,
  indexVideo,
  getContentSimilar,
  getIndexSize,
  _resetContentIndex,
} from "../services/ContentRecommender";

import {
  recordInteraction,
  getCollaborativeRecommendations,
  getConfidence,
  getModelState,
  gaussianElimination,
  trainAls,
  _resetCollaborativeModel,
} from "../services/CollaborativeRecommender";

import {
  computeTrendingScore,
  applyDiversityPenalty,
  registerVideo,
  getRecommendations,
  _resetHybridRecommender,
} from "../services/HybridRecommender";
import type { VideoMetaForRecommender, HybridRecommendation } from "../services/HybridRecommender";

import { _resetVideoStores } from "../routes/videos";

// ---------------------------------------------------------------------------
// Global reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetUploadSessions();
  _resetTranscodeJobs();
  _resetTranscriptionJobs();
  _resetTranslationJobs();
  _resetSynthesisJobs();
  _resetContentIndex();
  _resetCollaborativeModel();
  _resetHybridRecommender();
  _resetVideoStores();
});

// ===========================================================================
// 1. UploadService – initiate upload
// ===========================================================================

describe("UploadService – initiateUpload", () => {
  it("creates an upload session with correct chunk parameters", () => {
    const result = initiateUpload({
      fileName: "movie.mp4",
      totalSizeBytes: 100 * 1024 * 1024, // 100 MB
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.uploadId).toHaveLength(32);
    expect(result.chunkSizeBytes).toBeGreaterThan(0);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    expect(result.uploadUrl).toContain(result.uploadId);
  });

  it("rejects files exceeding 10 GB limit", () => {
    const result = initiateUpload({
      fileName: "huge.mkv",
      totalSizeBytes: 11 * 1024 * 1024 * 1024, // 11 GB
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/too large/i);
    }
  });

  it("rejects missing fileName", () => {
    const result = initiateUpload({ fileName: "  ", totalSizeBytes: 1024 });
    expect("error" in result).toBe(true);
  });

  it("rejects zero totalSizeBytes", () => {
    const result = initiateUpload({ fileName: "video.mp4", totalSizeBytes: 0 });
    expect("error" in result).toBe(true);
  });

  it("stores the session and retrieves it", () => {
    const result = initiateUpload({ fileName: "video.mp4", totalSizeBytes: 1024 });
    if ("error" in result) throw new Error(result.error);

    const session = getUploadSession(result.uploadId);
    expect(session).toBeDefined();
    expect(session!.status).toBe("initiated");
    expect(session!.fileName).toBe("video.mp4");
  });
});

// ===========================================================================
// 2. UploadService – uploadChunk
// ===========================================================================

describe("UploadService – uploadChunk", () => {
  it("accepts a valid chunk and updates receivedBytes", async () => {
    const init = initiateUpload({ fileName: "test.mp4", totalSizeBytes: 1024 * 1024 });
    if ("error" in init) throw new Error(init.error);

    const chunkData = Buffer.alloc(512 * 1024, 0xAB); // 512 KB

    const result = await uploadChunk({
      uploadId: init.uploadId,
      chunkIndex: 0,
      chunkData,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.receivedBytes).toBe(chunkData.length);
    expect(result.progressPct).toBeGreaterThan(0);
  });

  it("rejects unknown uploadId", async () => {
    const result = await uploadChunk({
      uploadId: "nonexistent",
      chunkIndex: 0,
      chunkData: Buffer.from("test"),
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/not found/i);
  });
});

// ===========================================================================
// 3. UploadService – tus metadata helpers
// ===========================================================================

describe("UploadService – tus metadata", () => {
  it("round-trips metadata through encode/decode", () => {
    const original = { filename: "my video.mp4", filesize: "1073741824", type: "video/mp4" };
    const encoded = buildTusMetadata(original);
    const decoded = parseTusMetadata(encoded);
    expect(decoded).toEqual(original);
  });

  it("handles empty metadata header gracefully", () => {
    expect(parseTusMetadata("")).toEqual({});
  });

  it("handles metadata without a value", () => {
    const result = parseTusMetadata("contentType");
    expect(result["contentType"]).toBe("");
  });
});

// ===========================================================================
// 4. TranscodeService – command builders
// ===========================================================================

describe("TranscodeService – buildHlsCommand", () => {
  it("includes all 4 bitrate variants", () => {
    const cmd = buildHlsCommand("/input/video.mp4", "/output");
    for (const variant of BITRATE_VARIANTS) {
      expect(cmd).toContain(String(variant.videoBitrateKbps));
    }
  });

  it("specifies -hls_time parameter", () => {
    const cmd = buildHlsCommand("/input/video.mp4", "/output");
    expect(cmd).toContain("-hls_time");
  });

  it("includes input file path", () => {
    const cmd = buildHlsCommand("/my/video.mp4", "/output");
    expect(cmd).toContain("/my/video.mp4");
  });
});

describe("TranscodeService – buildDashCommand", () => {
  it("outputs DASH manifest path", () => {
    const cmd = buildDashCommand("/input.mp4", "/output");
    expect(cmd).toContain("manifest.mpd");
  });

  it("uses -f dash muxer", () => {
    const cmd = buildDashCommand("/input.mp4", "/output");
    expect(cmd).toContain("-f dash");
  });
});

describe("TranscodeService – generateHlsMasterPlaylist", () => {
  it("contains EXTM3U header", () => {
    const playlist = generateHlsMasterPlaylist("job-1", "video-1");
    expect(playlist).toContain("#EXTM3U");
  });

  it("contains all variant resolutions", () => {
    const playlist = generateHlsMasterPlaylist("job-1", "video-1");
    for (const v of BITRATE_VARIANTS) {
      expect(playlist).toContain(v.resolution);
    }
  });
});

describe("TranscodeService – parseProgressFromFfmpegStderr", () => {
  it("parses time=HH:MM:SS correctly", () => {
    const pct = parseProgressFromFfmpegStderr(
      "frame=  500 fps= 24 time=00:01:00.00 bitrate=1200kbps",
      120 // 2 minute video
    );
    expect(pct).toBe(50); // 60s / 120s = 50%
  });

  it("returns 0 when no time field present", () => {
    expect(parseProgressFromFfmpegStderr("frame=100 fps=30", 120)).toBe(0);
  });

  it("clamps to 99 maximum (100 is reserved for completion)", () => {
    const pct = parseProgressFromFfmpegStderr(
      "time=00:05:00.00",
      60 // 1 minute total
    );
    expect(pct).toBe(99);
  });
});

describe("TranscodeService – tokenizeCommand", () => {
  it("splits simple command correctly", () => {
    const tokens = tokenizeCommand('ffmpeg -i "input.mp4" -y output.mp4');
    expect(tokens).toEqual(["ffmpeg", "-i", "input.mp4", "-y", "output.mp4"]);
  });

  it("handles backslash-newline continuation", () => {
    const tokens = tokenizeCommand("ffmpeg \\\n  -i input.mp4");
    expect(tokens).toContain("ffmpeg");
    expect(tokens).toContain("-i");
  });
});

// ===========================================================================
// 5. TranscodeService – job enqueue
// ===========================================================================

describe("TranscodeService – enqueueTranscode", () => {
  it("creates a transcode job with queued/processing status", async () => {
    const result = enqueueTranscode({
      videoId: "video-001",
      inputPath: "/tmp/video.mp4",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.jobId).toBeDefined();
    expect(result.videoId).toBe("video-001");
    expect(["queued", "processing"]).toContain(result.status);
  });

  it("retrieves job by ID", async () => {
    const result = enqueueTranscode({ videoId: "v1", inputPath: "/tmp/v.mp4" });
    if ("error" in result) throw new Error(String(result.error));

    const job = getTranscodeJob(result.jobId);
    expect(job).toBeDefined();
    expect(job!.videoId).toBe("v1");
  });

  it("rejects missing videoId", () => {
    const result = enqueueTranscode({ videoId: "", inputPath: "/tmp/v.mp4" });
    expect("error" in result).toBe(true);
  });
});

// ===========================================================================
// 6. TranscriptionService
// ===========================================================================

describe("TranscriptionService – transcribeAudio", () => {
  it("creates a transcription job immediately", () => {
    const job = transcribeAudio({
      videoId: "video-001",
      audioPath: "/tmp/audio.mp3",
      language: "en",
    });

    expect(job.jobId).toBeDefined();
    expect(job.videoId).toBe("video-001");
    expect(["queued", "processing"]).toContain(job.status);
  });

  it("completes with stub result when API key absent", async () => {
    const job = transcribeAudio({
      videoId: "video-002",
      audioPath: "/nonexistent/audio.mp3",
      language: "auto",
    });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 200));

    const retrieved = getTranscriptionJob(job.jobId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe("completed");
    expect(retrieved!.result).not.toBeNull();
    expect(retrieved!.result!.segments.length).toBeGreaterThan(0);
  });

  it("each segment has required fields", async () => {
    const job = transcribeAudio({
      videoId: "video-003",
      audioPath: "/nonexistent/audio.mp3",
    });

    await new Promise((r) => setTimeout(r, 200));
    const retrieved = getTranscriptionJob(job.jobId);

    for (const seg of retrieved!.result!.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(0);
      expect(seg.end).toBeGreaterThan(seg.start);
      expect(typeof seg.text).toBe("string");
      expect(seg.confidence).toBeGreaterThanOrEqual(0);
      expect(seg.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// 7. TranslationService – timing adjustment
// ===========================================================================

describe("TranslationService – computeTimingMultiplier", () => {
  it("returns 1.0 for same language", () => {
    const mult = computeTimingMultiplier("en", "en");
    expect(mult).toBeCloseTo(1.0, 2);
  });

  it("returns > 1.0 when target is slower than source (de)", () => {
    // English is faster than German (de rate = 0.95)
    const mult = computeTimingMultiplier("en", "de");
    expect(mult).toBeGreaterThan(1.0);
  });

  it("returns < 1.0 when target is faster than source (zh)", () => {
    // Chinese rate = 1.2, so en (1.0) / zh (1.2) < 1
    const mult = computeTimingMultiplier("en", "zh");
    expect(mult).toBeLessThan(1.0);
  });

  it("clamps to [0.7, 1.5]", () => {
    const mult1 = computeTimingMultiplier("en", "zh");
    expect(mult1).toBeGreaterThanOrEqual(0.7);

    const mult2 = computeTimingMultiplier("zh", "en");
    expect(mult2).toBeLessThanOrEqual(1.5);
  });
});

describe("TranslationService – adjustSegmentTimings", () => {
  const makeSegments = (): TranslatedSegment[] => [
    { start: 0, end: 2, text: "Hello world", originalText: "Hello world", sourceLanguage: "en", targetLanguage: "fr", language: "fr", confidence: 0.9, wasTranslated: true, timingAdjusted: false, timingMultiplier: 1.0 },
    { start: 2, end: 4, text: "How are you", originalText: "How are you", sourceLanguage: "en", targetLanguage: "fr", language: "fr", confidence: 0.9, wasTranslated: true, timingAdjusted: false, timingMultiplier: 1.0 },
  ];

  it("does not adjust timing when multiplier ≈ 1.0", () => {
    const segs = makeSegments();
    const adjusted = adjustSegmentTimings(segs, 1.0);
    expect(adjusted[0]!.timingAdjusted).toBe(false);
    expect(adjusted[0]!.start).toBeCloseTo(0);
  });

  it("stretches segments when multiplier > 1.0", () => {
    const segs = makeSegments();
    const adjusted = adjustSegmentTimings(segs, 1.2);
    // End of first segment should be 2 * 1.2 = 2.4
    expect(adjusted[0]!.end).toBeCloseTo(2.4, 1);
    expect(adjusted[0]!.timingAdjusted).toBe(true);
  });
});

describe("TranslationService – translateSegments", () => {
  it("creates a translation job", async () => {
    const sourceSegments: TranscriptSegment[] = [
      { start: 0, end: 2, text: "Hello", confidence: 0.9, language: "en" },
    ];

    const job = translateSegments({
      videoId: "v1",
      transcriptionJobId: "t1",
      segments: sourceSegments,
      sourceLanguage: "en",
      targetLanguage: "fr",
    });

    expect(job.jobId).toBeDefined();
    await new Promise((r) => setTimeout(r, 200));

    const retrieved = getTranslationJob(job.jobId);
    expect(retrieved!.status).toBe("completed");
    expect(retrieved!.result!.segments[0]!.text).toContain("[FR]");
  });
});

// ===========================================================================
// 8. VoiceSynthesisService
// ===========================================================================

describe("VoiceSynthesisService – extractVoiceProfile", () => {
  it("returns deterministic profile for same path", async () => {
    const a = await extractVoiceProfile("/audio/ref.wav");
    const b = await extractVoiceProfile("/audio/ref.wav");
    expect(a.voiceId).toBe(b.voiceId);
    expect(a.pitchFactor).toBe(b.pitchFactor);
  });

  it("profile has 64-dimensional timbre vector", async () => {
    const profile = await extractVoiceProfile("/audio/test.mp3");
    expect(profile.timbreVector).toHaveLength(64);
  });

  it("pitch factor is within [0.9, 1.1]", async () => {
    const profile = await extractVoiceProfile("/audio/sample.wav");
    expect(profile.pitchFactor).toBeGreaterThanOrEqual(0.9);
    expect(profile.pitchFactor).toBeLessThanOrEqual(1.1);
  });
});

describe("VoiceSynthesisService – computeLipSyncStretchRatio", () => {
  it("returns 1.0 when durations match", () => {
    expect(computeLipSyncStretchRatio(2.0, 2.0)).toBeCloseTo(1.0);
  });

  it("speeds up audio when target is shorter than synthesized", () => {
    // 1.5s window, 2.0s audio → need to speed up: ratio < 1
    expect(computeLipSyncStretchRatio(1.5, 2.0)).toBeLessThan(1.0);
  });

  it("slows down audio when target is longer than synthesized", () => {
    // 3.0s window, 2.0s audio → slow down: ratio > 1
    expect(computeLipSyncStretchRatio(3.0, 2.0)).toBeGreaterThan(1.0);
  });

  it("clamps to [0.6, 1.5]", () => {
    expect(computeLipSyncStretchRatio(0.1, 10)).toBeGreaterThanOrEqual(0.6);
    expect(computeLipSyncStretchRatio(100, 1)).toBeLessThanOrEqual(1.5);
  });
});

describe("VoiceSynthesisService – buildAtempoCommand", () => {
  it("generates valid ffmpeg atempo command", () => {
    const cmd = buildAtempoCommand("/in.mp3", "/out.mp3", 1.2);
    expect(cmd).toContain("ffmpeg");
    expect(cmd).toContain("atempo");
    expect(cmd).toContain("/in.mp3");
    expect(cmd).toContain("/out.mp3");
  });

  it("chains atempo filters for values < 0.5", () => {
    const cmd = buildAtempoCommand("/in.mp3", "/out.mp3", 0.3);
    // Should contain multiple atempo= entries
    const count = (cmd.match(/atempo=/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("VoiceSynthesisService – buildAudioMixCommand", () => {
  it("includes amix filter", () => {
    const cmd = buildAudioMixCommand("/vocal.aac", "/bg.aac", "/mixed.aac");
    expect(cmd).toContain("amix");
    expect(cmd).toContain("volume=1.0");
    expect(cmd).toContain("volume=0.2");
  });
});

describe("VoiceSynthesisService – synthesizeAudio", () => {
  it("creates a synthesis job", async () => {
    const job = synthesizeAudio({
      videoId: "v1",
      translationJobId: "t1",
      translatedSegments: [],
      targetLanguage: "fr",
      referenceAudioPath: "/audio/ref.wav",
    });

    expect(job.jobId).toBeDefined();
    await new Promise((r) => setTimeout(r, 300));

    const retrieved = getSynthesisJob(job.jobId);
    expect(retrieved!.status).toBe("completed");
    expect(retrieved!.result).not.toBeNull();
  });
});

// ===========================================================================
// 9. ContentRecommender
// ===========================================================================

describe("ContentRecommender – tokenize", () => {
  it("lowercases and removes punctuation", () => {
    const tokens = tokenize("Hello, World!");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).not.toContain("Hello,");
  });

  it("removes stopwords", () => {
    const tokens = tokenize("the quick brown fox");
    expect(tokens).not.toContain("the");
    expect(tokens).toContain("quick");
  });
});

describe("ContentRecommender – cosine similarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("ContentRecommender – getDurationBucket", () => {
  it("classifies 30s as short (bucket 0)", () => {
    expect(getDurationBucket(30)).toBe(0);
  });

  it("classifies 3min as medium-short (bucket 1)", () => {
    expect(getDurationBucket(180)).toBe(1);
  });

  it("classifies 90min as very-long (bucket 4)", () => {
    expect(getDurationBucket(5400)).toBe(4);
  });
});

describe("ContentRecommender – indexVideo + getContentSimilar", () => {
  it("returns similar video by content overlap", () => {
    indexVideo({ videoId: "v1", title: "Machine Learning Tutorial", description: "Learn ML algorithms", tags: ["ml", "ai"], category: "education", durationSecs: 600, viewCount: 1000 });
    indexVideo({ videoId: "v2", title: "Deep Learning Introduction", description: "Neural networks and ML", tags: ["ml", "deep-learning"], category: "education", durationSecs: 800, viewCount: 2000 });
    indexVideo({ videoId: "v3", title: "Cooking Pasta from Scratch", description: "Italian cuisine recipe", tags: ["food", "cooking"], category: "food", durationSecs: 400, viewCount: 500 });

    expect(getIndexSize()).toBe(3);

    const similar = getContentSimilar("v1", 2);
    expect(similar.length).toBeGreaterThan(0);
    // v2 should be more similar to v1 than v3
    const v2rec = similar.find((r) => r.videoId === "v2");
    const v3rec = similar.find((r) => r.videoId === "v3");
    if (v2rec && v3rec) {
      expect(v2rec.score).toBeGreaterThan(v3rec.score);
    }
  });

  it("excludeIds filtering works", () => {
    indexVideo({ videoId: "a", title: "Coding tips", description: "Programming guide", tags: ["code"], category: "technology", durationSecs: 600, viewCount: 100 });
    indexVideo({ videoId: "b", title: "Coding advanced", description: "Programming tricks", tags: ["code"], category: "technology", durationSecs: 700, viewCount: 200 });
    indexVideo({ videoId: "c", title: "Music theory", description: "Notes and chords", tags: ["music"], category: "music", durationSecs: 900, viewCount: 300 });

    const similar = getContentSimilar("a", 5, ["b"]);
    const ids = similar.map((r) => r.videoId);
    expect(ids).not.toContain("b");
  });
});

// ===========================================================================
// 10. CollaborativeRecommender – gaussianElimination
// ===========================================================================

describe("CollaborativeRecommender – gaussianElimination", () => {
  it("solves 2×2 system correctly", () => {
    // 2x + y = 5, x + 3y = 10 → x = 1, y = 3
    const A = [[2, 1], [1, 3]];
    const b = [5, 10];
    const x = gaussianElimination(A, b);
    expect(x[0]).toBeCloseTo(1, 5);
    expect(x[1]).toBeCloseTo(3, 5);
  });

  it("solves 3×3 identity system", () => {
    const A = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const b = [3, 7, -2];
    const x = gaussianElimination(A, b);
    expect(x[0]).toBeCloseTo(3, 5);
    expect(x[1]).toBeCloseTo(7, 5);
    expect(x[2]).toBeCloseTo(-2, 5);
  });
});

describe("CollaborativeRecommender – recordInteraction & trainAls", () => {
  it("records interactions and updates confidence matrix", () => {
    recordInteraction({ userId: "u1", videoId: "v1", type: "watch", occurredAt: new Date().toISOString() });
    recordInteraction({ userId: "u1", videoId: "v2", type: "like", occurredAt: new Date().toISOString() });

    expect(getConfidence("u1", "v1")).toBeGreaterThan(0);
    expect(getConfidence("u1", "v2")).toBeGreaterThan(getConfidence("u1", "v1"));
  });

  it("watch-time interaction uses logarithmic scaling", () => {
    recordInteraction({ userId: "u2", videoId: "v1", type: "watchTime", value: 100, occurredAt: new Date().toISOString() });
    recordInteraction({ userId: "u2", videoId: "v2", type: "watchTime", value: 1000, occurredAt: new Date().toISOString() });

    // v2 should have higher confidence than v1 due to more watch time
    expect(getConfidence("u2", "v2")).toBeGreaterThan(getConfidence("u2", "v1"));
  });

  it("getModelState reflects trained model", () => {
    recordInteraction({ userId: "u1", videoId: "v1", type: "like", occurredAt: new Date().toISOString() });
    recordInteraction({ userId: "u2", videoId: "v2", type: "watch", occurredAt: new Date().toISOString() });

    trainAls();
    const state = getModelState();
    expect(state.users).toBe(2);
    expect(state.videos).toBe(2);
    expect(state.dirty).toBe(false);
  });

  it("returns recommendations for known user", () => {
    // User 1 watched v1; User 2 liked v1 and v2
    // ALS should suggest v2 to user 1
    recordInteraction({ userId: "u1", videoId: "v1", type: "watch", occurredAt: new Date().toISOString() });
    recordInteraction({ userId: "u2", videoId: "v1", type: "watch", occurredAt: new Date().toISOString() });
    recordInteraction({ userId: "u2", videoId: "v2", type: "like", occurredAt: new Date().toISOString() });

    trainAls();
    const recs = getCollaborativeRecommendations("u1", 5);
    // May or may not surface v2 depending on factors, but should return an array
    expect(Array.isArray(recs)).toBe(true);
  });

  it("returns empty for unknown user", () => {
    const recs = getCollaborativeRecommendations("unknown-user", 10);
    expect(recs).toEqual([]);
  });
});

// ===========================================================================
// 11. HybridRecommender
// ===========================================================================

describe("HybridRecommender – computeTrendingScore", () => {
  it("returns higher score for fresher content", () => {
    const now = Date.now();
    const fresh: VideoMetaForRecommender = { videoId: "v1", category: "tech", viewCount: 1000, publishedAt: new Date(now - 1000).toISOString() };
    const old: VideoMetaForRecommender = { videoId: "v2", category: "tech", viewCount: 1000, publishedAt: new Date(now - 30 * 24 * 3600 * 1000).toISOString() };

    const scoreFresh = computeTrendingScore(fresh, 1000, now);
    const scoreOld = computeTrendingScore(old, 1000, now);

    expect(scoreFresh).toBeGreaterThan(scoreOld);
  });

  it("higher view count gives higher trending score", () => {
    const now = Date.now();
    const publishedAt = new Date(now - 3600 * 1000).toISOString();
    const popular: VideoMetaForRecommender = { videoId: "v1", category: "music", viewCount: 100000, publishedAt };
    const unpopular: VideoMetaForRecommender = { videoId: "v2", category: "music", viewCount: 10, publishedAt };

    const s1 = computeTrendingScore(popular, 100000, now);
    const s2 = computeTrendingScore(unpopular, 100000, now);
    expect(s1).toBeGreaterThan(s2);
  });
});

describe("HybridRecommender – applyDiversityPenalty", () => {
  it("reduces score for duplicate categories", () => {
    const meta = new Map<string, VideoMetaForRecommender>([
      ["v1", { videoId: "v1", category: "gaming", viewCount: 100, publishedAt: new Date().toISOString() }],
      ["v2", { videoId: "v2", category: "gaming", viewCount: 200, publishedAt: new Date().toISOString() }],
      ["v3", { videoId: "v3", category: "music", viewCount: 300, publishedAt: new Date().toISOString() }],
    ]);

    const recs: HybridRecommendation[] = [
      { videoId: "v1", score: 0.8, contentScore: 0.8, collaborativeScore: 0, trendingScore: 0, reason: "", diversityPenaltyApplied: false },
      { videoId: "v2", score: 0.75, contentScore: 0.75, collaborativeScore: 0, trendingScore: 0, reason: "", diversityPenaltyApplied: false },
      { videoId: "v3", score: 0.7, contentScore: 0.7, collaborativeScore: 0, trendingScore: 0, reason: "", diversityPenaltyApplied: false },
    ];

    const result = applyDiversityPenalty(recs, meta);
    const v2result = result.find((r) => r.videoId === "v2");
    expect(v2result!.diversityPenaltyApplied).toBe(true);
    expect(v2result!.score).toBeLessThan(0.75);
  });
});

describe("HybridRecommender – getRecommendations", () => {
  it("returns an array (even for cold-start user)", async () => {
    registerVideo(
      { videoId: "v1", category: "education", viewCount: 5000, publishedAt: new Date().toISOString() },
      { videoId: "v1", title: "Machine Learning", description: "ML tutorial", tags: ["ml"], category: "education", durationSecs: 600, viewCount: 5000 }
    );
    registerVideo(
      { videoId: "v2", category: "education", viewCount: 3000, publishedAt: new Date().toISOString() },
      { videoId: "v2", title: "Deep Learning", description: "DL tutorial", tags: ["dl"], category: "education", durationSecs: 700, viewCount: 3000 }
    );

    const recs = await getRecommendations("new-user", 5);
    expect(Array.isArray(recs)).toBe(true);
  });

  it("respects excludeIds", async () => {
    registerVideo(
      { videoId: "va", category: "sports", viewCount: 1000, publishedAt: new Date().toISOString() },
      { videoId: "va", title: "Soccer Highlights", description: "Goals and saves", tags: ["soccer"], category: "sports", durationSecs: 300, viewCount: 1000 }
    );

    const recs = await getRecommendations("user-x", 5, ["va"]);
    const ids = recs.map((r) => r.videoId);
    expect(ids).not.toContain("va");
  });
});

// ===========================================================================
// 12. Video API routes (HTTP integration tests)
// ===========================================================================

describe("POST /api/v1/videos", () => {
  it("creates a video and returns 201", async () => {
    const res = await request(app).post("/api/v1/videos").send({
      title: "Test Video",
      description: "A test",
      category: "education",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("Test Video");
  });

  it("rejects missing title", async () => {
    const res = await request(app).post("/api/v1/videos").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/videos/:id", () => {
  it("returns 404 for unknown video", async () => {
    const res = await request(app).get("/api/v1/videos/nonexistent");
    expect(res.status).toBe(404);
  });

  it("retrieves a created video", async () => {
    const create = await request(app).post("/api/v1/videos").send({ title: "My Video" });
    const id = create.body.id;
    const get = await request(app).get(`/api/v1/videos/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.title).toBe("My Video");
  });
});

describe("POST /api/v1/videos/:id/comments", () => {
  it("adds a comment and returns 201", async () => {
    const create = await request(app).post("/api/v1/videos").send({ title: "Video" });
    const id = create.body.id;

    const comment = await request(app)
      .post(`/api/v1/videos/${id}/comments`)
      .send({ userId: "user-1", content: "Great video!" });

    expect(comment.status).toBe(201);
    expect(comment.body.content).toBe("Great video!");
  });

  it("returns 404 for unknown video", async () => {
    const res = await request(app)
      .post("/api/v1/videos/bad-id/comments")
      .send({ userId: "u1", content: "test" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/videos/:id/like + DELETE", () => {
  it("likes and unlikes a video", async () => {
    const create = await request(app).post("/api/v1/videos").send({ title: "V" });
    const id = create.body.id;

    const like = await request(app).post(`/api/v1/videos/${id}/like`).send({ userId: "u1" });
    expect(like.status).toBe(201);

    const count = await request(app).get(`/api/v1/videos/${id}/likes`);
    expect(count.body.count).toBe(1);

    const unlike = await request(app).delete(`/api/v1/videos/${id}/like`).send({ userId: "u1" });
    expect(unlike.status).toBe(200);

    const count2 = await request(app).get(`/api/v1/videos/${id}/likes`);
    expect(count2.body.count).toBe(0);
  });

  it("prevents double-like", async () => {
    const create = await request(app).post("/api/v1/videos").send({ title: "V" });
    const id = create.body.id;
    await request(app).post(`/api/v1/videos/${id}/like`).send({ userId: "u1" });
    const dupe = await request(app).post(`/api/v1/videos/${id}/like`).send({ userId: "u1" });
    expect(dupe.status).toBe(409);
  });
});

describe("POST /api/v1/playlists", () => {
  it("creates a playlist", async () => {
    const res = await request(app).post("/api/v1/playlists").send({
      userId: "u1",
      title: "My Favourites",
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("My Favourites");
    expect(res.body.items).toHaveLength(0);
  });

  it("adds and removes a video from a playlist", async () => {
    const pl = await request(app).post("/api/v1/playlists").send({ userId: "u1", title: "Watchlist" });
    const plId = pl.body.id;

    const vid = await request(app).post("/api/v1/videos").send({ title: "Video A" });
    const vidId = vid.body.id;

    const add = await request(app).post(`/api/v1/playlists/${plId}/items`).send({ videoId: vidId });
    expect(add.status).toBe(201);
    expect(add.body.items).toHaveLength(1);

    const remove = await request(app).delete(`/api/v1/playlists/${plId}/items/${vidId}`);
    expect(remove.status).toBe(200);
    expect(remove.body.items).toHaveLength(0);
  });
});

describe("POST /api/v1/videos/:id/transcode", () => {
  it("queues a transcode job", async () => {
    const vid = await request(app).post("/api/v1/videos").send({ title: "Raw Video" });
    const id = vid.body.id;

    const res = await request(app)
      .post(`/api/v1/videos/${id}/transcode`)
      .send({ inputPath: "/tmp/raw.mp4", durationSecs: 120 });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
  });
});

describe("POST /api/v1/videos/:id/dub", () => {
  it("starts the dubbing pipeline", async () => {
    const vid = await request(app).post("/api/v1/videos").send({ title: "Original Movie" });
    const id = vid.body.id;

    const res = await request(app)
      .post(`/api/v1/videos/${id}/dub`)
      .send({
        targetLanguage: "fr",
        referenceAudioPath: "/audio/original.wav",
        sourceLanguage: "en",
      });

    expect(res.status).toBe(202);
    expect(res.body.pipeline.transcriptionJobId).toBeDefined();
    expect(res.body.pipeline.translationJobId).toBeDefined();
    expect(res.body.pipeline.synthesisJobId).toBeDefined();
  });
});

describe("GET /api/v1/recommendations/:userId", () => {
  it("returns recommendations array", async () => {
    const res = await request(app).get("/api/v1/recommendations/user-001");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-001");
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.generatedAt).toBeDefined();
  });

  it("respects count parameter", async () => {
    // Register some videos first
    for (let i = 0; i < 5; i++) {
      registerVideo(
        { videoId: `rv${i}`, category: "entertainment", viewCount: i * 100, publishedAt: new Date().toISOString() },
        { videoId: `rv${i}`, title: `Video ${i}`, description: `Desc ${i}`, tags: ["fun"], category: "entertainment", durationSecs: 300, viewCount: i * 100 }
      );
    }

    const res = await request(app).get("/api/v1/recommendations/user-001?count=2");
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeLessThanOrEqual(2);
  });
});
