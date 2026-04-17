import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createDubbingJob,
  batchCreateDubbingJobs,
  updateDubbingJobStatus,
  getDubbingJob,
  listDubbingJobs,
} from "../services";
import { DubbingJobStatus, SUPPORTED_LANGUAGES, DEFAULT_DUB_LANGUAGES } from "../types";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateDubbingJobSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  targetLanguage: z.string().min(1, "targetLanguage is required"),
});

const BatchDubbingJobSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  /** Languages to dub into. Defaults to the 5 primary target languages. */
  languages: z
    .array(z.string().min(1))
    .max(20, "A maximum of 20 languages can be queued at once")
    .optional(),
});

const UpdateJobStatusSchema = z
  .object({
    status: z.enum(
      Object.values(DubbingJobStatus) as [DubbingJobStatus, ...DubbingJobStatus[]]
    ),
    /**
     * Final measured lip-sync offset in milliseconds (should be < 100 for a quality dub).
     * Only meaningful (and accepted) when `status` is `completed` or `failed`.
     */
    syncOffsetMs: z.number().min(0).optional(),
  })
  .refine(
    (data) =>
      data.syncOffsetMs === undefined ||
      data.status === DubbingJobStatus.Completed ||
      data.status === DubbingJobStatus.Failed,
    {
      message: "syncOffsetMs can only be set when status is 'completed' or 'failed'",
      path: ["syncOffsetMs"],
    }
  );

const ListJobsQuerySchema = z.object({
  sessionId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/dubbing/languages
 * List all 150 supported languages for Generative Deep-Dubbing.
 */
router.get("/languages", (_req: Request, res: Response) => {
  res.json({ count: SUPPORTED_LANGUAGES.length, languages: SUPPORTED_LANGUAGES });
});

/**
 * POST /api/dubbing/jobs
 * Enqueue a new deep-dubbing translation job.
 */
router.post("/jobs", (req: Request, res: Response) => {
  const parse = CreateDubbingJobSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const { sessionId, targetLanguage } = parse.data;
  const result = createDubbingJob(sessionId, targetLanguage);
  if ("error" in result) {
    res.status(400).json(result);
    return;
  }
  res.status(201).json(result);
});

/**
 * POST /api/dubbing/batch
 * Batch-enqueue deep-dubbing jobs for multiple languages in one call.
 *
 * On video upload the pipeline calls this endpoint once to kick off
 * parallel transcription + translation into all target languages.
 * Defaults to the 5 primary languages (es, hi, pt, zh, ar) when
 * `languages` is omitted.
 */
router.post("/batch", (req: Request, res: Response) => {
  const parse = BatchDubbingJobSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const { sessionId, languages } = parse.data;
  const results = batchCreateDubbingJobs(sessionId, languages);

  const jobs = results.filter((r) => !("error" in r));
  const errors = results.filter((r) => "error" in r);

  if (jobs.length === 0) {
    res.status(400).json({ errors });
    return;
  }

  res.status(201).json({
    sessionId,
    defaultLanguages: DEFAULT_DUB_LANGUAGES,
    queued: jobs,
    ...(errors.length > 0 && { errors }),
  });
});

/**
 * GET /api/dubbing/jobs/:id
 * Get the status of a dubbing job.
 */
router.get("/jobs/:id", (req: Request, res: Response) => {
  const job = getDubbingJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Dubbing job not found" });
    return;
  }
  res.json(job);
});

/**
 * PATCH /api/dubbing/jobs/:id/status
 * Update the status of a dubbing job.
 *
 * Called by the AI pipeline workers as the job moves through
 * queued → processing → completed / failed.  When the job
 * completes, `syncOffsetMs` records the achieved lip-sync
 * accuracy (target: < 100 ms).
 */
router.patch("/jobs/:id/status", (req: Request, res: Response) => {
  const parse = UpdateJobStatusSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const { status, syncOffsetMs } = parse.data;
  const job = updateDubbingJobStatus(req.params.id, status, syncOffsetMs);
  if (!job) {
    res.status(404).json({ error: "Dubbing job not found" });
    return;
  }
  res.json(job);
});

/**
 * GET /api/dubbing/jobs
 * List all dubbing jobs, optionally filtered by sessionId query param.
 */
router.get("/jobs", (req: Request, res: Response) => {
  const parse = ListJobsQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  res.json(listDubbingJobs(parse.data.sessionId));
});

export default router;
