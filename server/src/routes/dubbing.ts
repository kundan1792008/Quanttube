import { Router, Request, Response } from "express";
import { z } from "zod";
import { createDubbingJob, getDubbingJob, listDubbingJobs } from "../services";
import { SUPPORTED_LANGUAGES } from "../types";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateDubbingJobSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  targetLanguage: z.string().min(1, "targetLanguage is required"),
});

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
