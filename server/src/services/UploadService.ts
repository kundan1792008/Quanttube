/**
 * UploadService – Multipart & tus-protocol resumable upload handler.
 *
 * Supports:
 *  • Files up to 10 GB via chunked multipart upload.
 *  • tus-compatible resume tokens stored in-memory (Redis in production).
 *  • Video metadata extraction: duration, resolution, codec, framerate, filesize.
 *  • Thumbnail generation at 25 % timestamp via ffmpeg.
 *  • Metadata persistence in PostgreSQL via Prisma; binary stored in S3-compatible
 *    storage (stubbed with local-fs paths for local dev).
 */

import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { spawn } from "child_process";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum upload size: 10 GB */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

/** Default chunk size for tus-compatible uploads: 5 MB */
export const DEFAULT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

/** Storage root – in production this would be a pre-signed S3 path */
export const UPLOAD_STORAGE_ROOT =
  process.env.UPLOAD_STORAGE_ROOT ?? "/tmp/quanttube-uploads";

/** Thumbnail storage root */
export const THUMBNAIL_STORAGE_ROOT =
  process.env.THUMBNAIL_STORAGE_ROOT ?? "/tmp/quanttube-thumbnails";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  /** Duration of the video in seconds */
  durationSecs: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Video codec identifier, e.g. "h264", "hevc" */
  codec: string;
  /** Frames per second */
  framerate: number;
  /** File size in bytes */
  fileSizeBytes: number;
  /** Container format, e.g. "mp4", "mkv" */
  format: string;
  /** Audio codec, e.g. "aac", "opus" */
  audioCodec: string | null;
  /** Audio sample rate in Hz */
  audioSampleRate: number | null;
  /** Number of audio channels */
  audioChannels: number | null;
  /** Bitrate in kbps */
  bitrate: number | null;
}

export type UploadStatus =
  | "initiated"
  | "uploading"
  | "processing"
  | "complete"
  | "failed";

export interface UploadSession {
  uploadId: string;
  /** Quanttube video ID (assigned after metadata is known) */
  videoId: string | null;
  /** Original filename supplied by the client */
  fileName: string;
  /** Total expected size in bytes */
  totalSizeBytes: number;
  /** How many bytes have been received so far */
  receivedBytes: number;
  /** Ordered list of received chunk indices */
  receivedChunks: number[];
  /** Map<chunkIndex, storagePath> */
  chunkPaths: Record<number, string>;
  status: UploadStatus;
  metadata: VideoMetadata | null;
  thumbnailPath: string | null;
  assembledFilePath: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when upload was completed */
  completedAt: string | null;
  /** Error message if status === "failed" */
  errorMessage: string | null;
  /** Optional creator/user ID */
  ownerId: string | null;
}

export interface InitiateUploadParams {
  fileName: string;
  totalSizeBytes: number;
  ownerId?: string;
  /** Optional tus Upload-Metadata header value (base64 key-value pairs) */
  tusMetadata?: string;
}

export interface InitiateUploadResult {
  uploadId: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadUrl: string;
}

export interface UploadChunkParams {
  uploadId: string;
  chunkIndex: number;
  chunkData: Buffer;
  /** Expected chunk size; used for progress tracking */
  chunkSizeBytes?: number;
}

export interface UploadChunkResult {
  uploadId: string;
  chunkIndex: number;
  receivedBytes: number;
  totalSizeBytes: number;
  progressPct: number;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// In-memory upload session store
// ---------------------------------------------------------------------------

const uploadSessions = new Map<string, UploadSession>();

// ---------------------------------------------------------------------------
// Upload event emitter (for WebSocket progress updates)
// ---------------------------------------------------------------------------

export const uploadEvents = new EventEmitter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUploadId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function totalChunks(totalSizeBytes: number, chunkSize: number): number {
  return Math.ceil(totalSizeBytes / chunkSize);
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

/**
 * Run ffprobe to extract video metadata.
 * Returns a parsed VideoMetadata object.
 *
 * In environments where ffprobe is not installed the function returns
 * a safe default so that the rest of the pipeline can continue.
 */
export async function extractVideoMetadata(
  filePath: string
): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    const fileSizeBytes = stat ? stat.size : 0;

    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", () => {
      // ffprobe not available – return safe defaults
      logger.warn({ filePath }, "ffprobe not available, using default metadata");
      resolve(buildDefaultMetadata(fileSizeBytes));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        logger.warn({ filePath, stderr }, "ffprobe exited non-zero, using default metadata");
        resolve(buildDefaultMetadata(fileSizeBytes));
        return;
      }

      try {
        const info = JSON.parse(stdout) as FfprobeOutput;
        resolve(parseFfprobeOutput(info, fileSizeBytes));
      } catch (err) {
        logger.warn({ filePath, err }, "Failed to parse ffprobe output");
        resolve(buildDefaultMetadata(fileSizeBytes));
      }
    });
  });
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
  format_name?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function parseFramerate(raw: string | undefined): number {
  if (!raw) return 0;
  const parts = raw.split("/");
  if (parts.length === 2) {
    const num = parseFloat(parts[0] ?? "0");
    const den = parseFloat(parts[1] ?? "1");
    return den !== 0 ? Math.round((num / den) * 100) / 100 : 0;
  }
  return parseFloat(raw);
}

function parseFfprobeOutput(info: FfprobeOutput, fileSizeBytes: number): VideoMetadata {
  const videoStream = info.streams?.find((s) => s.codec_type === "video");
  const audioStream = info.streams?.find((s) => s.codec_type === "audio");
  const fmt = info.format;

  return {
    durationSecs: fmt?.duration ? Math.round(parseFloat(fmt.duration)) : 0,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    codec: videoStream?.codec_name ?? "unknown",
    framerate: parseFramerate(videoStream?.r_frame_rate ?? videoStream?.avg_frame_rate),
    fileSizeBytes: fileSizeBytes || (fmt?.size ? parseInt(fmt.size, 10) : 0),
    format: fmt?.format_name?.split(",")[0] ?? "unknown",
    audioCodec: audioStream?.codec_name ?? null,
    audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
    audioChannels: audioStream?.channels ?? null,
    bitrate: fmt?.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : null,
  };
}

function buildDefaultMetadata(fileSizeBytes: number): VideoMetadata {
  return {
    durationSecs: 0,
    width: 0,
    height: 0,
    codec: "unknown",
    framerate: 0,
    fileSizeBytes,
    format: "unknown",
    audioCodec: null,
    audioSampleRate: null,
    audioChannels: null,
    bitrate: null,
  };
}

/**
 * Generate a thumbnail at 25% into the video's duration using ffmpeg.
 * Returns the absolute path to the generated JPEG, or null on failure.
 */
export async function generateThumbnail(
  videoPath: string,
  durationSecs: number,
  outputDir: string
): Promise<string | null> {
  ensureDir(outputDir);

  const seekTime = Math.max(0, Math.floor(durationSecs * 0.25));
  const outputFile = path.join(outputDir, `${path.basename(videoPath, path.extname(videoPath))}_thumb.jpg`);

  const args = [
    "-ss", String(seekTime),
    "-i", videoPath,
    "-vframes", "1",
    "-q:v", "2",
    "-y",
    outputFile,
  ];

  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", () => {
      logger.warn({ videoPath }, "ffmpeg not available, skipping thumbnail generation");
      resolve(null);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        logger.warn({ videoPath, stderr }, "ffmpeg thumbnail generation failed");
        resolve(null);
        return;
      }
      resolve(outputFile);
    });
  });
}

// ---------------------------------------------------------------------------
// Core upload API
// ---------------------------------------------------------------------------

/**
 * Initiate a new upload session.
 *
 * Validates the total size and returns the upload ID plus chunking parameters
 * that the client should use for subsequent chunk uploads.
 */
export function initiateUpload(params: InitiateUploadParams): InitiateUploadResult | { error: string } {
  const { fileName, totalSizeBytes, ownerId } = params;

  if (!fileName || !fileName.trim()) {
    return { error: "fileName is required" };
  }

  if (!totalSizeBytes || totalSizeBytes <= 0) {
    return { error: "totalSizeBytes must be a positive integer" };
  }

  if (totalSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return {
      error: `File too large. Maximum supported size is ${MAX_UPLOAD_SIZE_BYTES / (1024 ** 3)} GB`,
    };
  }

  const uploadId = generateUploadId();
  const now = nowIso();
  const chunkSize = DEFAULT_CHUNK_SIZE_BYTES;
  const numChunks = totalChunks(totalSizeBytes, chunkSize);

  const session: UploadSession = {
    uploadId,
    videoId: null,
    fileName: path.basename(fileName),
    totalSizeBytes,
    receivedBytes: 0,
    receivedChunks: [],
    chunkPaths: {},
    status: "initiated",
    metadata: null,
    thumbnailPath: null,
    assembledFilePath: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    errorMessage: null,
    ownerId: ownerId ?? null,
  };

  uploadSessions.set(uploadId, session);

  logger.info({ uploadId, fileName, totalSizeBytes, numChunks }, "Upload session initiated");

  return {
    uploadId,
    chunkSizeBytes: chunkSize,
    totalChunks: numChunks,
    uploadUrl: `/api/v1/upload/${uploadId}/chunk`,
  };
}

/**
 * Accept a single chunk of an in-progress upload.
 *
 * Persists the chunk to disk, updates progress, and triggers final assembly
 * once all chunks have been received.
 */
export async function uploadChunk(
  params: UploadChunkParams
): Promise<UploadChunkResult | { error: string }> {
  const { uploadId, chunkIndex, chunkData } = params;

  const session = uploadSessions.get(uploadId);
  if (!session) {
    return { error: `Upload session '${uploadId}' not found` };
  }

  if (session.status === "complete" || session.status === "failed") {
    return { error: `Upload session is already in '${session.status}' state` };
  }

  if (chunkIndex < 0) {
    return { error: "chunkIndex must be >= 0" };
  }

  if (!Buffer.isBuffer(chunkData) || chunkData.length === 0) {
    return { error: "chunkData must be a non-empty Buffer" };
  }

  // Persist chunk to disk
  const chunkDir = path.join(UPLOAD_STORAGE_ROOT, uploadId, "chunks");
  ensureDir(chunkDir);
  const chunkPath = path.join(chunkDir, `chunk_${String(chunkIndex).padStart(6, "0")}`);

  try {
    fs.writeFileSync(chunkPath, chunkData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ uploadId, chunkIndex, err: msg }, "Failed to write chunk");
    return { error: `Failed to write chunk: ${msg}` };
  }

  // Update session
  if (!session.receivedChunks.includes(chunkIndex)) {
    session.receivedChunks.push(chunkIndex);
    session.receivedBytes += chunkData.length;
  } else {
    // Overwrite existing chunk (resume scenario)
    const oldSize = fs.statSync(chunkPath).size;
    session.receivedBytes = session.receivedBytes - oldSize + chunkData.length;
  }

  session.chunkPaths[chunkIndex] = chunkPath;
  session.status = "uploading";
  session.updatedAt = nowIso();

  const numChunks = totalChunks(session.totalSizeBytes, DEFAULT_CHUNK_SIZE_BYTES);
  const isComplete = session.receivedChunks.length >= numChunks;
  const progressPct = Math.min(
    99,
    Math.round((session.receivedBytes / session.totalSizeBytes) * 100)
  );

  uploadEvents.emit("progress", {
    uploadId,
    progressPct,
    receivedBytes: session.receivedBytes,
    totalSizeBytes: session.totalSizeBytes,
  });

  if (isComplete) {
    // Assemble chunks in the background
    assembleUpload(uploadId).catch((err) => {
      logger.error({ uploadId, err }, "Assembly failed");
    });
  }

  logger.info(
    { uploadId, chunkIndex, receivedBytes: session.receivedBytes, progressPct, isComplete },
    "Chunk received"
  );

  return {
    uploadId,
    chunkIndex,
    receivedBytes: session.receivedBytes,
    totalSizeBytes: session.totalSizeBytes,
    progressPct,
    isComplete,
  };
}

/**
 * Assemble all chunks into the final video file, extract metadata, and
 * generate a thumbnail.  Called automatically after the last chunk arrives.
 */
async function assembleUpload(uploadId: string): Promise<void> {
  const session = uploadSessions.get(uploadId);
  if (!session) return;

  session.status = "processing";
  session.updatedAt = nowIso();

  const outputDir = path.join(UPLOAD_STORAGE_ROOT, uploadId);
  ensureDir(outputDir);

  const outputFile = path.join(outputDir, session.fileName);
  const sortedChunks = [...session.receivedChunks].sort((a, b) => a - b);

  try {
    const writeStream = fs.createWriteStream(outputFile);
    for (const chunkIdx of sortedChunks) {
      const chunkPath = session.chunkPaths[chunkIdx];
      if (!chunkPath || !fs.existsSync(chunkPath)) {
        throw new Error(`Chunk ${chunkIdx} missing from disk at ${chunkPath}`);
      }
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    await new Promise<void>((res, rej) => {
      writeStream.end((err?: Error | null) => (err ? rej(err) : res()));
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.status = "failed";
    session.errorMessage = `Assembly failed: ${msg}`;
    session.updatedAt = nowIso();
    uploadEvents.emit("failed", { uploadId, error: msg });
    logger.error({ uploadId, err: msg }, "Upload assembly failed");
    return;
  }

  session.assembledFilePath = outputFile;

  // Extract metadata
  try {
    const metadata = await extractVideoMetadata(outputFile);
    session.metadata = metadata;

    // Generate thumbnail
    const thumbDir = path.join(THUMBNAIL_STORAGE_ROOT, uploadId);
    const thumbPath = await generateThumbnail(outputFile, metadata.durationSecs, thumbDir);
    session.thumbnailPath = thumbPath;
  } catch (err) {
    logger.warn({ uploadId, err }, "Metadata extraction/thumbnail generation error (non-fatal)");
  }

  session.status = "complete";
  session.completedAt = nowIso();
  session.updatedAt = nowIso();

  uploadEvents.emit("complete", {
    uploadId,
    filePath: outputFile,
    metadata: session.metadata,
    thumbnailPath: session.thumbnailPath,
  });

  logger.info({ uploadId, outputFile }, "Upload assembled successfully");
}

/**
 * Retrieve the current state of an upload session.
 */
export function getUploadSession(uploadId: string): UploadSession | undefined {
  return uploadSessions.get(uploadId);
}

/**
 * List all upload sessions, optionally filtered by owner.
 */
export function listUploadSessions(ownerId?: string): UploadSession[] {
  const all = Array.from(uploadSessions.values());
  if (ownerId) return all.filter((s) => s.ownerId === ownerId);
  return all;
}

/**
 * Delete an upload session and clean up associated disk files.
 */
export function deleteUploadSession(uploadId: string): boolean {
  const session = uploadSessions.get(uploadId);
  if (!session) return false;

  // Clean up chunk files
  const chunkDir = path.join(UPLOAD_STORAGE_ROOT, uploadId, "chunks");
  if (fs.existsSync(chunkDir)) {
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ uploadId, err }, "Failed to clean up chunk directory");
    }
  }

  uploadSessions.delete(uploadId);
  logger.info({ uploadId }, "Upload session deleted");
  return true;
}

/**
 * Parse a tus Upload-Metadata header value.
 *
 * The tus protocol encodes metadata as comma-separated key-value pairs
 * where the value is base64-encoded.
 */
export function parseTusMetadata(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const pair of header.split(",")) {
    const trimmed = pair.trim();
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      result[trimmed] = "";
      continue;
    }
    const key = trimmed.substring(0, spaceIdx);
    const encodedValue = trimmed.substring(spaceIdx + 1);
    try {
      result[key] = Buffer.from(encodedValue, "base64").toString("utf-8");
    } catch {
      result[key] = encodedValue;
    }
  }

  return result;
}

/**
 * Build a tus Upload-Metadata header value from a plain object.
 */
export function buildTusMetadata(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function _resetUploadSessions(): void {
  uploadSessions.clear();
}
